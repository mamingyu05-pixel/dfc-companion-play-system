import { randomUUID } from "node:crypto";
import { OrderDraftCandidateStatus, OrderDraftStatus } from "@prisma/client";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { OrderDraftsService } from "../src/modules/orders/order-drafts.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";

const prisma = new PrismaService();
const notifications = { sendOrderDraftSelectedCompanionNotification: jest.fn(async () => ({})) };
const drafts = new OrderDraftsService(prisma, {} as OrdersService, notifications as unknown as BotNotificationService);

beforeAll(async () => { await prisma.$connect(); });
afterAll(async () => { await prisma.$disconnect(); });

async function user(role: "ADMIN" | "CUSTOMER" | "COMPANION") {
  const id = randomUUID();
  return prisma.user.create({ data: {
    email: `${id}@synthetic.invalid`, displayName: id, displayNameKey: id, passwordHash: "synthetic", role,
    ...(role === "COMPANION" ? { companionProfile: { create: {
      nickname: "Synthetic", skillModes: [], pricePerHour: "100", commissionRate: "0.2", status: "LISTED", onlineStatus: "ONLINE"
    } } } : {})
  } });
}

async function fixture(status: OrderDraftStatus = "OPEN") {
  const admin = await user("ADMIN"), customer = await user("CUSTOMER"), companion = await user("COMPANION");
  const draft = await prisma.orderDraft.create({ data: {
    draftNo: randomUUID(), serviceAdminId: admin.id, customerId: customer.id, sourcePlatform: "WEB",
    game: "DELTA_FORCE", mode: "娱乐", hours: "1", status, note: "customer-approved-terms"
  } });
  return { admin, customer, companion, draft };
}

async function snapshot(draftId: string) {
  return prisma.orderDraft.findUniqueOrThrow({ where: { id: draftId }, include: {
    candidates: { orderBy: { companionId: "asc" } }, events: { orderBy: { createdAt: "asc" } }
  } });
}

test.each<OrderDraftStatus>(["OPEN", "TRIALING"])("web application creates one candidate only while %s is open for applications", async status => {
  const f = await fixture(status);
  const first = await drafts.companionApplyFromWeb(f.companion.id, f.draft.id, { note: "first application" });
  const before = await snapshot(f.draft.id);
  const replay = await drafts.companionApplyFromWeb(f.companion.id, f.draft.id, { note: "changed replay must not overwrite the receipt" });
  expect(replay).toEqual(first);
  expect(await snapshot(f.draft.id)).toEqual(before);
  expect(before.status).toBe("TRIALING");
  expect(before.candidates).toHaveLength(1);
  expect(before.events.filter(event => event.eventType === "COMPANION_APPLIED")).toHaveLength(1);
});

test.each<OrderDraftStatus>(["SELECTED", "CUSTOMER_CONFIRMED"])("a selected companion retry preserves %s and the accepted selection", async status => {
  const f = await fixture();
  await drafts.companionApplyFromWeb(f.companion.id, f.draft.id, { note: "original application" });
  await drafts.selectCompanion(f.admin.id, f.draft.id, { companionId: f.companion.id, note: "selected terms" });
  if (status === "CUSTOMER_CONFIRMED") await drafts.confirmDraft(f.admin.id, f.draft.id, { note: "customer-approved-terms" });
  const before = await snapshot(f.draft.id);
  const selected = before.candidates.find(candidate => candidate.companionId === f.companion.id)!;
  const replay = await drafts.companionApplyFromWeb(f.companion.id, f.draft.id, { note: "stale browser replay" });
  expect(replay).toEqual(selected);
  expect(await snapshot(f.draft.id)).toEqual(before);
  expect(before.status).toBe(status);
  expect(before.selectedCompanionId).toBe(f.companion.id);
  expect(selected.status).toBe("SELECTED");
});

