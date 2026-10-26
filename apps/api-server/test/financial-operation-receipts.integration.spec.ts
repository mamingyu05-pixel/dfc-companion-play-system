import { INestApplication, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { Prisma, UserRole } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { request } from "node:http";
import { QuickOrderController } from "../src/modules/admin/quick-order.controller";
import { JwtAuthGuard } from "../src/modules/auth/jwt-auth.guard";
import { RolesGuard } from "../src/modules/auth/roles.guard";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { WalletService } from "../src/modules/wallet/wallet.service";

const prisma = new PrismaService();
const ownedUsers: string[] = [];
const receiptKeys: string[] = [];
const notifications = { syncCustomerMembershipLevels: jest.fn().mockResolvedValue([]) } as unknown as BotNotificationService;
const orders = new OrdersService(prisma, notifications);
const wallet = new WalletService(prisma, notifications);
const quick = new QuickOrderController(prisma, orders, wallet);

@Module({
  imports: [JwtModule.register({})],
  controllers: [QuickOrderController],
  providers: [JwtAuthGuard, RolesGuard, { provide: PrismaService, useValue: prisma },
    { provide: OrdersService, useValue: orders }, { provide: WalletService, useValue: wallet }]
})
class QuickOrderHttpModule {}
let app: INestApplication;

type QuickReceipt = {
  outcome: "ORDER_CREATED" | "RECHARGE_COMMITTED_ORDER_NOT_CREATED";
  requestId: string;
  recharge: { id: string; amount: string; requestId: string; replayed: boolean } | null;
  order: { id: string; totalAmount: string } | null;
  error?: { message: string; orderOutcome: "NOT_COMMITTED" };
};

beforeAll(async () => {
  await prisma.$connect();
  app = await NestFactory.create(QuickOrderHttpModule, { logger: false, abortOnError: false });
  app.setGlobalPrefix("api");
  await app.listen(0, "127.0.0.1");
});
beforeEach(() => {
  // Dispatch delivery has separate coverage; this suite exercises real order/recharge transactions only.
  jest.spyOn(orders, "dispatchOrder").mockResolvedValue({} as never);
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  try {
    const userScope = { in: ownedUsers };
    const orderScope = { customerId: userScope };
    const ownedOrders = await prisma.order.findMany({ where: orderScope, select: { id: true } });
    await prisma.orderStatusLog.deleteMany({ where: { orderId: { in: ownedOrders.map(order => order.id) } } });
    await prisma.walletTransaction.deleteMany({ where: { userId: userScope } });
    await prisma.adminLog.deleteMany({ where: { actorId: userScope } });
    await prisma.orderRequestReceipt.deleteMany({ where: { key: { in: receiptKeys } } });
    await prisma.order.deleteMany({ where: orderScope });
    await prisma.rechargeRequest.deleteMany({ where: { customerId: userScope } });
    await prisma.withdrawalRequest.deleteMany({ where: { companionId: userScope } });
    await prisma.companionProfile.deleteMany({ where: { userId: userScope } });
    await prisma.wallet.deleteMany({ where: { userId: userScope } });
    await prisma.user.deleteMany({ where: { id: userScope } });
    expect(await prisma.user.count({ where: { id: userScope } })).toBe(0);
  } finally {
    await app?.close();
    await prisma.$disconnect();
  }
});

async function user(role: UserRole, availableIncome = "0") {
  const id = randomUUID();
  const row = await prisma.user.create({ data: {
    id, email: `${id}@synthetic.invalid`, displayName: id, displayNameKey: id, passwordHash: "synthetic-unusable", role,
    wallet: { create: { availableIncome } },
    ...(role === "COMPANION" ? { companionProfile: { create: {
      nickname: id, pricePerHour: "50", skillModes: [], status: "LISTED"
    } } } : {})
  } });
  ownedUsers.push(id);
  return row;
}

function requestId(customerId: string) {
  const id = randomUUID();
  receiptKeys.push(createHash("sha256").update(JSON.stringify(["ORDER", customerId, id])).digest("hex"));
  return id;
}

async function walletSql(userId: string) {
  const [row] = await prisma.$queryRaw<Array<{ availableBalance: Prisma.Decimal; frozenBalance: Prisma.Decimal; availableIncome: Prisma.Decimal; frozenIncome: Prisma.Decimal }>>`
    SELECT "availableBalance", "frozenBalance", "availableIncome", "frozenIncome" FROM "wallets" WHERE "userId" = ${userId}`;
  return row;
}

async function postQuickOrder(token: string, body: unknown) {
  const payload = JSON.stringify(body);
  return new Promise<{ status: number; body: QuickReceipt }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: app.getHttpServer().address().port,
      path: "/api/admin/quick-order", method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
        catch (error) { reject(error); }
      });
    });
    req.on("error", reject); req.end(payload);
  });
}

