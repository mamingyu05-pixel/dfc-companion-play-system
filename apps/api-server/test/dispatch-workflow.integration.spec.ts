import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { INestApplication } from "@nestjs/common";
import { AppModule } from "../src/modules/app.module";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { OrderDraftsService } from "../src/modules/orders/order-drafts.service";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";
import { IntegrationJobsService } from "../src/modules/bot/integration-jobs.service";

let app: INestApplication, prisma: PrismaService, orders: OrdersService, jobs: IntegrationJobsService;
const outbound: any[] = [];
// Both entry points use synthetic wallet funds and the same real HTTP/service/DB path.
test.each(["customer", "service-desk"])("local closed loop: %s entry, immediate replacement, verified KOOK clicks and completion", async entry => {
  const admin = await user("ADMIN"), customer = await user("CUSTOMER");
  const first = await user("COMPANION"), replacement = await user("COMPANION");
  const firstExternal = await bind(first.id), replacementExternal = await bind(replacement.id);
  const requestBody = entry === "customer"
    ? { requestId: randomUUID(), game: "DELTA_FORCE", mode: "娱乐", hours: "1", companionId: first.id, expectedTotalAmount: "100" }
    : { requestId: randomUUID(), customerId: customer.id, game: "DELTA_FORCE", mode: "娱乐", hours: "1", priceTier: "CUSTOM", customUnitPrice: "100", companionIds: [] };
  const path = entry === "customer" ? "/orders" : "/admin/orders/direct";
  const actor = entry === "customer" ? customer : admin;
  const created = await call("POST", path, actor, requestBody);
  expect(created.status).toBe(201);
  const order = entry === "customer" ? created.body : created.body.orders[0];
  expect(order.status).toBe("PAID");
  expect(outbound).toHaveLength(0);
  expect((await call("GET", "/admin/orders", admin)).body.some((row: any) => row.id === order.id && row.status === "PAID")).toBe(true);
  expect((await call("POST", path, actor, requestBody)).status).toBe(201);
  expect(await prisma.order.count({ where: { customerId: customer.id } })).toBe(1);
  const assign = (companionId: string, version: number) => call("PATCH", `/admin/orders/${order.id}/dispatch`, admin,
    { mode: "DIRECT", companionId, dispatchVersion: version, reason: "synthetic customer-confirmed assignment" });
  expect((await assign(first.id, 0)).status).toBe(200);
  const oldNotice = await prisma.notificationDelivery.findFirstOrThrow({ where: { platform: "KOOK", businessKey: { startsWith: `order-notice:${order.id}:`, endsWith: ":v1" }, status: "SENT" } });
  expect((await assign(replacement.id, 1)).status).toBe(200); // No response: no timeout or decline required.
  const notice = await prisma.notificationDelivery.findFirstOrThrow({ where: { platform: "KOOK", businessKey: { startsWith: `order-notice:${order.id}:`, endsWith: ":v2" }, status: "SENT" } });
  const click = async (external: string, messageId: string, version: number, eventId = randomUUID()) => {
    // Official button shape: user_id is present, optional user profile is absent.
    const event = { verify_token: "synthetic-verify", d: { type: 255, author_id: "1", msg_id: eventId,
      extra: { type: "message_btn_click", body: { user_id: external, msg_id: messageId, target_id: notice.target, value: `order.accept.${order.id}.${version}` } } } };
    expect((await call("POST", "/kook/webhook", undefined, event)).status).toBe(200);
    for (let i = 0; i < 20; i++) if (!await jobs.processOne()) break;
  };
  await click(firstExternal, oldNotice.messageId!, 1);
  await click(firstExternal, notice.messageId!, 2);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("ASSIGNED");
  const eventId = randomUUID();
  await click(replacementExternal, notice.messageId!, 2, eventId);
  await click(replacementExternal, notice.messageId!, 2, eventId);
  await click(replacementExternal, notice.messageId!, 2);
  expect(await prisma.orderStatusLog.count({ where: { orderId: order.id, toStatus: "ACCEPTED" } })).toBe(1);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).companionId).toBe(replacement.id);
  expect((await call("PATCH", `/orders/${order.id}/start`, replacement)).status).toBe(200);
  await prisma.order.update({ where: { id: order.id }, data: { startedAt: new Date(Date.now() - 3601000) } });
  expect((await call("PATCH", `/orders/${order.id}/complete`, replacement)).status).toBe(200);
  expect((await call("PATCH", `/orders/${order.id}/confirm-completion`, customer)).status).toBe(200);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("COMPLETED");
  expect(await prisma.walletTransaction.count({ where: { referenceId: order.id, type: "ORDER_PAYMENT" } })).toBe(1);
  expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.id } })).frozenBalance.toString()).toBe("0");
});

