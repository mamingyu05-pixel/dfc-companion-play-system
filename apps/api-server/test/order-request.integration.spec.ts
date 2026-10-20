// Run only through the guarded synthetic PostgreSQL integration-test setup.
// This file was added without starting PostgreSQL or executing a migration.
import { randomUUID } from "node:crypto";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";

const prisma = new PrismaService();
const notifications = { sendOrderAssignedNotifications: jest.fn(async () => ({})) };
const orders = new OrdersService(prisma, notifications as unknown as BotNotificationService);
beforeAll(() => prisma.$connect());
afterAll(() => prisma.$disconnect());
beforeEach(() => notifications.sendOrderAssignedNotifications.mockClear());

async function fixture(balance = "1000") {
  const create = async (role: "CUSTOMER" | "COMPANION" | "ADMIN") => {
    const id = randomUUID();
    return prisma.user.create({ data: { email: `${id}@synthetic.invalid`, displayName: id, displayNameKey: id,
      passwordHash: "synthetic-unusable", role, wallet: { create: { availableBalance: balance } },
      ...(role === "COMPANION" ? { companionProfile: { create: { nickname: "Synthetic", skillModes: [], pricePerHour: "100", commissionRate: "0.2", status: "LISTED" } } } : {}) } });
  };
  return { customer: await create("CUSTOMER"), companion: await create("COMPANION"), admin: await create("ADMIN") };
}

test("four concurrent identical requests create one order and one frozen payment", async () => {
  const f = await fixture();
  const body = { requestId: randomUUID(), mode: "娱乐", hours: "1", companionId: f.companion.id };
  const results = await Promise.all(Array.from({ length: 4 }, () => orders.createOrder(f.customer.id, body)));
  expect(new Set(results.map(order => order.id)).size).toBe(1);
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: f.customer.id } });
  expect(wallet.availableBalance.toString()).toBe("900"); expect(wallet.frozenBalance.toString()).toBe("100");
  expect(await prisma.walletTransaction.count({ where: { referenceId: results[0].id, type: "ORDER_PAYMENT" } })).toBe(1);
  await expect(orders.createOrder(f.customer.id, { ...body, hours: "2" })).rejects.toThrow("different order request");
});

test("direct group response replay does not debit or notify again", async () => {
  const f = await fixture();
  const body = { requestId: randomUUID(), mode: "娱乐", hours: "1", companionIds: [f.companion.id], assignedById: f.admin.id };
  const first = await orders.createOrderGroup(f.customer.id, body);
  const second = await orders.createOrderGroup(f.customer.id, body);
  expect(first.orderGroup.id).toBe(second.orderGroup.id); expect(second.requestReplayed).toBe(true);
  expect(notifications.sendOrderAssignedNotifications).toHaveBeenCalledTimes(1);
  expect(await prisma.walletTransaction.count({ where: { referenceId: first.orderGroup.id, type: "ORDER_PAYMENT" } })).toBe(1);
});

test("insufficient balance rolls back the claim and the same request succeeds after synthetic funding", async () => {
  const f = await fixture("0");
  const body = { requestId: randomUUID(), mode: "娱乐", hours: "1", companionId: f.companion.id };
  await expect(orders.createOrder(f.customer.id, body)).rejects.toThrow("Insufficient balance");
  await prisma.wallet.update({ where: { userId: f.customer.id }, data: { availableBalance: "100" } });
  const order = await orders.createOrder(f.customer.id, body);
  expect(await prisma.walletTransaction.count({ where: { referenceId: order.id, type: "ORDER_PAYMENT" } })).toBe(1);
});

test("connection_limit=1 supports transaction pricing, duplicate retries and direct-group discount reads", async () => {
  const f = await fixture();
  const database = new URL(process.env.DATABASE_URL!);
  if (process.env.DFC_TEST_MODE !== "1" || !["127.0.0.1", "localhost"].includes(database.hostname) || database.pathname !== "/dfc_synthetic") {
    throw new Error("Single-connection regression requires the isolated synthetic database");
  }
  database.searchParams.set("connection_limit", "1");
  database.searchParams.set("pool_timeout", "2");
  const single = new PrismaService({ datasources: { db: { url: database.toString() } } });
  const service = new OrdersService(single, notifications as unknown as BotNotificationService);
  try {
    await single.$connect();
    const body = { requestId: randomUUID(), mode: "娱乐", hours: "1", companionId: f.companion.id,
      priceTier: "CUSTOM" as const, customUnitPrice: "100" };
    const results = await Promise.all(Array.from({ length: 4 }, () => service.createOrder(f.customer.id, body)));
    expect(new Set(results.map(order => order.id)).size).toBe(1);
    const group = await service.createOrderGroup(f.customer.id, { requestId: randomUUID(), mode: "娱乐", hours: "1",
      companionIds: [f.companion.id], assignedById: f.admin.id, priceTier: "CUSTOM", customUnitPrice: "100" });
    expect(group.orderGroup.totalAmount.toString()).toBe("100");
    const wallet = await single.wallet.findUniqueOrThrow({ where: { userId: f.customer.id } });
    expect(wallet.availableBalance.toString()).toBe("800");
    expect(wallet.frozenBalance.toString()).toBe("200");
    expect(await single.walletTransaction.count({ where: { userId: f.customer.id, type: "ORDER_PAYMENT" } })).toBe(2);
  } finally {
    await single.$disconnect();
  }
});