test("real admin guards and HTTP return 200 with a partial recharge receipt, then resume one order", async () => {
  const customer = await user("CUSTOMER"), staff = await user("ADMIN");
  const token = await app.get(JwtService).signAsync({ sub: staff.id, role: staff.role, sv: staff.sessionVersion }, { secret: process.env.JWT_SECRET });
  const body = { customerId: customer.id, kind: "HOURLY", mode: "synthetic http receipts", hours: "1", customUnitPrice: "80",
    expectedTotalAmount: "79", requestId: requestId(customer.id), topUp: { amount: "80", method: "WECHAT" } };
  const partial = await postQuickOrder(token, body);
  expect(partial.status).toBe(200);
  expect(partial.body).toMatchObject({ outcome: "RECHARGE_COMMITTED_ORDER_NOT_CREATED", requestId: body.requestId, order: null,
    recharge: { amount: "80.00", requestId: `${body.requestId}-topup` }, error: { orderOutcome: "NOT_COMMITTED" } });
  const [storedRecharge] = await prisma.$queryRaw<Array<{ id: string; amount: Prisma.Decimal }>>`
    SELECT "id", "amount" FROM "recharge_requests" WHERE "customerId" = ${customer.id}`;
  expect(partial.body.recharge!.id).toBe(storedRecharge.id);
  expect(partial.body.recharge!.amount).toBe(storedRecharge.amount.toFixed(2));
  const resumed = await postQuickOrder(token, { ...body, expectedTotalAmount: body.customUnitPrice });
  expect(resumed.status).toBe(200);
  expect(resumed.body).toMatchObject({ outcome: "ORDER_CREATED", recharge: { id: storedRecharge.id, replayed: true }, order: { totalAmount: "80.00" } });
  expect((await walletSql(customer.id)).frozenBalance.toFixed(2)).toBe(resumed.body.order!.totalAmount);
  expect(await prisma.order.count({ where: { customerId: customer.id } })).toBe(1);
  expect(await prisma.rechargeRequest.count({ where: { customerId: customer.id } })).toBe(1);
});