test("service desk: unselected drafts do not notify channels until an admin enables fallback", async () => {
  const admin = await user("ADMIN"), customer = await user("CUSTOMER");
  const draft = await app.get(OrderDraftsService).createDraftFromDemand(admin.id, { customerId: customer.id, demandText: "三角洲行动 娱乐 1小时", sourceMessageId: randomUUID() });
  expect(await prisma.integrationJob.count({ where: { kind: "DRAFT_DISPATCH" } })).toBe(0);
  expect((await call("POST", `/admin/order-drafts/${draft.draft.id}/publish-fallback`, customer)).status).toBe(403);
  expect((await call("POST", `/admin/order-drafts/${draft.draft.id}/publish-fallback`, admin)).status).toBe(201);
  expect(await prisma.integrationJob.count({ where: { kind: "DRAFT_DISPATCH" } })).toBe(1);
});

test("service desk: failed notification preserves the paid assignment and permits immediate replacement", async () => {
  const f = await fixture(), other = await user("COMPANION");
  const success = (global.fetch as jest.Mock).getMockImplementation()!;
  (global.fetch as jest.Mock).mockImplementation(async (url: string, init: RequestInit) =>
    url.endsWith("message/create") ? { ok: true, json: async () => ({ code: 40000, message: "synthetic rejection" }) } : success(url, init));
  const failed = await dispatch(f, "DIRECT");
  expect(failed.status).toBe(200);
  expect(failed.body.notificationPending).toBe(true);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("ASSIGNED");
  (global.fetch as jest.Mock).mockImplementation(success);
  expect((await dispatch(f, "DIRECT", { companionId: other.id })).status).toBe(200);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).companionId).toBe(other.id);
  expect(await prisma.walletTransaction.count({ where: { referenceId: f.order.id, type: "ORDER_PAYMENT" } })).toBe(1);
});

test("service desk: active service is visible even when a companion reports ONLINE", async () => {
  const f = await fixture();
  await orders.assignOrder(f.order.id, f.companion.id, f.admin.id, 0);
  await orders.acceptOrderFromWeb(f.order.id, f.companion.id, 1);
  const result = await call("GET", "/admin/companions", f.admin);
  expect(result.status).toBe(200);
  expect(result.body.find((row: any) => row.userId === f.companion.id).activeServiceCount).toBe(1);
});
beforeAll(async () => {
  process.env.DFC_BACKGROUND_JOBS_ENABLED = "false";
  app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  app.setGlobalPrefix("api");
  await app.listen(0, "127.0.0.1");
  prisma = app.get(PrismaService); orders = app.get(OrdersService); jobs = app.get(IntegrationJobsService);
});
beforeEach(async () => {
  await prisma.integrationJob.deleteMany();
  await prisma.notificationDelivery.deleteMany();
  outbound.length = 0;
  Object.assign(process.env, { KOOK_VERIFY_TOKEN: "synthetic-verify", KOOK_TOKEN: "synthetic", KOOK_ORDER_CHANNEL_ID: "synthetic-kook", DISCORD_TOKEN: "synthetic", DISCORD_ORDER_CHANNEL_ID: "synthetic-discord" });
  (global.fetch as jest.Mock).mockImplementation(async (url: string, init: RequestInit) => {
    outbound.push({ url, method: init.method, body: JSON.parse(String(init.body || "{}")) });
    return { ok: true, json: async () => url.includes("discord.com") ? { id: `d-${outbound.length}`, channel_id: "synthetic-discord" } : { code: 0, data: { msg_id: `k-${outbound.length}` } } };
  });
});
afterAll(async () => { await app?.close(); });

