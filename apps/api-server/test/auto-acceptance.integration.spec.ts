import { OrderStatus } from "@prisma/client";
import { acceptanceHours, AUTO_ACCEPTANCE_HOURS } from "../src/modules/orders/acceptance-policy";
import { IntegrationJobsService } from "../src/modules/bot/integration-jobs.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { prisma, orders, notifications, fixture } from "./acceptance-review.fixture";

let previous: string | undefined;
beforeAll(async () => {
  await prisma.$connect();
  previous = (await prisma.platformSetting.findUnique({ where: { key: AUTO_ACCEPTANCE_HOURS } }))?.value;
});
beforeEach(async () => { await setHours("48"); });
afterAll(async () => {
  if (previous === undefined) await prisma.platformSetting.deleteMany({ where: { key: AUTO_ACCEPTANCE_HOURS } });
  else await setHours(previous);
  await prisma.$disconnect();
});
function setHours(value: string) {
  return prisma.platformSetting.upsert({ where: { key: AUTO_ACCEPTANCE_HOURS }, create: { key: AUTO_ACCEPTANCE_HOURS, value }, update: { value } });
}
const auto = (f: Awaited<ReturnType<typeof fixture>>) => orders.acceptCompletion(f.order.id, f.customer.id, "系统超时自动验收", undefined, true);

test("8: due completion uses normal settlement and records system audit", async () => {
  const f = await fixture();
  expect((await auto(f))?.status).toBe("COMPLETED");
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: f.companion.id } });
  expect(wallet.availableIncome.toString()).toBe("80");
  expect(wallet.pendingIncome.toString()).toBe("0");
  expect(await prisma.orderStatusLog.count({ where: { orderId: f.order.id, reason: "系统超时自动验收" } })).toBe(1);
  expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: f.customer.id } })).frozenBalance.toString()).toBe("0");
});

test.each([47, 0, -1])("8: not due at age %s hours does nothing", async age => {
  const f = await fixture("AWAITING_ACCEPTANCE", age);
  expect(await auto(f)).toBeNull();
  expect(await prisma.walletTransaction.count({ where: { referenceId: f.order.id } })).toBe(0);
});

test("8: exact 48 hour boundary is eligible", async () => {
  const f = await fixture("AWAITING_ACCEPTANCE", 48);
  expect((await auto(f))?.status).toBe("COMPLETED");
});

test.each(["RESOLVED", "REJECTED"] as const)("8: explicitly closed complaint %s allows auto acceptance", async status => {
  const f = await fixture();
  await prisma.complaint.create({ data: { orderId: f.order.id, reporterId: f.customer.id, reason: "synthetic", status } });
  expect((await auto(f))?.status).toBe("COMPLETED");
});

test("8: missing completion timestamp blocks, unrelated acceptanceDeadline is ignored", async () => {
  const f = await fixture();
  await prisma.order.update({ where: { id: f.order.id }, data: { reportedCompletedAt: null, acceptanceDeadline: new Date(0) } });
  expect(await auto(f)).toBeNull();
  await prisma.order.update({ where: { id: f.order.id }, data: { reportedCompletedAt: f.order.reportedCompletedAt, acceptanceDeadline: new Date(Date.now() + 3600000) } });
  expect((await auto(f))?.status).toBe("COMPLETED");
});

test.each(["OPEN", "IN_REVIEW"] as const)("8: %s complaint blocks even when status is still awaiting acceptance", async status => {
  const f = await fixture();
  await prisma.complaint.create({ data: { orderId: f.order.id, reporterId: f.customer.id, reason: "synthetic", status } });
  expect(await auto(f)).toBeNull();
  expect((await orders.listCustomerOrders(f.customer.id))[0].autoAcceptanceDueAt).toBeNull();
  expect(await prisma.walletTransaction.count({ where: { referenceId: f.order.id } })).toBe(0);
});

test.each(["DISPUTED", "CANCELLED", "REFUND_REQUESTED", "REFUNDED", "PAID", "IN_PROGRESS", "COMPLETED"] as OrderStatus[])("8: status %s cannot auto settle", async status => {
  const f = await fixture(status);
  expect(await auto(f)).toBeNull();
  expect(await prisma.walletTransaction.count({ where: { referenceId: f.order.id } })).toBe(0);
});

test("8: repeated and concurrent auto/manual acceptance settles exactly once", async () => {
  const f = await fixture();
  const results = await Promise.allSettled([auto(f), orders.acceptCompletion(f.order.id, f.customer.id), auto(f), auto(f)]);
  expect(results.filter(row => row.status === "fulfilled" && row.value !== null)).toHaveLength(1);
  expect(await auto(f)).toBeNull();
  expect(await prisma.walletTransaction.count({ where: { businessKey: `order-settlement-customer:${f.order.id}` } })).toBe(1);
  expect(await prisma.walletTransaction.count({ where: { businessKey: `order-pending-release:${f.order.id}` } })).toBe(1);
  expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: f.companion.id } })).availableIncome.toString()).toBe("80");
  expect(await prisma.orderStatusLog.count({ where: { orderId: f.order.id, toStatus: "COMPLETED" } })).toBe(1);
});

test("8: repeated system trigger keeps one settlement and one system audit record", async () => {
  const f = await fixture();
  expect((await auto(f))?.status).toBe("COMPLETED");
  expect(await auto(f)).toBeNull();
  expect(await auto(f)).toBeNull();
  expect(await prisma.walletTransaction.count({ where: { businessKey: `order-settlement-customer:${f.order.id}` } })).toBe(1);
  expect(await prisma.walletTransaction.count({ where: { businessKey: `order-pending-release:${f.order.id}` } })).toBe(1);
  expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: f.companion.id } })).availableIncome.toString()).toBe("80");
  const logs = await prisma.orderStatusLog.findMany({ where: { orderId: f.order.id, toStatus: "COMPLETED" } });
  expect(logs.map(log => log.reason)).toEqual(["系统超时自动验收"]);
});