test("quick order returns the committed recharge receipt on price rejection, then reuses it through repricing and retry", async () => {
  const customer = await user("CUSTOMER"), staff = await user("ADMIN");
  const id = requestId(customer.id);
  const body = { customerId: customer.id, kind: "HOURLY", mode: "synthetic receipts", hours: "1", customUnitPrice: "80",
    expectedTotalAmount: "79", requestId: id, topUp: { amount: "80", method: "WECHAT" } };
  const partial = await quick.create(staff, body) as unknown as QuickReceipt;
  expect(partial).toMatchObject({ outcome: "RECHARGE_COMMITTED_ORDER_NOT_CREATED", requestId: id, order: null,
    recharge: { amount: body.topUp.amount + ".00", requestId: `${id}-topup`, replayed: false },
    error: { orderOutcome: "NOT_COMMITTED" } });
  expect(partial.error?.message).toContain("价格已变化");
  const [rechargeSql] = await prisma.$queryRaw<Array<{ id: string; amount: Prisma.Decimal; status: string }>>`
    SELECT "id", "amount", "status"::text FROM "recharge_requests" WHERE "customerId" = ${customer.id}`;
  expect(rechargeSql.id).toBe(partial.recharge!.id);
  expect(rechargeSql.amount.toFixed(2)).toBe(partial.recharge!.amount);
  expect(rechargeSql.status).toBe("APPROVED");
  const credited = await walletSql(customer.id);
  expect(credited.availableBalance.gte(rechargeSql.amount)).toBe(true);
  expect(credited.frozenBalance.toString()).toBe("0");
  expect(await prisma.order.count({ where: { customerId: customer.id } })).toBe(0);

  const replay = await quick.create(staff, body) as unknown as QuickReceipt;
  expect(replay).toMatchObject({ outcome: partial.outcome, requestId: id, recharge: { id: rechargeSql.id, replayed: true }, order: null });
  expect(await walletSql(customer.id)).toEqual(credited);

  const corrected = { ...body, expectedTotalAmount: body.customUnitPrice };
  const created = await quick.create(staff, corrected) as unknown as QuickReceipt;
  expect(created).toMatchObject({ outcome: "ORDER_CREATED", requestId: id, recharge: { id: rechargeSql.id, replayed: true }, order: { totalAmount: "80.00" } });
  const retried = await quick.create(staff, corrected) as unknown as QuickReceipt;
  expect(retried.order?.id).toBe(created.order!.id);
  const after = await walletSql(customer.id);
  expect(after.availableBalance.toString()).toBe(credited.availableBalance.sub(created.order!.totalAmount).toString());
  expect(after.frozenBalance.toFixed(2)).toBe(created.order!.totalAmount);
  expect(after.availableBalance.add(after.frozenBalance).eq(credited.availableBalance)).toBe(true);
  expect(await prisma.order.count({ where: { customerId: customer.id } })).toBe(1);
  expect(await prisma.rechargeRequest.count({ where: { customerId: customer.id } })).toBe(1);
  expect(await prisma.walletTransaction.count({ where: { userId: customer.id, type: "RECHARGE_APPROVED" } })).toBe(1);
});

test("an unknown error after a real order commit is not reported as order-not-created and the original request recovers once", async () => {
  const customer = await user("CUSTOMER"), staff = await user("ADMIN");
  const body = { customerId: customer.id, kind: "HOURLY", mode: "synthetic unknown", hours: "1", customUnitPrice: "80",
    expectedTotalAmount: "80", requestId: requestId(customer.id), topUp: { amount: "80", method: "WECHAT" } };
  const create = orders.createOrder.bind(orders);
  jest.spyOn(orders, "createOrder").mockImplementationOnce(async (customerId, input) => {
    await create(customerId, input);
    throw new Error("Synthetic lost order commit acknowledgement");
  });
  await expect(quick.create(staff, body)).rejects.toThrow("Synthetic lost order commit acknowledgement");
  const [saved] = await prisma.order.findMany({ where: { customerId: customer.id } });
  expect(saved.totalAmount.toFixed(2)).toBe(body.expectedTotalAmount + ".00");
  const beforeRetry = await walletSql(customer.id);
  const recovered = await quick.create(staff, body) as unknown as QuickReceipt;
  expect(recovered).toMatchObject({ outcome: "ORDER_CREATED", requestId: body.requestId, order: { id: saved.id }, recharge: { replayed: true } });
  expect(await walletSql(customer.id)).toEqual(beforeRetry);
  expect(await prisma.order.count({ where: { customerId: customer.id } })).toBe(1);
  expect(await prisma.rechargeRequest.count({ where: { customerId: customer.id } })).toBe(1);
});

test("staff recharge recovery refuses changing the original credited principal", async () => {
  const customer = await user("CUSTOMER"), staff = await user("ADMIN");
  const body = { amount: "80", method: "WECHAT", requestId: randomUUID() };
  const first = await wallet.recordStaffRecharge(customer.id, staff.id, body);
  expect(first).toMatchObject({ requestId: body.requestId, replayed: false });
  const replay = await wallet.recordStaffRecharge(customer.id, staff.id, body);
  expect(replay).toMatchObject({ requestId: body.requestId, replayed: true, recharge: { id: first.recharge.id } });
  const before = await walletSql(customer.id);
  await expect(wallet.recordStaffRecharge(customer.id, staff.id, { ...body, amount: "81" })).rejects.toThrow("金额不一致");
  expect(await walletSql(customer.id)).toEqual(before);
  expect(await prisma.rechargeRequest.count({ where: { customerId: customer.id } })).toBe(1);
});