async function user(role: "ADMIN" | "CUSTOMER" | "COMPANION", profile: Record<string, unknown> = {}) {
  const id = randomUUID();
  return prisma.user.create({ data: { email: `${id}@synthetic.invalid`, displayName: "同名测试", displayNameKey: id, passwordHash: "synthetic", role,
    wallet: { create: { availableBalance: "1000" } },
    ...(role === "COMPANION" ? { companionProfile: { create: { nickname: "合成陪玩", skillModes: [], pricePerHour: "100", commissionRate: "0.2", status: "LISTED", onlineStatus: "ONLINE", ...profile } } } : {}) } });
}
async function call(method: string, path: string, actor?: { id: string; role: string }, body?: unknown, headers: Record<string, string> = {}) {
  const token = actor ? new JwtService().sign({ sub: actor.id, role: actor.role }, { secret: process.env.JWT_SECRET }) : undefined;
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = request(`${app.getHttpServer().address() ? `http://127.0.0.1:${app.getHttpServer().address().port}` : ""}/api${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } }, res => {
      let data = ""; res.on("data", b => data += b); res.on("end", () => resolve({ status: res.statusCode!, body: data ? JSON.parse(data) : null }));
    }); req.on("error", reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
// Simulates a caller reading its order before issuing a versioned action. Raw call() never fills missing versions.
async function act(orderId: string, action: "accept" | "decline", actor: { id: string; role: string }, body: Record<string, unknown> = {}) {
  const snapshot = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  return call("PATCH", `/orders/${orderId}/${action}`, actor, { dispatchVersion: snapshot.dispatchVersion, ...body });
}
async function fixture() {
  const admin = await user("ADMIN"), customer = await user("CUSTOMER"), companion = await user("COMPANION");
  const order = await orders.createOrder(customer.id, { requestId: randomUUID(), game: "DELTA_FORCE", mode: "娱乐", hours: "1", companionId: companion.id });
  return { admin, customer, companion, order };
}
async function bind(companionId: string) {
  const externalUserId = String(Date.now()) + String(Math.floor(Math.random() * 100000));
  await prisma.userExternalAccount.create({ data: { userId: companionId, platform: "KOOK", externalUserId } });
  return externalUserId;
}
async function button(orderId: string, top: string, nested?: string) {
  const version = (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).dispatchVersion;
  const receipt = await prisma.notificationDelivery.findFirstOrThrow({ where: { platform: "KOOK", businessKey: { startsWith: `order-notice:${orderId}:`, endsWith: `:v${version}` }, status: "SENT" } });
  const result = await call("POST", "/kook/webhook", undefined, { verify_token: "synthetic-verify", d: { type: 255, channel_type: "GROUP", author_id: top, msg_id: randomUUID(), extra: { type: "message_btn_click", body: { user_id: nested, msg_id: receipt.messageId!, target_id: receipt.target, value: `order.accept.${orderId}.${version}` } } } });
  expect(result.status).toBe(200);
  for (let i = 0; i < 5; i++) if (!await jobs.processOne()) break;
}

test("dispatch QA: assignment never substitutes admin for companion acceptance", async () => {
  const f = await fixture();
  const result = await call("PATCH", `/admin/orders/${f.order.id}/assign`, f.admin, { companionId: f.companion.id, autoStart: true, dispatchVersion: f.order.dispatchVersion });
  expect(result.status).toBe(200);
  const assigned = await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } });
  expect(assigned.status).toBe("ASSIGNED"); expect(assigned.acceptedAt).toBeNull(); expect(assigned.startedAt).toBeNull();
  expect((await act(f.order.id, "accept", f.companion)).status).toBe(200);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("ACCEPTED");
});
test("dispatch QA: null companion is a client validation error", async () => {
  const f = await fixture();
  expect((await call("PATCH", `/admin/orders/${f.order.id}/assign`, f.admin, { companionId: null, dispatchVersion: f.order.dispatchVersion })).status).toBe(400);
});
test("dispatch QA: authoritative nested KOOK clicker accepts despite system author", async () => {
  const f = await fixture(), external = await bind(f.companion.id);
  await orders.assignOrder(f.order.id, f.companion.id, f.admin.id, f.order.dispatchVersion);
  await button(f.order.id, "1", external);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("ACCEPTED");
});
test("dispatch QA: conflicting or missing nested clicker cannot borrow the top author", async () => {
  const f = await fixture(), external = await bind(f.companion.id), other = await user("COMPANION"), wrong = await bind(other.id);
  await orders.assignOrder(f.order.id, f.companion.id, f.admin.id, f.order.dispatchVersion);
  await button(f.order.id, external, wrong);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("ASSIGNED");
  await button(f.order.id, external);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("ASSIGNED");
});
test("dispatch QA: raw private demand is absent from both public card payloads and companion listings", async () => {
  const admin = await user("ADMIN"), companion = await user("COMPANION"), marker = "SYNTHETIC-PRIVATE-CONTACT-NOT-A-REAL-PERSON";
  const { draft } = await app.get(OrderDraftsService).createDraftFromDemand(admin.id, { sourcePlatform: "KOOK", sourceMessageId: randomUUID(), demandText: `三角洲行动 娱乐陪玩1小时 ${marker}` });
  await app.get(BotNotificationService).sendOrderDraftDispatchNotifications(draft.id);
  expect(outbound.length).toBe(2); expect(JSON.stringify(outbound)).not.toContain(marker);
  expect(JSON.stringify(await app.get(OrderDraftsService).listCompanionDrafts(companion.id))).not.toContain(marker);
  expect((await prisma.orderDraft.findUniqueOrThrow({ where: { id: draft.id } })).note).toContain(marker);
});
test("dispatch QA: funded commission survives assignment and platform acceptance profile changes", async () => {
  const f = await fixture(), external = await bind(f.companion.id);
  await prisma.companionProfile.update({ where: { userId: f.companion.id }, data: { commissionRate: "0.4" } });
  await orders.assignOrder(f.order.id, f.companion.id, f.admin.id, f.order.dispatchVersion);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).commissionRateSnapshot.toString()).toBe("0.2");
  await prisma.companionProfile.update({ where: { userId: f.companion.id }, data: { commissionRate: "0.5" } });
  await orders.acceptOrderFromPlatform("KOOK", f.order.id, external, undefined, 1);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).commissionRateSnapshot.toString()).toBe("0.2");
  await orders.startOrder(f.order.id, f.companion.id);
  await prisma.order.update({ where: { id: f.order.id }, data: { startedAt: new Date(Date.now() - 3601000) } });
  await orders.completeOrder(f.order.id, f.companion.id);
  await orders.acceptCompletion(f.order.id, f.customer.id);
  const settled = await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } });
  expect(settled.platformFee.toString()).toBe("20"); expect(settled.companionIncome.toString()).toBe("80");
});
test("dispatch QA: BUSY, occupied and wrong-game companions cannot accept an open order", async () => {
  for (const condition of ["BUSY", "occupied", "wrong-game"]) {
    const f = await fixture();
    await prisma.order.update({ where: { id: f.order.id }, data: { status: "ASSIGNED", companionId: null } });
    if (condition === "occupied") await prisma.order.create({ data: { orderNo: randomUUID(), customerId: f.customer.id, companionId: f.companion.id, mode: "synthetic", hours: "1", unitPrice: "100", totalAmount: "100", status: "IN_PROGRESS" } });
    else await prisma.companionProfile.update({ where: { userId: f.companion.id }, data: condition === "BUSY" ? { onlineStatus: "BUSY" } : { game: "VALORANT", games: ["VALORANT"] } });
    expect((await act(f.order.id, "accept", f.companion)).status).toBe(400);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("ASSIGNED");
  }
});

