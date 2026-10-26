import { INestApplication, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { Prisma, UserRole } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { request } from "node:http";
import { AdminController } from "../src/modules/admin/admin.controller";
import { CompanionExternalAccountsService } from "../src/modules/admin/companion-external-accounts.service";
import { JwtAuthGuard } from "../src/modules/auth/jwt-auth.guard";
import { RolesGuard } from "../src/modules/auth/roles.guard";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";
import { OrderDraftsService } from "../src/modules/orders/order-drafts.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { WalletService } from "../src/modules/wallet/wallet.service";

const prisma = new PrismaService();
const wallet = new WalletService(prisma, {} as BotNotificationService);
const ownedUsers: string[] = [];
const ownedOrderReceipts: string[] = [];
type Adjustment = { amount: string; direction?: "CREDIT" | "DEBIT"; note?: string; requestId?: unknown };

@Module({
  imports: [JwtModule.register({})],
  controllers: [AdminController],
  providers: [JwtAuthGuard, RolesGuard, { provide: PrismaService, useValue: prisma },
    { provide: WalletService, useValue: wallet }, { provide: OrdersService, useValue: {} },
    { provide: OrderDraftsService, useValue: {} }, { provide: CompanionExternalAccountsService, useValue: {} }]
})
class ManualAdjustmentHttpModule {}

let app: INestApplication;
beforeAll(async () => {
  await prisma.$connect();
  app = await NestFactory.create(ManualAdjustmentHttpModule, { logger: false, abortOnError: false });
  app.setGlobalPrefix("api");
  await app.listen(0, "127.0.0.1");
});
afterAll(async () => {
  try {
    const users = { in: ownedUsers };
    const orders = await prisma.order.findMany({ where: { customerId: users }, select: { id: true } });
    await prisma.orderStatusLog.deleteMany({ where: { orderId: { in: orders.map(order => order.id) } } });
    await prisma.walletTransaction.deleteMany({ where: { userId: users } });
    await prisma.adminLog.deleteMany({ where: { actorId: users } });
    await prisma.orderRequestReceipt.deleteMany({ where: { key: { in: ownedOrderReceipts } } });
    await prisma.order.deleteMany({ where: { customerId: users } });
    await prisma.wallet.deleteMany({ where: { userId: users } });
    await prisma.user.deleteMany({ where: { id: users } });
    expect(await prisma.user.count({ where: { id: users } })).toBe(0);
  } finally {
    await app?.close();
    await prisma.$disconnect();
  }
});

async function user(role: UserRole, balance: string | null = "0") {
  const id = randomUUID(), name = `manual-adjustment-${id}`;
  const row = await prisma.user.create({ data: {
    id, email: `${name}@synthetic.invalid`, displayName: name, displayNameKey: name, passwordHash: "synthetic-unusable", role,
    ...(balance === null ? {} : { wallet: { create: { availableBalance: balance } } })
  } });
  ownedUsers.push(id);
  return row;
}

async function balanceSql(customerId: string) {
  const [row] = await prisma.$queryRaw<Array<{ availableBalance: Prisma.Decimal; frozenBalance: Prisma.Decimal }>>`
    SELECT "availableBalance", "frozenBalance" FROM "wallets" WHERE "userId" = ${customerId}`;
  return row;
}

async function assertOneAdjustment(customerId: string, operatorId: string, amount: string, direction: "CREDIT" | "DEBIT") {
  const [row] = await prisma.$queryRaw<Array<{ count: bigint; total: Prisma.Decimal }>>`
    SELECT COUNT(*) AS "count", COALESCE(SUM("amount"), 0) AS "total" FROM "wallet_transactions"
    WHERE "userId" = ${customerId} AND "type" = 'ADMIN_ADJUSTMENT'`;
  expect(Number(row.count)).toBe(1);
  expect(row.total.eq(amount)).toBe(true);
  expect(await prisma.adminLog.count({ where: { actorId: operatorId, targetUserId: customerId,
    action: direction === "CREDIT" ? "ADMIN_CREDIT_BALANCE" : "ADMIN_DEBIT_BALANCE" } })).toBe(1);
}

async function post(customerId: string, token: string, body: Adjustment, loseResponse = false) {
  const payload = JSON.stringify(body);
  return new Promise<{ status: number; body: Record<string, any> }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: app.getHttpServer().address().port,
      method: "POST", path: `/api/admin/users/${customerId}/balance-adjustments`,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, res => {
      if (loseResponse) {
        // Nest sends response headers only after the real controller transaction has returned.
        res.resume(); reject(new Error("Synthetic response lost after commit")); return;
      }
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

test.each(["CREDIT", "DEBIT"] as const)("the same %s HTTP request changes balance and audit ledger only once", async direction => {
  const initial = new Prisma.Decimal("100.10"), amount = new Prisma.Decimal("30.05");
  const customer = await user("CUSTOMER", initial.toString()), admin = await user("ADMIN");
  const token = await app.get(JwtService).signAsync({ sub: admin.id, role: admin.role, sv: admin.sessionVersion }, { secret: process.env.JWT_SECRET });
  const body = { amount: amount.toString(), direction, note: "synthetic manual adjustment", requestId: randomUUID() };
  const first = await post(customer.id, token, body), replay = await post(customer.id, token, body);
  expect(first.status).toBe(201); expect(replay.status).toBe(201);
  const stored = await balanceSql(customer.id), expected = direction === "CREDIT" ? initial.add(amount) : initial.sub(amount);
  expect(stored.availableBalance.toFixed(2)).toBe(expected.toFixed(2));
  expect(stored.frozenBalance.toString()).toBe("0");
  expect(first.body).toMatchObject({ requestId: body.requestId, customerId: customer.id, direction, replayed: false });
  expect(replay.body).toMatchObject({ requestId: body.requestId, customerId: customer.id, direction, replayed: true,
    transaction: { id: first.body.transaction.id, amount: first.body.transaction.amount, balanceAfter: first.body.transaction.balanceAfter } });
  expect(new Prisma.Decimal(replay.body.transaction.balanceAfter).eq(stored.availableBalance)).toBe(true);
  await assertOneAdjustment(customer.id, admin.id, body.amount, direction);
});

test.each(["CREDIT", "DEBIT"] as const)("eight concurrent identical %s requests all return the same persisted receipt", async direction => {
  const initial = new Prisma.Decimal("100.10"), amount = new Prisma.Decimal("30.05");
  const customer = await user("CUSTOMER", initial.toString()), admin = await user("ADMIN");
  const body = { requestId: randomUUID(), amount: amount.toString(), direction, note: "synthetic concurrency" };
  const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => wallet.adminCreditCustomerBalance(customer.id, admin.id, body)));
  const expected = direction === "CREDIT" ? initial.add(amount) : initial.sub(amount), stored = await balanceSql(customer.id);
  expect(stored.availableBalance.toFixed(2)).toBe(expected.toFixed(2));
  expect(attempts.every(attempt => attempt.status === "fulfilled")).toBe(true);
  const results = attempts.map(attempt => {
    if (attempt.status !== "fulfilled") throw attempt.reason;
    return attempt.value;
  });
  expect(new Set(results.map(result => result.transaction.id)).size).toBe(1);
  expect(results.filter(result => (result as unknown as { replayed: boolean }).replayed === false)).toHaveLength(1);
  await assertOneAdjustment(customer.id, admin.id, body.amount, direction);
});

test.each(["customer", "amount", "direction", "note", "operator"] as const)("reusing a committed request id with a different %s is rejected without another adjustment", async field => {
  const customer = await user("CUSTOMER", "100"), otherCustomer = await user("CUSTOMER", "100");
  const admin = await user("ADMIN"), otherAdmin = await user("ADMIN");
  const body: Adjustment = { requestId: randomUUID(), amount: "10", direction: "CREDIT", note: "original reason" };
  await wallet.adminCreditCustomerBalance(customer.id, admin.id, body);
  const before = await balanceSql(customer.id), otherBefore = await balanceSql(otherCustomer.id);
  const changed = { ...body, ...(field === "amount" ? { amount: "11" } : {}),
    ...(field === "direction" ? { direction: "DEBIT" as const } : {}), ...(field === "note" ? { note: "another reason" } : {}) };
  await expect(wallet.adminCreditCustomerBalance(field === "customer" ? otherCustomer.id : customer.id,
    field === "operator" ? otherAdmin.id : admin.id, changed)).rejects.toThrow("原调账申请");
  expect(await balanceSql(customer.id)).toEqual(before); expect(await balanceSql(otherCustomer.id)).toEqual(otherBefore);
  await assertOneAdjustment(customer.id, admin.id, body.amount, "CREDIT");
});

test("equivalent decimal text, default direction and trimmed reason replay the original effective payload", async () => {
  const customer = await user("CUSTOMER"), admin = await user("ADMIN"), requestId = randomUUID();
  const first = await wallet.adminCreditCustomerBalance(customer.id, admin.id, { requestId, amount: "10", note: "  same reason  " } as Adjustment);
  const replay = await wallet.adminCreditCustomerBalance(customer.id, admin.id, { requestId, amount: "10.00", direction: "CREDIT", note: "same reason" } as Adjustment);
  expect((await balanceSql(customer.id)).availableBalance.toString()).toBe("10");
  expect(replay.transaction.id).toBe(first.transaction.id);
  expect((await prisma.walletTransaction.findUniqueOrThrow({ where: { id: first.transaction.id } })).note).toBe("same reason");
});

test("after real HTTP response loss a fresh service instance restores the same committed receipt", async () => {
  const customer = await user("CUSTOMER"), admin = await user("ADMIN");
  const token = await app.get(JwtService).signAsync({ sub: admin.id, role: admin.role, sv: admin.sessionVersion }, { secret: process.env.JWT_SECRET });
  const body = { requestId: randomUUID(), amount: "20.25", direction: "CREDIT" as const, note: "synthetic lost response" };
  await expect(post(customer.id, token, body, true)).rejects.toThrow("Synthetic response lost after commit");
  const committed = await prisma.walletTransaction.findFirstOrThrow({ where: { userId: customer.id, type: "ADMIN_ADJUSTMENT" } });
  const restored = await new WalletService(prisma, {} as BotNotificationService).adminCreditCustomerBalance(customer.id, admin.id, body);
  expect((await balanceSql(customer.id)).availableBalance.toString()).toBe(body.amount);
  expect(restored.transaction.id).toBe(committed.id);
  expect(restored).toMatchObject({ requestId: body.requestId, customerId: customer.id, direction: body.direction, replayed: true });
  await assertOneAdjustment(customer.id, admin.id, body.amount, body.direction);
});

test("two different genuine intents concurrently create one missing wallet and both valid credits", async () => {
  const customer = await user("CUSTOMER", null), admin = await user("ADMIN");
  const bodies = ["20", "30"].map(amount => ({ requestId: randomUUID(), amount, direction: "CREDIT" as const }));
  const results = await Promise.allSettled(bodies.map(body => wallet.adminCreditCustomerBalance(customer.id, admin.id, body)));
  expect(results.every(result => result.status === "fulfilled")).toBe(true);
  expect((await balanceSql(customer.id)).availableBalance.toString()).toBe(new Prisma.Decimal(bodies[0].amount).add(bodies[1].amount).toString());
  expect(await prisma.wallet.count({ where: { userId: customer.id } })).toBe(1);
  expect(await prisma.walletTransaction.count({ where: { userId: customer.id, type: "ADMIN_ADJUSTMENT" } })).toBe(bodies.length);
});

test("an insufficient debit rolls back without consuming a receipt or changing frozen funds", async () => {
  const customer = await user("CUSTOMER", "10"), admin = await user("ADMIN");
  await prisma.wallet.update({ where: { userId: customer.id }, data: { frozenBalance: "50" } });
  const before = await balanceSql(customer.id), body = { requestId: randomUUID(), amount: "11", direction: "DEBIT" as const };
  await expect(wallet.adminCreditCustomerBalance(customer.id, admin.id, body)).rejects.toThrow("Insufficient");
  expect(await balanceSql(customer.id)).toEqual(before);
  expect(await prisma.walletTransaction.count({ where: { userId: customer.id } })).toBe(0);
  expect(await prisma.adminLog.count({ where: { actorId: admin.id } })).toBe(0);
});

test("a missing request id is rejected before any manual adjustment", async () => {
  const customer = await user("CUSTOMER", "10"), admin = await user("ADMIN");
  await expect(wallet.adminCreditCustomerBalance(customer.id, admin.id, { amount: "1", direction: "CREDIT" })).rejects.toThrow("requestId");
  expect((await balanceSql(customer.id)).availableBalance.toString()).toBe("10");
  expect(await prisma.walletTransaction.count({ where: { userId: customer.id } })).toBe(0);
});

test("manual adjustment and order creation complete without a user-wallet foreign-key lock cycle", async () => {
  const customer = await user("CUSTOMER", "100"), admin = await user("ADMIN");
  const orderRequestId = randomUUID();
  ownedOrderReceipts.push(createHash("sha256").update(JSON.stringify(["ORDER", customer.id, orderRequestId])).digest("hex"));
  const barrier = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
  };
  const walletHeld = barrier(), userHeld = barrier(), releaseOrder = barrier();
  const instrumented = (kind: "order" | "adjustment") => ({
    $transaction: <T,>(action: (tx: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(async tx => {
      const wrapped = new Proxy(tx, {
        get(target, property) {
          if (kind === "order" && property === "wallet") return new Proxy(target.wallet, {
            get(delegate, method) {
              if (method === "updateMany") return async (input: Prisma.WalletUpdateManyArgs) => {
                const changed = await delegate.updateMany(input);
                if (changed.count === 1 && input.where?.userId === customer.id) {
                  walletHeld.resolve();
                  await releaseOrder.promise;
                }
                return changed;
              };
              return Reflect.get(delegate, method);
            }
          });
          if (kind === "adjustment" && property === "$queryRaw") return async (strings: TemplateStringsArray, ...values: unknown[]) => {
            const result = await target.$queryRaw(strings, ...values);
            const sql = strings.join("");
            if (sql.includes('FROM "users"') && sql.includes("FOR ")) userHeld.resolve();
            return result;
          };
          return Reflect.get(target, property);
        }
      });
      return action(wrapped);
    }, { timeout: 15000 })
  }) as unknown as PrismaService;
  const track = <T,>(promise: Promise<T>) => promise.then(value => ({ status: "fulfilled" as const, value }),
    reason => ({ status: "rejected" as const, reason }));
  const beforeBarrier = (waiting: Promise<void>, operation: Promise<{ status: string; reason?: unknown }>) =>
    Promise.race([waiting, operation.then(result => { throw result.reason ?? new Error("Operation missed the controlled lock barrier"); })]);
  const orderService = new OrdersService(instrumented("order"), {} as BotNotificationService);
  const adjustmentService = new WalletService(instrumented("adjustment"), {} as BotNotificationService);
  const order = track(orderService.createOrder(customer.id, { requestId: orderRequestId, mode: "synthetic lock order",
    hours: "1", priceTier: "CUSTOM", customUnitPrice: "80", expectedTotalAmount: "80" }));
  let adjustment: ReturnType<typeof track> | undefined;
  try {
    await beforeBarrier(walletHeld.promise, order);
    adjustment = track(adjustmentService.adminCreditCustomerBalance(customer.id, admin.id,
      { requestId: randomUUID(), amount: "10", direction: "CREDIT", note: "synthetic lock adjustment" }));
    await beforeBarrier(userHeld.promise, adjustment);
    releaseOrder.resolve();
    const outcomes = await Promise.all([order, adjustment]);
    console.log("MANUAL_ORDER_LOCK_OUTCOME", JSON.stringify(outcomes.map(result => result.status === "fulfilled"
      ? { status: result.status } : { status: result.status, code: result.reason?.code,
        databaseCode: /40P01/.test(String(result.reason?.message)) ? "40P01" : result.reason?.meta?.code,
        deadlock: /deadlock/i.test(String(result.reason?.message)) })));
    expect(outcomes.map(result => result.status)).toEqual(["fulfilled", "fulfilled"]);
    const stored = await balanceSql(customer.id);
    expect(stored.availableBalance.toString()).toBe(new Prisma.Decimal("100").sub("80").add("10").toString());
    expect(stored.frozenBalance.toString()).toBe("80");
    expect(await prisma.order.count({ where: { customerId: customer.id } })).toBe(1);
    expect(await prisma.walletTransaction.count({ where: { userId: customer.id, type: "ADMIN_ADJUSTMENT" } })).toBe(1);
    expect(await prisma.walletTransaction.count({ where: { userId: customer.id, type: "ORDER_PAYMENT" } })).toBe(1);
  } finally {
    releaseOrder.resolve();
    await order; await adjustment;
  }
});