test.each([undefined, "", "   ", "\n\t", 42])("PAID rejects missing or blank/non-text payout reference %p without changing funds or status", async payoutReference => {
  const companion = await user("COMPANION", "80"), staff = await user("ADMIN");
  const request = await wallet.createWithdrawalRequest(companion.id, { amount: "40", payoutAccount: "synthetic-account", requestId: randomUUID() });
  await wallet.reviewWithdrawal(request.id, staff.id, { status: "APPROVED" });
  const before = await walletSql(companion.id);
  await expect(wallet.reviewWithdrawal(request.id, staff.id, { status: "PAID", payoutReference: payoutReference as string | undefined })).rejects.toThrow("打款流水号");
  expect((await prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("APPROVED");
  expect(await walletSql(companion.id)).toEqual(before);
  expect(await prisma.walletTransaction.count({ where: { userId: companion.id, type: "WITHDRAWAL_COMPLETED" } })).toBe(0);
});

test("PAID trims a real reference and only releases this request's frozen income once", async () => {
  const companion = await user("COMPANION", "80"), staff = await user("ADMIN");
  const request = await wallet.createWithdrawalRequest(companion.id, { amount: "40", payoutAccount: "synthetic-account", requestId: randomUUID() });
  await wallet.reviewWithdrawal(request.id, staff.id, { status: "APPROVED" });
  const result = await wallet.reviewWithdrawal(request.id, staff.id, { status: "PAID", payoutReference: "  synthetic-transfer-123  " });
  expect(result).toMatchObject({ status: "PAID", payoutReference: "synthetic-transfer-123" });
  const [stored] = await prisma.$queryRaw<Array<{ status: string; payoutReference: string; amount: Prisma.Decimal }>>`
    SELECT "status"::text, "payoutReference", "amount" FROM "withdrawal_requests" WHERE "id" = ${request.id}`;
  expect(stored.status).toBe(result.status); expect(stored.payoutReference).toBe(result.payoutReference);
  expect(stored.amount.eq(result.amount)).toBe(true);
  const after = await walletSql(companion.id);
  expect(after.availableIncome.toString()).toBe(new Prisma.Decimal("80").sub(stored.amount).toString());
  expect(after.frozenIncome.toString()).toBe("0");
  await expect(wallet.reviewWithdrawal(request.id, staff.id, { status: "PAID", payoutReference: "synthetic-transfer-123" })).rejects.toThrow();
  expect(await walletSql(companion.id)).toEqual(after);
  expect(await prisma.walletTransaction.count({ where: { userId: companion.id, type: "WITHDRAWAL_COMPLETED" } })).toBe(1);
});

test("APPROVED and REJECTED retain their existing optional-reference behavior", async () => {
  const companion = await user("COMPANION", "80"), staff = await user("ADMIN");
  const first = await wallet.createWithdrawalRequest(companion.id, { amount: "20", payoutAccount: "synthetic-account", requestId: randomUUID() });
  const second = await wallet.createWithdrawalRequest(companion.id, { amount: "20", payoutAccount: "synthetic-account", requestId: randomUUID() });
  expect((await wallet.reviewWithdrawal(first.id, staff.id, { status: "APPROVED" })).status).toBe("APPROVED");
  expect((await wallet.reviewWithdrawal(second.id, staff.id, { status: "REJECTED" })).status).toBe("REJECTED");
  const after = await walletSql(companion.id);
  expect(after.availableIncome.toString()).toBe(new Prisma.Decimal("80").sub(first.amount).toString());
  expect(after.frozenIncome.eq(first.amount)).toBe(true);
});