async function dispatch(f: Awaited<ReturnType<typeof fixture>>, mode: "OPEN" | "DIRECT", extra: Record<string, unknown> = {}) {
  const snapshot = await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } });
  return call("PATCH", `/admin/orders/${f.order.id}/dispatch`, f.admin, { dispatchVersion: snapshot.dispatchVersion, mode, ...(mode === "DIRECT" ? { companionId: f.companion.id } : {}), reason: "synthetic customer-confirmed dispatch", ...extra });
}
test("dispatch lifecycle: same paid order switches modes, declines, reassigns and settles without another freeze", async () => {
  const f = await fixture(), other = await user("COMPANION");
  const frozen = await prisma.wallet.findUniqueOrThrow({ where: { userId: f.customer.id } });
  expect((await dispatch(f, "OPEN")).status).toBe(200);
  expect((await dispatch(f, "DIRECT")).status).toBe(200);
  expect((await act(f.order.id, "decline", other, { reason: "not owner" })).status).toBe(400);
  expect((await act(f.order.id, "decline", f.companion, { reason: "synthetic schedule conflict" })).status).toBe(200);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("PAID");
  expect((await dispatch(f, "DIRECT", { companionId: other.id })).status).toBe(200);
  expect((await dispatch(f, "OPEN")).status).toBe(200);
  expect((await act(f.order.id, "accept", other)).status).toBe(200);
  expect((await dispatch(f, "DIRECT")).status).toBe(400);
  expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: f.customer.id } })).frozenBalance.toString()).toBe(frozen.frozenBalance.toString());
  expect(await prisma.order.count({ where: { customerId: f.customer.id } })).toBe(1);
  expect(await prisma.walletTransaction.count({ where: { referenceId: f.order.id, type: "ORDER_PAYMENT" } })).toBe(1);
  const logs = await prisma.orderStatusLog.findMany({ where: { orderId: f.order.id } });
  expect(logs.some(log => log.actorId === f.companion.id && log.reason?.includes("COMPANION_DECLINED"))).toBe(true);
  expect(await prisma.adminLog.count({ where: { entityId: f.order.id, action: "DISPATCH_ORDER" } })).toBe(4);
  await orders.startOrder(f.order.id, other.id);
  await prisma.order.update({ where: { id: f.order.id }, data: { startedAt: new Date(Date.now() - 3601000) } });
  await orders.completeOrder(f.order.id, other.id);
  const accepted = await orders.acceptCompletion(f.order.id, f.customer.id);
  const settled = await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } });
  expect(settled.status).toBe("COMPLETED");
  expect(settled.companionIncome.add(settled.platformFee).toString()).toBe(settled.totalAmount.toString());
  expect(accepted).toBeDefined();
});
test("dispatch lifecycle: expiry commits return to desk when the owner tries to accept too late", async () => {
  const f = await fixture();
  const result = await dispatch(f, "DIRECT", { acceptanceDeadline: new Date(Date.now() + 60000).toISOString() });
  expect(result.status).toBe(200);
  await prisma.order.update({ where: { id: f.order.id }, data: { acceptanceDeadline: new Date(Date.now() - 1000) } });
  expect((await act(f.order.id, "accept", f.companion)).status).toBe(400);
  const returned = await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } });
  expect(returned.status).toBe("PAID"); expect(returned.companionId).toBeNull(); expect(returned.startedAt).toBeNull();
  expect((await dispatch(f, "OPEN")).status).toBe(200);
  expect((await act(f.order.id, "accept", f.companion)).status).toBe(200);
});
test("dispatch lifecycle: persisted deadline task survives worker recreation and stale deadlines cannot undo a new assignment", async () => {
  const f = await fixture();
  const first = await dispatch(f, "DIRECT", { acceptanceDeadline: new Date(Date.now() + 60000).toISOString() });
  expect(first.status).toBe(200);
  const oldTask = await prisma.integrationJob.findFirstOrThrow({ where: { kind: "ORDER_ACCEPTANCE_TIMEOUT" } });
  expect(oldTask.nextAttemptAt.toISOString()).toBe(first.body.order.acceptanceDeadline);
  const second = await dispatch(f, "OPEN"); expect(second.status).toBe(200);
  expect(await orders.expireAssignment(f.order.id, first.body.order.dispatchVersion)).toBe(false);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("ASSIGNED");
  await prisma.order.update({ where: { id: f.order.id }, data: { acceptanceDeadline: new Date(Date.now() - 1000) } });
  const newJobs = new IntegrationJobsService(prisma);
  const restartedOrders = new OrdersService(prisma, app.get(BotNotificationService), newJobs); restartedOrders.onModuleInit();
  await prisma.integrationJob.create({ data: { kind: "ORDER_ACCEPTANCE_TIMEOUT", key: `synthetic-restart:${f.order.id}`, payload: { orderId: f.order.id, dispatchVersion: second.body.order.dispatchVersion } } });
  expect(await newJobs.processOne()).toBe(true);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("PAID");
  expect(await restartedOrders.expireAssignment(f.order.id, second.body.order.dispatchVersion)).toBe(false);
  newJobs.onModuleDestroy();
});
test("dispatch lifecycle: versioned old cards cannot claim a later open round and refreshed cards lose buttons", async () => {
  const f = await fixture(), external = await bind(f.companion.id);
  const first = await dispatch(f, "OPEN"); const second = await dispatch(f, "DIRECT"); const third = await dispatch(f, "OPEN");
  expect([first.status, second.status, third.status]).toEqual([200, 200, 200]);
  await expect(orders.acceptOrderFromPlatform("KOOK", f.order.id, external, undefined, first.body.order.dispatchVersion)).rejects.toThrow("Dispatch changed");
  for (let i = 0; i < 6; i++) if (!await jobs.processOne()) break;
  const refreshes = outbound.filter(item => item.url.endsWith("message/update"));
  expect(refreshes.length).toBeGreaterThan(0);
  expect(refreshes.every(item => !item.body.content.includes("return-val"))).toBe(true);
  await orders.acceptOrderFromPlatform("KOOK", f.order.id, external, undefined, third.body.order.dispatchVersion);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("ACCEPTED");
});
test("dispatch lifecycle: one companion racing two different open orders can hold only one", async () => {
  const f = await fixture();
  const second = await orders.createOrder(f.customer.id, { requestId: randomUUID(), game: "DELTA_FORCE", mode: "娱乐", hours: "1", companionId: f.companion.id });
  expect((await dispatch(f, "OPEN")).status).toBe(200);
  expect((await dispatch({ ...f, order: second }, "OPEN")).status).toBe(200);
  const outcomes = await Promise.all([act(f.order.id, "accept", f.companion), act(second.id, "accept", f.companion)]);
  expect(outcomes.map(r => r.status).sort()).toEqual([200, 400]);
  expect(await prisma.order.count({ where: { companionId: f.companion.id, status: "ACCEPTED" } })).toBe(1);
});
test("dispatch lifecycle: two contenders for one normally published open order produce one winner", async () => {
  const f = await fixture(), other = await user("COMPANION");
  expect((await dispatch(f, "OPEN")).status).toBe(200);
  const outcomes = await Promise.all([act(f.order.id, "accept", f.companion), act(f.order.id, "accept", other)]);
  expect(outcomes.map(r => r.status).sort()).toEqual([200, 400]);
  expect(await prisma.orderStatusLog.count({ where: { orderId: f.order.id, toStatus: "ACCEPTED" } })).toBe(1);
});
test("dispatch lifecycle: non-admin and invalid dispatch inputs do not alter the funded order", async () => {
  const f = await fixture();
  expect((await call("PATCH", `/admin/orders/${f.order.id}/dispatch`, f.customer, { mode: "OPEN", reason: "unauthorized" })).status).toBe(403);
  for (const extra of [{ reason: "" }, { acceptanceDeadline: "invalid" }, { acceptanceDeadline: new Date(0).toISOString() }, { companionId: f.companion.id }]) {
    expect((await dispatch(f, "OPEN", extra)).status).toBe(400);
  }
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("PAID");
  expect((await call("POST", "/admin/orders/expire-assignments", f.admin)).status).toBe(201);
});

