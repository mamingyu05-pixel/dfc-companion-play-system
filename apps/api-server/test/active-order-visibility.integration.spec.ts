import { randomUUID } from "node:crypto";
import { OrderStatus, UserRole } from "@prisma/client";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";

const prisma = new PrismaService();
const orders = new OrdersService(prisma, {} as BotNotificationService);
const ownedUsers: string[] = [], ownedOrders: string[] = [];
const fixtureMode = `synthetic visibility ${randomUUID()}`;
const activeStatuses: OrderStatus[] = ["PENDING_PAYMENT", "PAID", "ASSIGNED", "ACCEPTED", "IN_PROGRESS",
  "AWAITING_ACCEPTANCE", "REFUND_REQUESTED", "DISPUTED"];
const terminalStatuses: OrderStatus[] = ["COMPLETED", "CANCELLED", "REFUNDED"];
beforeAll(() => prisma.$connect());
afterAll(async () => {
  try {
    await prisma.order.deleteMany({ where: { id: { in: ownedOrders }, mode: fixtureMode } });
    await prisma.user.deleteMany({ where: { id: { in: ownedUsers } } });
  } finally { await prisma.$disconnect(); }
});

async function user(role: UserRole) {
  const id = randomUUID();
  const created = await prisma.user.create({ data: { email: `${id}@synthetic.invalid`, displayName: id, displayNameKey: id,
    passwordHash: "synthetic", role } });
  ownedUsers.push(created.id);
  return created;
}

function row(customerId: string, companionId: string, status: OrderStatus, createdAt: Date) {
  const id = randomUUID();
  ownedOrders.push(id);
  return { id, orderNo: randomUUID(), customerId, companionId, status, createdAt,
    game: "DELTA_FORCE" as const, mode: fixtureMode, hours: "1", unitPrice: "100", totalAmount: "100" };
}

async function fixture(activeCount = activeStatuses.length, historyCount = 201) {
  const customer = await user("CUSTOMER"), companion = await user("COMPANION");
  const otherCustomer = await user("CUSTOMER"), otherCompanion = await user("COMPANION");
  const active = Array.from({ length: activeCount }, (_, index) => row(customer.id, companion.id,
    activeStatuses[index % activeStatuses.length], new Date(Date.UTC(2025, 0, 1, 0, 0, index))));
  const history = Array.from({ length: historyCount }, (_, index) => row(customer.id, companion.id,
    terminalStatuses[index % terminalStatuses.length], new Date(Date.UTC(2026, 0, 1, 0, 0, index))));
  const foreign = row(otherCustomer.id, otherCompanion.id, "IN_PROGRESS", new Date("2027-01-01T00:00:00Z"));
  await prisma.order.createMany({ data: [...active, ...history, foreign] });
  return { customer, companion, otherCustomer, otherCompanion, active, history, foreign };
}

function expectVisible(rows: Array<{ id: string; status: OrderStatus }>, active: Array<{ id: string }>, history: Array<{ id: string }>) {
  const ids = new Set(rows.map(value => value.id));
  expect(active.every(value => ids.has(value.id))).toBe(true);
  expect(rows).toHaveLength(active.length + 200);
  expect(ids.size).toBe(rows.length);
  expect(rows.filter(value => terminalStatuses.includes(value.status))).toHaveLength(200);
  expect(ids.has(history[0].id)).toBe(false);
  expect(history.slice(1).every(value => ids.has(value.id))).toBe(true);
}

test("customer list retains every old activity behind 201 newer terminal orders and bounds only history", async () => {
  const f = await fixture(), rows = await orders.listCustomerOrders(f.customer.id);
  console.info("ACTIVE_ORDER_VISIBILITY_OBSERVATION " + JSON.stringify({ scope: "customer", totalReturned: rows.length,
    oldActiveExpected: f.active.length, oldActiveReturned: rows.filter(value => f.active.some(active => active.id === value.id)).length }));
  expectVisible(rows, f.active, f.history);
  expect(rows.every(value => value.customerId === f.customer.id)).toBe(true);
  expect(rows.some(value => value.id === f.foreign.id)).toBe(false);
  expect(JSON.stringify(rows)).not.toContain(f.companion.email);
  expect(rows.find(value => value.status === "AWAITING_ACCEPTANCE")).toHaveProperty("autoAcceptanceHours");
});

test("companion list retains every old activity behind 201 newer terminal orders without exposing customer contacts", async () => {
  const f = await fixture(), rows = await orders.listCompanionOrders(f.companion.id);
  console.info("ACTIVE_ORDER_VISIBILITY_OBSERVATION " + JSON.stringify({ scope: "companion", totalReturned: rows.length,
    oldActiveExpected: f.active.length, oldActiveReturned: rows.filter(value => f.active.some(active => active.id === value.id)).length }));
  expectVisible(rows, f.active, f.history);
  expect(rows.every(value => value.companionId === f.companion.id)).toBe(true);
  expect(rows.some(value => value.id === f.foreign.id)).toBe(false);
  expect(JSON.stringify(rows)).not.toContain(f.customer.email);
});

test("more than 200 activities remain visible while terminal history stays limited to 200", async () => {
  const f = await fixture(205);
  expectVisible(await orders.listCustomerOrders(f.customer.id), f.active, f.history);
  expectVisible(await orders.listCompanionOrders(f.companion.id), f.active, f.history);
});

test("terminal-only lists remain bounded and tied timestamps have a stable id order", async () => {
  const f = await fixture(0);
  const tiedAt = new Date("2026-02-01T00:00:00Z");
  await prisma.order.updateMany({ where: { customerId: f.customer.id }, data: { createdAt: tiedAt } });
  const expected = f.history.map(value => value.id).sort().reverse().slice(0, 200);
  const customer = await orders.listCustomerOrders(f.customer.id), companion = await orders.listCompanionOrders(f.companion.id);
  expect(customer.map(value => value.id)).toEqual(expected);
  expect(companion.map(value => value.id)).toEqual(expected);
  expect((await orders.listCustomerOrders(f.customer.id)).map(value => value.id)).toEqual(expected);
});

test("customer and companion membership predicates remain independent and empty identities return no orders", async () => {
  const f = await fixture(0, 0);
  const customerOnly = row(f.customer.id, f.otherCompanion.id, "DISPUTED", new Date());
  const companionOnly = row(f.otherCustomer.id, f.companion.id, "IN_PROGRESS", new Date());
  await prisma.order.createMany({ data: [customerOnly, companionOnly] });
  expect((await orders.listCustomerOrders(f.customer.id)).map(value => value.id)).toEqual([customerOnly.id]);
  expect((await orders.listCompanionOrders(f.companion.id)).map(value => value.id)).toEqual([companionOnly.id]);
  expect(await orders.listCustomerOrders(randomUUID())).toEqual([]);
  expect(await orders.listCompanionOrders(randomUUID())).toEqual([]);
});