test("8: unmocked scanner run twice settles only the due order", async () => {
  // Oldest first: the scanner takes 100 per run and other suites leave due orders behind.
  const due = await fixture("AWAITING_ACCEPTANCE", 5000), early = await fixture("AWAITING_ACCEPTANCE", 2), complained = await fixture();
  const cancelled = await fixture("CANCELLED"), refunded = await fixture("REFUNDED");
  await prisma.complaint.create({ data: { orderId: complained.order.id, reporterId: complained.customer.id, reason: "synthetic", status: "OPEN" } });
  const service = new OrdersService(prisma, notifications);
  await service.autoAcceptCompletions();
  await service.autoAcceptCompletions();
  expect((await prisma.order.findUniqueOrThrow({ where: { id: due.order.id } })).status).toBe("COMPLETED");
  expect(await prisma.walletTransaction.count({ where: { businessKey: `order-settlement-customer:${due.order.id}` } })).toBe(1);
  expect(await prisma.walletTransaction.count({ where: { businessKey: `order-pending-release:${due.order.id}` } })).toBe(1);
  expect(await prisma.orderStatusLog.count({ where: { orderId: due.order.id, reason: "系统超时自动验收" } })).toBe(1);
  for (const [f, status] of [[early, "AWAITING_ACCEPTANCE"], [complained, "AWAITING_ACCEPTANCE"], [cancelled, "CANCELLED"], [refunded, "REFUNDED"]] as const) {
    expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe(status);
    expect(await prisma.walletTransaction.count({ where: { referenceId: f.order.id } })).toBe(0);
    expect(await prisma.orderStatusLog.count({ where: { orderId: f.order.id } })).toBe(0);
  }
});

test("8: configured hours apply to deadline and are rechecked inside acceptance", async () => {
  const f = await fixture("AWAITING_ACCEPTANCE", 2);
  expect(await auto(f)).toBeNull();
  await setHours("1");
  const row = (await orders.listCustomerOrders(f.customer.id))[0];
  expect(row.autoAcceptanceDueAt?.getTime()).toBe(f.order.reportedCompletedAt!.getTime() + 3600000);
  expect((await auto(f))?.status).toBe("COMPLETED");
});

test("8: invalid/missing settings default to 48 hours", () => {
  for (const value of [undefined, null, "", " ", "0", "-1", "NaN", "Infinity", "wrong", "1e100"]) expect(acceptanceHours(value)).toBe(48);
  expect(acceptanceHours("36")).toBe(36);
  expect(acceptanceHours("0.5")).toBe(0.5);
});

test("8: report completion writes the timer origin", async () => {
  const f = await fixture("IN_PROGRESS");
  await prisma.order.update({ where: { id: f.order.id }, data: { reportedCompletedAt: null, companionIncome: 0 } });
  const before = Date.now();
  const result = await orders.completeOrder(f.order.id, f.companion.id);
  expect(result.reportedCompletedAt!.getTime()).toBeGreaterThanOrEqual(before);
  expect(result.status).toBe("AWAITING_ACCEPTANCE");
});

test("8: existing poll invokes due-only scanner once per minute", async () => {
  const worker = new IntegrationJobsService(prisma);
  const service = new OrdersService(prisma, notifications, worker);
  const scan = jest.spyOn(service, "autoAcceptCompletions").mockResolvedValue({ scanned: 0, accepted: 0 });
  service.onModuleInit();
  await worker.processPolls(1000); await worker.processPolls(2000); await worker.processPolls(61000);
  expect(scan).toHaveBeenCalledTimes(2);
});

test("8: scanner selects due awaiting orders and calls shared acceptance", async () => {
  const due = await fixture(), early = await fixture("AWAITING_ACCEPTANCE", 2), cancelled = await fixture("CANCELLED");
  const service = new OrdersService(prisma, notifications);
  const calls: string[] = [];
  const accept = jest.spyOn(service, "acceptCompletion").mockImplementation(async (id: string) => { calls.push(id); return null as any; });
  await service.autoAcceptCompletions();
  expect(calls).toContain(due.order.id);
  expect(calls).not.toContain(early.order.id);
  expect(calls).not.toContain(cancelled.order.id);
  accept.mockRestore();
});

test("8: a complaint added after the scan is rechecked before settlement", async () => {
  const f = await fixture();
  const service = new OrdersService(prisma, notifications);
  const original = service.acceptCompletion.bind(service);
  jest.spyOn(service, "acceptCompletion").mockImplementation(async (id, actor, note) => {
    if (id !== f.order.id) return null as any;
    await prisma.complaint.create({ data: { orderId: id, reporterId: f.customer.id, reason: "synthetic race", status: "IN_REVIEW" } });
    return original(id, actor, note!, undefined, true);
  });
  await service.autoAcceptCompletions();
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("AWAITING_ACCEPTANCE");
  expect(await prisma.walletTransaction.count({ where: { referenceId: f.order.id } })).toBe(0);
});

test("8: a changed configuration after the scan is rechecked before settlement", async () => {
  const f = await fixture();
  const service = new OrdersService(prisma, notifications);
  const original = service.acceptCompletion.bind(service);
  jest.spyOn(service, "acceptCompletion").mockImplementation(async (id, actor, note) => {
    if (id !== f.order.id) return null as any;
    await setHours("72");
    return original(id, actor, note!, undefined, true);
  });
  await service.autoAcceptCompletions();
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("AWAITING_ACCEPTANCE");
  expect(await prisma.walletTransaction.count({ where: { referenceId: f.order.id } })).toBe(0);
});