test("dispatch lifecycle: assignment request replay does not republish or bypass UNKNOWN review", async () => {
  const f = await fixture();
  let kookPosts = 0;
  const success = (global.fetch as jest.Mock).getMockImplementation()!;
  (global.fetch as jest.Mock).mockImplementation(async (url: string, init: RequestInit) => {
    if (url.endsWith("message/create")) { kookPosts++; throw new Error("synthetic ACK lost after platform accepted"); }
    return success(url, init);
  });
  for (let i = 0; i < 5; i++) {
    const result = await dispatch(f, "DIRECT"); expect(result.status).toBe(200); expect(result.body.order.dispatchVersion).toBe(1);
  }
  expect(kookPosts).toBe(1);
  const delivery = await prisma.notificationDelivery.findFirstOrThrow({ where: { platform: "KOOK" } });
  expect(delivery.status).toBe("UNKNOWN"); expect(delivery.jobKey).toBe(`order-dispatch:${f.order.id}:1`);
  expect((await prisma.integrationJob.findUniqueOrThrow({ where: { key: delivery.jobKey! } })).status).toBe("UNKNOWN");
  expect(await prisma.orderStatusLog.count({ where: { orderId: f.order.id, toStatus: "ASSIGNED" } })).toBe(1);
  expect(await prisma.walletTransaction.count({ where: { referenceId: f.order.id, type: "ORDER_PAYMENT" } })).toBe(1);
  const reviewed = await call("PATCH", `/admin/operations/deliveries/${delivery.id}/reconcile`, f.admin, { decision: "SENT", evidence: "synthetic moderator verified platform receipt", messageId: "synthetic-reviewed-receipt" });
  expect(reviewed.status).toBe(200);
  expect((await prisma.integrationJob.findUniqueOrThrow({ where: { key: delivery.jobKey! } })).status).toBe("RECONCILED");
  expect((await dispatch(f, "DIRECT")).status).toBe(200);
  expect(kookPosts).toBe(1);
});

