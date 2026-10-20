import { randomUUID } from "node:crypto";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { OrderDraftsService } from "../src/modules/orders/order-drafts.service";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";

const prisma = new PrismaService();
const notifications = { sendOrderDraftSelectedCompanionNotification: jest.fn(async () => ({})), sendOrderAssignedNotifications: jest.fn(async () => ({})) };
const orders = new OrdersService(prisma, notifications as unknown as BotNotificationService);
const drafts = new OrderDraftsService(prisma, orders, notifications as unknown as BotNotificationService);
beforeAll(async () => { await prisma.$connect(); });
afterAll(async () => { await prisma.$disconnect(); });
beforeEach(() => { notifications.sendOrderAssignedNotifications.mockClear(); });
async function fixture() {
  const user = async (role: "ADMIN" | "CUSTOMER" | "COMPANION") => {
    const id = randomUUID();
    return prisma.user.create({ data: { email: `${id}@synthetic.invalid`, displayName: id, displayNameKey: id, passwordHash: "synthetic", role,
      wallet: { create: { availableBalance: "1000" } },
      ...(role === "COMPANION" ? { companionProfile: { create: { nickname: "Synthetic", skillModes: [], pricePerHour: "100", commissionRate: "0.2", status: "LISTED", onlineStatus: "ONLINE" } } } : {}) } });
  };
  const admin = await user("ADMIN"), customer = await user("CUSTOMER"), companion = await user("COMPANION");
  const draft = await prisma.orderDraft.create({ data: { draftNo: randomUUID(), serviceAdminId: admin.id, customerId: customer.id,
    sourcePlatform: "WEB", mode: "娱乐", priceTier: "ENTERTAINMENT", hours: "1", selectedCompanionId: companion.id, status: "SELECTED" } });
  return { admin, customer, companion, draft, user };
}
async function receipt(f: Awaited<ReturnType<typeof fixture>>) {
  return orders.createOrder(f.customer.id, { requestId: randomUUID(), mode: "娱乐", hours: "1", companionId: f.companion.id, sourceDraftId: f.draft.id });
}
async function assertOneAudit(draftId: string) {
  expect(await prisma.orderDraftEvent.count({ where: { draftId, eventType: "DRAFT_CONVERTED_TO_ORDER" } })).toBe(1);
  expect(await prisma.adminLog.count({ where: { entityId: draftId, action: { in: ["CONVERT_ORDER_DRAFT", "CONVERT_ORDER_DRAFT_GROUP"] } } })).toBe(1);
}
test("draft recovery: rejected dispatch leaves one funded order which retry recovers without dispatching", async () => {
  const f = await fixture();
  const active = await orders.createOrder(f.customer.id, { requestId: randomUUID(), mode: "娱乐", hours: "1", companionId: f.companion.id });
  await prisma.order.update({ where: { id: active.id }, data: { status: "ACCEPTED" } });
  await expect(drafts.convertDraftToOrder(f.admin.id, f.draft.id)).rejects.toThrow("active service order");
  const persisted = await prisma.order.findUniqueOrThrow({ where: { sourceDraftId: f.draft.id } });
  const before = await prisma.wallet.findUniqueOrThrow({ where: { userId: f.customer.id } });
  const recovered: any = await drafts.convertDraftToOrder(f.admin.id, f.draft.id);
  expect(recovered.order.id).toBe(persisted.id); expect(recovered.order.status).toBe("PAID"); expect(recovered.requiresDispatch).toBe(true);
  expect(recovered.draft.status).toBe("CONVERTED");
  const after = await prisma.wallet.findUniqueOrThrow({ where: { userId: f.customer.id } });
  expect(after.availableBalance.toString()).toBe(before.availableBalance.toString()); expect(after.frozenBalance.toString()).toBe(before.frozenBalance.toString());
  expect(notifications.sendOrderAssignedNotifications).not.toHaveBeenCalled();
  await assertOneAudit(f.draft.id);
});
test("draft recovery: twenty post-commit retries finalize once, ignoring stale selection inputs", async () => {
  const f = await fixture(), order = await receipt(f);
  const results: any[] = await Promise.all(Array.from({ length: 20 }, () => drafts.convertDraftToOrder(f.admin.id, f.draft.id, { companionId: f.companion.id })));
  expect(results.every(result => result.order.id === order.id)).toBe(true);
  expect(await prisma.walletTransaction.count({ where: { referenceId: order.id, type: "ORDER_PAYMENT" } })).toBe(1);
  await assertOneAudit(f.draft.id); expect(notifications.sendOrderAssignedNotifications).not.toHaveBeenCalled();
});
test("draft recovery: a committed group recovers without resending assignment notifications", async () => {
  const f = await fixture(), other = await f.user("COMPANION");
  const group = await orders.createOrderGroup(f.customer.id, { requestId: randomUUID(), mode: "娱乐", hours: "1", companionIds: [f.companion.id, other.id], sourceDraftId: f.draft.id, assignedById: f.admin.id });
  notifications.sendOrderAssignedNotifications.mockClear();
  const result: any = await drafts.convertDraftToOrder(f.admin.id, f.draft.id);
  expect(result.orderGroup.id).toBe(group.orderGroup.id); expect(result.orders).toHaveLength(2); expect(result.draft.status).toBe("CONVERTED");
  expect(await prisma.walletTransaction.count({ where: { referenceId: group.orderGroup.id, type: "ORDER_PAYMENT" } })).toBe(1);
  await assertOneAudit(f.draft.id); expect(notifications.sendOrderAssignedNotifications).not.toHaveBeenCalled();
});
test("draft recovery: successful conversion replay returns the receipt without new audit or notification", async () => {
  const f = await fixture();
  const first: any = await drafts.convertDraftToOrder(f.admin.id, f.draft.id);
  notifications.sendOrderAssignedNotifications.mockClear();
  const repeated: any = await drafts.convertDraftToOrder(f.admin.id, f.draft.id, { companionId: f.companion.id });
  expect(repeated.order.id).toBe(first.order.id); expect(repeated.order.status).toBe("ASSIGNED");
  await assertOneAudit(f.draft.id); expect(notifications.sendOrderAssignedNotifications).not.toHaveBeenCalled();
});
test("recommendations: filing complaints does not lower a companion score", async () => {
  const f = await fixture(), order = await receipt(f);
  await prisma.orderDraftCandidate.create({ data: { draftId: f.draft.id, companionId: f.companion.id, status: "SELECTED" } });
  const before = await drafts.recommendCandidates(f.admin.id, f.draft.id);
  await prisma.complaint.createMany({ data: Array.from({ length: 5 }, () => ({ orderId: order.id, reporterId: f.companion.id, reason: "Synthetic report without responsibility finding" })) });
  const after = await drafts.recommendCandidates(f.admin.id, f.draft.id);
  expect(after.recommendations.map(item => ({ id: item.companionId, score: item.score }))).toEqual(before.recommendations.map(item => ({ id: item.companionId, score: item.score })));
});