test.each<OrderDraftStatus>(["SELECTED", "CUSTOMER_CONFIRMED"])("a new companion cannot join %s after applications have closed", async status => {
  const f = await fixture(status);
  const selected = await user("COMPANION");
  await prisma.orderDraft.update({ where: { id: f.draft.id }, data: { selectedCompanionId: selected.id } });
  await prisma.orderDraftCandidate.create({ data: { draftId: f.draft.id, companionId: selected.id, status: "SELECTED" } });
  const before = await snapshot(f.draft.id);
  await expect(drafts.companionApplyFromWeb(f.companion.id, f.draft.id, {})).rejects.toThrow("停止报名");
  expect(await snapshot(f.draft.id)).toEqual(before);
});

test("a rejected application cannot revive itself, even when the draft is still open", async () => {
  const f = await fixture();
  await prisma.orderDraftCandidate.create({ data: { draftId: f.draft.id, companionId: f.companion.id,
    status: OrderDraftCandidateStatus.REJECTED, note: "staff rejected" } });
  const before = await snapshot(f.draft.id);
  await expect(drafts.companionApplyFromWeb(f.companion.id, f.draft.id, {})).rejects.toThrow("拒绝");
  expect(await snapshot(f.draft.id)).toEqual(before);
});

test.each<OrderDraftStatus>(["CONVERTED", "CANCELLED"])("closed draft %s still rejects web applications", async status => {
  const f = await fixture(status);
  const before = await snapshot(f.draft.id);
  await expect(drafts.companionApplyFromWeb(f.companion.id, f.draft.id, {})).rejects.toThrow("closed");
  expect(await snapshot(f.draft.id)).toEqual(before);
});

test("a member of a confirmed multi-companion selection cannot remove themselves by replaying apply", async () => {
  const f = await fixture(), second = await user("COMPANION");
  await drafts.selectCompanion(f.admin.id, f.draft.id, { companionIds: [f.companion.id, second.id], note: "both selected" });
  await drafts.confirmDraft(f.admin.id, f.draft.id, { note: "confirmed both" });
  const before = await snapshot(f.draft.id);
  await drafts.companionApplyFromWeb(second.id, f.draft.id, {});
  const after = await snapshot(f.draft.id);
  expect(after).toEqual(before);
  expect(after.candidates.filter(candidate => candidate.status === "SELECTED").map(candidate => candidate.companionId).sort())
    .toEqual([f.companion.id, second.id].sort());
});

test("an application waiting on an admin selection reads the committed selected state before changing anything", async () => {
  const f = await fixture();
  let unlock!: () => void, ready!: () => void;
  const held = new Promise<void>(resolve => { unlock = resolve; });
  const locked = new Promise<void>(resolve => { ready = resolve; });
  const selection = prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "order_drafts" WHERE "id" = ${f.draft.id} FOR UPDATE`;
    await tx.orderDraftCandidate.create({ data: { draftId: f.draft.id, companionId: f.companion.id, status: "SELECTED", note: "locked selection" } });
    await tx.orderDraft.update({ where: { id: f.draft.id }, data: { status: "CUSTOMER_CONFIRMED", selectedCompanionId: f.companion.id } });
    ready();
    await held;
  });
  await locked;
  const apply = drafts.companionApplyFromWeb(f.companion.id, f.draft.id, { note: "concurrent stale application" });
  // Let the second connection reach the held draft before the admin commits.
  await new Promise(resolve => setTimeout(resolve, 30));
  unlock();
  await selection;
  const replay = await apply;
  const after = await snapshot(f.draft.id);
  expect(replay.status).toBe("SELECTED");
  expect(after.status).toBe("CUSTOMER_CONFIRMED");
  expect(after.selectedCompanionId).toBe(f.companion.id);
  expect(after.candidates).toHaveLength(1);
  expect(after.candidates[0].note).toBe("locked selection");
  expect(after.events.filter(event => event.eventType === "COMPANION_APPLIED")).toHaveLength(0);
});