test("dispatch privacy: selected and failed draft notices never interpolate private mode or reason", async () => {
  const admin = await user("ADMIN"), companion = await user("COMPANION"), marker = "SYNTHETIC-PRIVATE-PAYMENT-ACCOUNT";
  Object.assign(process.env, { KOOK_DISPATCH_CHANNEL_ID: "synthetic-kook", DISCORD_DISPATCH_CHANNEL_ID: "synthetic-discord" });
  const draft = await app.get(OrderDraftsService).createDraft(admin.id, { sourcePlatform: "WEB", mode: marker, note: marker });
  await prisma.orderDraft.update({ where: { id: draft.id }, data: { selectedCompanionId: companion.id } });
  await app.get(BotNotificationService).sendOrderDraftSelectedCompanionNotification(draft.id, companion.id);
  await app.get(BotNotificationService).sendOrderDraftFailedNotification(draft.id, marker);
  expect(outbound.length).toBe(4); expect(JSON.stringify(outbound)).not.toContain(marker);
});

test("dispatch version guard: historical unversioned KOOK callback cannot accept a newer open round", async () => {
  const f = await fixture(), external = await bind(f.companion.id);
  await prisma.order.update({ where: { id: f.order.id }, data: { status: "ASSIGNED", dispatchVersion: 0 } });
  // Persisted/in-flight pre-upgrade action, independent of the new card generator.
  const historicalAction = `order.accept.${f.order.id}`;
  expect((await dispatch(f, "OPEN")).status).toBe(200);
  expect((await call("POST", "/kook/webhook", undefined, { verify_token: "synthetic-verify", d: { type: 255, channel_type: "GROUP", author_id: "1", msg_id: randomUUID(), extra: { type: "message_btn_click", body: { user_id: external, msg_id: randomUUID(), target_id: "synthetic-kook", value: historicalAction } } } })).status).toBe(200);
  for (let i = 0; i < 6; i++) if (!await jobs.processOne()) break;
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("ASSIGNED");
  expect(await prisma.orderStatusLog.count({ where: { orderId: f.order.id, toStatus: "ACCEPTED" } })).toBe(0);
  expect(await prisma.walletTransaction.count({ where: { referenceId: f.order.id, type: "ORDER_PAYMENT" } })).toBe(1);
});

