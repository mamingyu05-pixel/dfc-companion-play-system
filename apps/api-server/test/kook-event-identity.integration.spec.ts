import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { NestFactory } from "@nestjs/core";
import { INestApplication } from "@nestjs/common";
import { AppModule } from "../src/modules/app.module";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { IntegrationJobsService } from "../src/modules/bot/integration-jobs.service";
import { OrdersService } from "../src/modules/orders/orders.service";

let app: INestApplication, prisma: PrismaService, jobs: IntegrationJobsService, orders: OrdersService;
beforeAll(async () => {
  process.env.DFC_BACKGROUND_JOBS_ENABLED = "false";
  app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  app.setGlobalPrefix("api"); await app.listen(0, "127.0.0.1");
  prisma = app.get(PrismaService); jobs = app.get(IntegrationJobsService); orders = app.get(OrdersService);
});
beforeEach(async () => {
  await prisma.integrationJob.deleteMany();
  Object.assign(process.env, { KOOK_VERIFY_TOKEN: "synthetic-event-verify", KOOK_BOT_ID: "synthetic-bot-a" });
});
afterAll(async () => { await app?.close(); });
async function webhook(body: unknown) {
  return new Promise<{status: number; body: any}>((resolve,reject) => {
    const req = request(`http://127.0.0.1:${app.getHttpServer().address().port}/api/kook/webhook`, { method: "POST", headers: { "Content-Type": "application/json" } }, res => {
      let data=""; res.on("data", b=>data+=b); res.on("end", ()=>resolve({status:res.statusCode!,body:JSON.parse(data)}));
    }); req.on("error",reject); req.end(JSON.stringify(body));
  });
}
function event(outerId: unknown = randomUUID(), overrides: {user?: string; order?: string; card?: string; sn?: number} = {}) {
  return { verify_token: "synthetic-event-verify", sn: overrides.sn ?? 1, d: {
    type: 255, channel_type: "GROUP", author_id: "1", msg_id: outerId, msg_timestamp: 123456789,
    extra: { type: "message_btn_click", guild_id: "synthetic-guild", body: {
      user_id: overrides.user ?? "synthetic-clicker", msg_id: overrides.card ?? "synthetic-shared-card", target_id: "synthetic-channel",
      value: `order.accept.${overrides.order ?? "synthetic-order"}.0`
    } }
  } };
}
async function user(role: "CUSTOMER" | "COMPANION") {
  const id=randomUUID();
  return prisma.user.create({ data: { email:`${id}@synthetic.invalid`, displayName:id, displayNameKey:id, passwordHash:"synthetic", role,
    wallet:{create:{availableBalance:"1000"}}, ...(role==="COMPANION"?{companionProfile:{create:{nickname:"Synthetic",skillModes:[],pricePerHour:"100",commissionRate:"0.2",status:"LISTED",onlineStatus:"ONLINE"}}}:{}) } });
}
async function fixture() {
  const customer=await user("CUSTOMER"), companion=await user("COMPANION"), other=await user("COMPANION");
  const external=randomUUID(), otherExternal=randomUUID();
  await prisma.userExternalAccount.createMany({data:[{userId:companion.id,platform:"KOOK",externalUserId:external},{userId:other.id,platform:"KOOK",externalUserId:otherExternal}]});
  const order=await orders.createOrder(customer.id,{ requestId: randomUUID(),mode:"娱乐",hours:"1",companionId:companion.id});
  // Synthetic assigned-state fixture; normal publish flows remain covered by dispatch-workflow tests.
  await prisma.order.update({where:{id:order.id},data:{status:"ASSIGNED"}});
  return {customer,companion,order,external,otherExternal};
}
async function drain() { for(let i=0;i<15;i++) if(!await jobs.processOne()) break; }
test("KOOK event identity: different outer events on one card are independently persisted", async () => {
  expect((await webhook(event("outer-a"))).status).toBe(200);
  expect((await webhook(event("outer-b"))).status).toBe(200);
  const rows=await prisma.integrationJob.findMany({where:{kind:"KOOK_EVENT"}});
  expect(rows).toHaveLength(2);
  expect(rows.map(row=>(row.payload as any).d.msg_id).sort()).toEqual(["outer-a","outer-b"]);
});
test("KOOK event identity: twenty replays and changed incidental fields retain one outer-event receipt", async () => {
  const body=event("one-outer-event");
  const results=await Promise.all(Array.from({length:20},()=>webhook(body)));
  expect(results.every(result=>result.status===200)).toBe(true);
  expect((await webhook(event("one-outer-event",{card:"different-card",sn:200,user:"different-incidental-user"}))).status).toBe(200);
  const rows=await prisma.integrationJob.findMany({where:{kind:"KOOK_EVENT"}});
  expect(rows).toHaveLength(1); expect((rows[0].payload as any).d.extra.body.user_id).toBe("synthetic-clicker");
  expect(JSON.stringify(rows[0].payload)).not.toContain("synthetic-event-verify");
});
test("KOOK event identity: distinct bot scopes do not suppress the same outer identifier", async () => {
  expect((await webhook(event("shared-outer"))).status).toBe(200);
  process.env.KOOK_BOT_ID="synthetic-bot-b";
  expect((await webhook(event("shared-outer"))).status).toBe(200);
  expect(await prisma.integrationJob.count({where:{kind:"KOOK_EVENT"}})).toBe(2);
});
test("KOOK event identity: sn wrap and reuse cannot suppress distinct events", async () => {
  for(const [outerId,sn] of [["before-wrap",65535],["after-wrap",1],["later-reuse",65535]] as const) expect((await webhook(event(outerId,{sn}))).status).toBe(200);
  expect(await prisma.integrationJob.count({where:{kind:"KOOK_EVENT"}})).toBe(3);
});
test.each([null, "", "   ", 123])("KOOK event identity: invalid outer id %p refuses card or timestamp fallback", async outerId => {
  expect((await webhook(event(outerId))).status).toBe(400);
  expect(await prisma.integrationJob.count({where:{kind:"KOOK_EVENT"}})).toBe(0);
});
test("KOOK event identity: absent outer id refuses fallback while verification challenge remains valid", async () => {
  const body=event(); delete (body.d as any).msg_id;
  expect((await webhook(body)).status).toBe(400);
  const challenge=await webhook({verify_token:"synthetic-event-verify",challenge:"synthetic-challenge"});
  expect(challenge.status).toBe(200); expect(challenge.body).toEqual({challenge:"synthetic-challenge"});
  expect(await prisma.integrationJob.count({where:{kind:"KOOK_EVENT"}})).toBe(0);
});
test("KOOK event identity: independent duplicate clicks process twice but accept and fund only once", async () => {
  const f=await fixture();
  for(const outerId of ["business-a","business-b"]) expect((await webhook(event(outerId,{user:f.external,order:f.order.id}))).status).toBe(200);
  await drain();
  expect(await prisma.integrationJob.count({where:{kind:"KOOK_EVENT",status:"COMPLETED"}})).toBe(2);
  expect(await prisma.orderStatusLog.count({where:{orderId:f.order.id,toStatus:"ACCEPTED"}})).toBe(1);
  expect(await prisma.walletTransaction.count({where:{referenceId:f.order.id,type:"ORDER_PAYMENT"}})).toBe(1);
  expect(await prisma.walletTransaction.count({where:{referenceId:f.order.id,type:"ORDER_SETTLEMENT"}})).toBe(0);
  const customerWallet=await prisma.wallet.findUniqueOrThrow({where:{userId:f.customer.id}});
  expect(customerWallet.availableBalance.toString()).toBe("900"); expect(customerWallet.frozenBalance.toString()).toBe("100");
  expect((await prisma.order.findUniqueOrThrow({where:{id:f.order.id}})).status).toBe("ACCEPTED");
});
test("KOOK event identity: real worker still rejects unbound and other-owner actors", async () => {
  const f=await fixture();
  for(const [outerId,actor] of [["unbound-event","synthetic-unbound"],["other-event",f.otherExternal]]) expect((await webhook(event(outerId,{user:actor,order:f.order.id}))).status).toBe(200);
  await drain();
  expect(await prisma.orderStatusLog.count({where:{orderId:f.order.id,toStatus:"ACCEPTED"}})).toBe(0);
  expect((await prisma.order.findUniqueOrThrow({where:{id:f.order.id}})).status).toBe("ASSIGNED");
  expect(await prisma.integrationJob.count({where:{kind:"KOOK_EVENT",status:"COMPLETED"}})).toBe(0);
  expect((await webhook(event("owner-event",{user:f.external,order:f.order.id}))).status).toBe(200);
  await drain(); expect(await prisma.orderStatusLog.count({where:{orderId:f.order.id,toStatus:"ACCEPTED"}})).toBe(1);
});
test("KOOK event identity: previously verified durable legacy payload remains processable", async () => {
  const f=await fixture(), body=event("legacy-outer",{user:f.external,order:f.order.id});
  delete (body.d as any).msg_id; delete (body as any).verify_token;
  await prisma.integrationJob.create({data:{kind:"KOOK_EVENT",key:`synthetic-legacy:${randomUUID()}`,payload:JSON.parse(JSON.stringify(body))}});
  await drain(); expect((await prisma.order.findUniqueOrThrow({where:{id:f.order.id}})).status).toBe("ACCEPTED");
});
