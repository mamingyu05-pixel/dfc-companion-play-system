import { randomUUID } from "node:crypto";
import { UserRole, OrderStatus } from "@prisma/client";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { ComplaintsController } from "../src/modules/complaints/complaints.controller";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";

const prisma = new PrismaService();
const notifications = { syncCustomerMembershipLevels: jest.fn().mockResolvedValue([]), sendOrderAssignedNotifications: jest.fn().mockResolvedValue([]) } as unknown as BotNotificationService;
const orders = new OrdersService(prisma, notifications);
const complaints = new ComplaintsController(prisma);
const evidence = "人工核对派单与服务记录：未分配且未服务，同意全额退还冻结余额；不作陪玩责任认定。";
beforeAll(async () => { await prisma.$connect(); });
afterAll(async () => { await prisma.$disconnect(); });
async function user(role: UserRole) {
  const id = randomUUID();
  return prisma.user.create({ data: { id, email: `${id}@synthetic.invalid`, displayName: "合成争议测试", displayNameKey: id, passwordHash: "synthetic-unusable", role, wallet: { create: { availableBalance: role === "CUSTOMER" ? "1000" : "0" } } } });
}
async function fixture(origin: "PAID" | "ASSIGNED" = "PAID") {
  const admin = await user(UserRole.ADMIN), customer = await user(UserRole.CUSTOMER);
  const order = await orders.createOrder(customer.id, { requestId: randomUUID(), mode: "娱乐", hours: "1" });
  if (origin === "ASSIGNED") await prisma.order.update({ where: { id: order.id }, data: { status: OrderStatus.ASSIGNED, dispatchVersion: 1, acceptanceDeadline: new Date(Date.now() + 60000) } });
  const complaint = await complaints.createComplaint({ id: customer.id, role: customer.role, email: customer.email }, { orderId: order.id, reason: "一直未匹配到陪玩，请人工核对并退款" });
  return { admin, customer, order, complaint };
}
async function assertRefund(f: Awaited<ReturnType<typeof fixture>>) {
  const saved = await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } });
  expect(saved.status).toBe("REFUNDED"); expect(saved.companionId).toBeNull();
  expect(saved.refundAmount.toString()).toBe(f.order.totalAmount.toString());
  expect(saved.companionIncome.toString()).toBe("0"); expect(saved.platformFee.toString()).toBe("0");
  expect(saved.startedAt).toBeNull(); expect(saved.completedAt).toBeNull(); expect(saved.verifiedAt).not.toBeNull();
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: f.customer.id } });
  expect(wallet.availableBalance.toString()).toBe("1000"); expect(wallet.frozenBalance.toString()).toBe("0");
  const ledger = await prisma.walletTransaction.findMany({ where: { referenceId: f.order.id } });
  expect(ledger.filter(t => t.type === "ORDER_REFUND")).toHaveLength(1);
  expect(ledger.filter(t => t.type === "ORDER_PENDING_RELEASE" || t.type === "ORDER_SETTLEMENT")).toHaveLength(0);
  expect(ledger.every(t => t.userId === f.customer.id)).toBe(true);
  const resolved = await prisma.complaint.findUniqueOrThrow({ where: { id: f.complaint.id } });
  expect(resolved.status).toBe("RESOLVED"); expect(resolved.resolvedById).toBe(f.admin.id); expect(resolved.resolution).toBe(evidence);
  expect(await prisma.adminLog.count({ where: { entityId: f.order.id, action: "REFUND_UNASSIGNED_DISPUTE" } })).toBe(1);
  expect(await prisma.orderStatusLog.count({ where: { orderId: f.order.id, fromStatus: "DISPUTED", toStatus: "REFUNDED" } })).toBe(1);
}
test("unassigned dispute: valid PAID complaint can receive evidenced admin full refund without rejecting complaint", async () => {
  const f = await fixture();
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).companionId).toBeNull();
  await expect(orders.cancelOrderByAdmin(f.admin.id, f.order.id, { note: evidence })).rejects.toThrow(/Only unstarted paid orders/);
  await orders.acceptCompletion(f.order.id, f.admin.id, evidence, f.order.totalAmount.toString());
  await assertRefund(f);
});
test("unassigned dispute: open assignment that was never accepted supports full refund", async () => {
  const f = await fixture("ASSIGNED");
  await orders.acceptCompletion(f.order.id, f.admin.id, evidence, f.order.totalAmount.toString());
  await assertRefund(f);
});
test("unassigned dispute: explicit full amount, active admin and evidence are mandatory", async () => {
  const f = await fixture();
  await expect(orders.acceptCompletion(f.order.id, f.customer.id, evidence, f.order.totalAmount.toString())).rejects.toThrow();
  await expect(orders.acceptCompletion(f.order.id, f.admin.id, "  ", f.order.totalAmount.toString())).rejects.toThrow();
  for (const amount of [undefined, "0", "1", f.order.totalAmount.add(1).toString(), "-1"]) await expect(orders.acceptCompletion(f.order.id, f.admin.id, evidence, amount)).rejects.toThrow();
  await prisma.user.update({ where: { id: f.admin.id }, data: { status: "BANNED" } });
  await expect(orders.acceptCompletion(f.order.id, f.admin.id, evidence, f.order.totalAmount.toString())).rejects.toThrow();
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("DISPUTED");
  expect(await prisma.walletTransaction.count({ where: { referenceId: f.order.id, type: "ORDER_REFUND" } })).toBe(0);
});
test("unassigned dispute: service or income traces cannot be converted to unassigned full refund", async () => {
  for (const trace of [{ acceptedAt: new Date() }, { startedAt: new Date() }, { completedAt: new Date() }, { companionIncome: "1" }, { disputeFromStatus: OrderStatus.IN_PROGRESS }]) {
    const f = await fixture();
    await prisma.order.update({ where: { id: f.order.id }, data: trace });
    await expect(orders.acceptCompletion(f.order.id, f.admin.id, evidence, f.order.totalAmount.toString())).rejects.toThrow();
    expect(await prisma.walletTransaction.count({ where: { referenceId: f.order.id, type: "ORDER_REFUND" } })).toBe(0);
  }
});
test("unassigned dispute: insufficient frozen funds rolls back everything and can be retried after repair", async () => {
  const f = await fixture();
  await prisma.wallet.update({ where: { userId: f.customer.id }, data: { frozenBalance: "0" } });
  await expect(orders.acceptCompletion(f.order.id, f.admin.id, evidence, f.order.totalAmount.toString())).rejects.toThrow(/frozen balance/);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("DISPUTED");
  expect((await prisma.complaint.findUniqueOrThrow({ where: { id: f.complaint.id } })).status).toBe("OPEN");
  expect(await prisma.adminLog.count({ where: { entityId: f.order.id } })).toBe(0);
  await prisma.wallet.update({ where: { userId: f.customer.id }, data: { frozenBalance: f.order.totalAmount } });
  await orders.acceptCompletion(f.order.id, f.admin.id, evidence, f.order.totalAmount.toString());
  await assertRefund(f);
});
test("unassigned dispute: concurrent and repeated adjudications refund once", async () => {
  const f = await fixture();
  const outcomes = await Promise.allSettled(Array.from({ length: 5 }, () => orders.acceptCompletion(f.order.id, f.admin.id, evidence, f.order.totalAmount.toString())));
  expect(outcomes.filter(r => r.status === "fulfilled")).toHaveLength(1);
  await expect(orders.acceptCompletion(f.order.id, f.admin.id, evidence, f.order.totalAmount.toString())).rejects.toThrow();
  await assertRefund(f);
});