test("dispatch version guard: version zero is explicit, missing or malformed versions fail on every accept API", async () => {
  const f = await fixture(), external = await bind(f.companion.id);
  process.env.BOT_INTERNAL_TOKEN = "synthetic-internal";
  await prisma.userExternalAccount.create({ data: { userId: f.companion.id, platform: "DISCORD", externalUserId: external } });
  await prisma.order.update({ where: { id: f.order.id }, data: { status: "ASSIGNED", dispatchVersion: 0 } });
  await app.get(BotNotificationService).sendOrderAssignedNotifications(f.order.id);
  const card = outbound.find(item => item.url.endsWith("message/create"))!.body.content;
  expect(card).toContain(`order.accept.${f.order.id}.0`);
  const legacy = { verify_token: "synthetic-verify", d: { type: 255, author_id: "1", msg_id: randomUUID(), extra: { type: "message_btn_click", body: { user_id: external, msg_id: randomUUID(), value: `order.accept.${f.order.id}` } } } };
  expect((await call("POST", "/kook/webhook", undefined, legacy)).status).toBe(200);
  for (let i = 0; i < 4; i++) if (!await jobs.processOne()) break;
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("ASSIGNED");
  for (const version of [undefined, null, "0", -1, 0.5, 9007199254740992]) {
    const body = { orderId: f.order.id, kookUserId: external, companionDiscordId: external, dispatchVersion: version };
    for (const platform of ["kook", "discord"]) {
      const rejected = await call("POST", `/${platform}/orders/accept`, undefined, body, { "x-bot-token": "synthetic-internal" });
      expect(rejected.status).toBe(400); expect(rejected.body.message).toContain("refresh");
    }
    expect((await call("PATCH", `/orders/${f.order.id}/accept`, f.companion, body)).status).toBe(400);
  }
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("ASSIGNED");
  const current = { orderId: f.order.id, kookUserId: external, dispatchVersion: 0 };
  expect((await call("POST", "/kook/orders/accept", undefined, current, { "x-bot-token": "synthetic-internal" })).status).toBe(201);
  expect((await call("POST", "/kook/orders/accept", undefined, current, { "x-bot-token": "synthetic-internal" })).status).toBe(201);
  expect(await prisma.orderStatusLog.count({ where: { orderId: f.order.id, toStatus: "ACCEPTED" } })).toBe(1);
});

test("dispatch version guard: old and malformed KOOK actions refuse, current action replays accept once", async () => {
  const f = await fixture(), external = await bind(f.companion.id);
  const first = await dispatch(f, "DIRECT"); const second = await dispatch(f, "OPEN");
  expect([first.status, second.status]).toEqual([200, 200]);
  const version = second.body.order.dispatchVersion;
  const event = (action: string) => ({ verify_token: "synthetic-verify", d: { type: 255, channel_type: "GROUP", author_id: "1", msg_id: randomUUID(), extra: { type: "message_btn_click", body: { user_id: external, msg_id: randomUUID(), target_id: "synthetic-kook", value: action } } } });
  const invalid = [String(first.body.order.dispatchVersion), "", "02", "2e0", "2.extra", "2\n", "-1", "9007199254740992"];
  for (const suffix of invalid) {
    const body = event(`order.accept.${f.order.id}.${suffix}`);
    expect((await call("POST", "/kook/webhook", undefined, body)).status).toBe(200);
    for (let i = 0; i < 6; i++) if (!await jobs.processOne()) break;
    expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("ASSIGNED");
  }
  expect(outbound.some(item => item.url.endsWith("direct-message/create") && item.body.content.includes("刷新订单"))).toBe(true);
  const current = event(`order.accept.${f.order.id}.${version}`);
  for (let i = 0; i < 5; i++) expect((await call("POST", "/kook/webhook", undefined, current)).status).toBe(200);
  for (let i = 0; i < 6; i++) if (!await jobs.processOne()) break;
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("ACCEPTED");
  expect(await prisma.orderStatusLog.count({ where: { orderId: f.order.id, toStatus: "ACCEPTED" } })).toBe(1);
  expect(await prisma.walletTransaction.count({ where: { referenceId: f.order.id, type: "ORDER_PAYMENT" } })).toBe(1);
});

test("dispatch version guard: stale or missing dispatch and decline requests cannot mutate a later round", async () => {
  const f = await fixture();
  const path = `/admin/orders/${f.order.id}/dispatch`;
  expect((await call("PATCH", path, f.admin, { mode: "DIRECT", companionId: f.companion.id, reason: "missing version" })).status).toBe(400);
  expect((await dispatch(f, "DIRECT")).status).toBe(200);
  const staleVersion = 1;
  expect((await dispatch(f, "OPEN")).status).toBe(200);
  expect((await dispatch(f, "DIRECT")).status).toBe(200);
  for (const version of [undefined, staleVersion]) {
    expect((await call("PATCH", path, f.admin, { mode: "OPEN", reason: "stale command", dispatchVersion: version })).status).toBe(400);
    expect((await call("PATCH", `/orders/${f.order.id}/decline`, f.companion, { reason: "stale decline", dispatchVersion: version })).status).toBe(400);
    expect((await call("PATCH", `/orders/${f.order.id}/accept`, f.companion, { dispatchVersion: version })).status).toBe(400);
  }
  const assigned = await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } });
  expect(assigned.dispatchVersion).toBe(3); expect(assigned.status).toBe("ASSIGNED");
  expect((await call("PATCH", `/orders/${f.order.id}/decline`, f.companion, { reason: "current decline", dispatchVersion: 3 })).status).toBe(200);
  expect((await call("PATCH", `/admin/orders/${f.order.id}/assign`, f.admin, { companionId: f.companion.id, dispatchVersion: 0 })).status).toBe(400);
  expect((await call("PATCH", `/admin/orders/${f.order.id}/assign`, f.admin, { companionId: f.companion.id, dispatchVersion: 4 })).status).toBe(200);
  await expect(orders.expireAssignment(f.order.id)).rejects.toThrow("refresh");
  expect(await prisma.walletTransaction.count({ where: { referenceId: f.order.id, type: "ORDER_PAYMENT" } })).toBe(1);
});

test("dispatch version guard: exact command retry creates no new assignment, competing stale command and actor fail", async () => {
  const f = await fixture(), otherAdmin = await user("ADMIN");
  const command = { mode: "DIRECT", companionId: f.companion.id, reason: "same reviewed command", dispatchVersion: 0 };
  const path = `/admin/orders/${f.order.id}/dispatch`;
  const first = await call("PATCH", path, f.admin, command); expect(first.status).toBe(200);
  const posts = outbound.filter(item => item.url.endsWith("message/create") || item.url.includes("discord.com/api/v10/channels") && item.method === "POST").length;
  for (let i = 0; i < 5; i++) expect((await call("PATCH", path, f.admin, command)).status).toBe(200);
  expect((await call("PATCH", path, otherAdmin, command)).status).toBe(400);
  expect((await call("PATCH", path, f.admin, { mode: "OPEN", reason: "competing command", dispatchVersion: 0 })).status).toBe(400);
  expect(outbound.filter(item => item.url.endsWith("message/create") || item.url.includes("discord.com/api/v10/channels") && item.method === "POST").length).toBe(posts);
  expect(await prisma.adminLog.count({ where: { entityId: f.order.id, action: "DISPATCH_ORDER" } })).toBe(1);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).dispatchVersion).toBe(1);
});

test("dispatch version guard: lost refresh-prompt ACK stays UNKNOWN without repeating the prompt or accepting", async () => {
  const f = await fixture(), external = await bind(f.companion.id);
  expect((await dispatch(f, "DIRECT")).status).toBe(200);
  let prompts = 0;
  const success = (global.fetch as jest.Mock).getMockImplementation()!;
  (global.fetch as jest.Mock).mockImplementation(async (url: string, init: RequestInit) => {
    if (url.endsWith("direct-message/create")) { prompts++; throw new Error("synthetic prompt delivered but ACK lost"); }
    return success(url, init);
  });
  const legacy = { verify_token: "synthetic-verify", d: { type: 255, author_id: "1", msg_id: randomUUID(), extra: { type: "message_btn_click", body: { user_id: external, msg_id: randomUUID(), value: `order.accept.${f.order.id}` } } } };
  for (let i = 0; i < 5; i++) {
    expect((await call("POST", "/kook/webhook", undefined, legacy)).status).toBe(200);
    for (let j = 0; j < 4; j++) if (!await jobs.processOne()) break;
  }
  expect(prompts).toBe(1);
  expect((await prisma.integrationJob.findFirstOrThrow({ where: { kind: "KOOK_EVENT" } })).status).toBe("UNKNOWN");
  expect((await prisma.notificationDelivery.findFirstOrThrow({ where: { path: "/api/v3/direct-message/create" } })).status).toBe("UNKNOWN");
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("ASSIGNED");
  expect(await prisma.orderStatusLog.count({ where: { orderId: f.order.id, toStatus: "ACCEPTED" } })).toBe(0);
});
