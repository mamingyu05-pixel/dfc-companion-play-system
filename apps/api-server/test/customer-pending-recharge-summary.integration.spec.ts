import { randomUUID } from "node:crypto";
import { ReviewStatus } from "@prisma/client";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { PROVIDER_RECHARGE_EVIDENCE_PREFIX, WalletService } from "../src/modules/wallet/wallet.service";

const prisma = new PrismaService();
const notifications = { syncCustomerMembershipLevels: jest.fn() };
const walletService = new WalletService(prisma, notifications as unknown as BotNotificationService);
const customerIds: string[] = [];
const time = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));

beforeAll(() => prisma.$connect());
afterAll(async () => {
  try {
    if (customerIds.length) {
      await prisma.rechargeRequest.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.wallet.deleteMany({ where: { userId: { in: customerIds } } });
      await prisma.user.deleteMany({ where: { id: { in: customerIds } } });
    }
  } finally {
    await prisma.$disconnect();
  }
});

async function customer() {
  const id = randomUUID();
  const user = await prisma.user.create({ data: {
    id, email: `${id}@synthetic.invalid`, displayName: id, displayNameKey: id,
    passwordHash: "synthetic-unusable", role: "CUSTOMER",
    wallet: { create: { availableBalance: "42.75", frozenBalance: "6.25" } }
  } });
  customerIds.push(id);
  return user;
}

function recharge(customerId: string, amount: string, minute: number,
  status: ReviewStatus = ReviewStatus.PENDING, screenshotUrl = "MANUAL_SUPPORT_CONFIRMATION") {
  return prisma.rechargeRequest.create({ data: {
    customerId, amount, status, screenshotUrl, createdAt: time(minute),
    ...(status === ReviewStatus.PENDING ? {} : { reviewedAt: time(minute + 1), reviewNote: "Synthetic prior review" })
  } });
}

async function reviewedHistory(customerId: string, count: number, startMinute: number) {
  for (let i = 0; i < count; i++) {
    await recharge(customerId, "1.00", startMinute + i,
      i % 2 ? ReviewStatus.REJECTED : ReviewStatus.APPROVED);
  }
}

async function assertReadOnlySummary(customerId: string) {
  const beforeWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: customerId } });
  const beforeRequests = await prisma.rechargeRequest.findMany({ where: { customerId }, orderBy: { id: "asc" } });
  const beforeLedger = await prisma.walletTransaction.count({ where: { userId: customerId } });
  const summary = await walletService.getCustomerWalletSummary(customerId);
  expect(await prisma.wallet.findUniqueOrThrow({ where: { userId: customerId } })).toEqual(beforeWallet);
  expect(await prisma.rechargeRequest.findMany({ where: { customerId }, orderBy: { id: "asc" } })).toEqual(beforeRequests);
  expect(await prisma.walletTransaction.count({ where: { userId: customerId } })).toBe(beforeLedger);
  expect(notifications.syncCustomerMembershipLevels).not.toHaveBeenCalled();
  return summary;
}

test("an older manual pending recharge is counted even when twenty newer reviewed requests fill the history", async () => {
  const user = await customer();
  const pending = await recharge(user.id, "123.45", 0);
  await reviewedHistory(user.id, 20, 10);

  const summary = await assertReadOnlySummary(user.id);
  expect(summary.rechargeRequests).toHaveLength(20);
  expect(summary.rechargeRequests.map(row => row.id)).not.toContain(pending.id);
  expect(summary.pendingRechargeAmount).toBe("123.45");
  expect(summary.wallet).toMatchObject({ availableBalance: "42.75", frozenBalance: "6.25" });
});

test("every old pending recharge contributes alongside recent pending requests while history remains the latest twenty", async () => {
  const user = await customer();
  const older = await Promise.all(["10.01", "20.02", "30.03"].map((amount, index) => recharge(user.id, amount, index)));
  await reviewedHistory(user.id, 25, 10);
  const recentA = await recharge(user.id, "4.44", 50);
  const recentB = await recharge(user.id, "5.55", 51);

  const summary = await assertReadOnlySummary(user.id);
  expect(summary.rechargeRequests).toHaveLength(20);
  expect(summary.rechargeRequests.slice(0, 2).map(row => row.id)).toEqual([recentB.id, recentA.id]);
  for (const pending of older) expect(summary.rechargeRequests.map(row => row.id)).not.toContain(pending.id);
  expect(summary.pendingRechargeAmount).toBe("70.05");
});

test("a customer without recharge requests has a zero pending sum and unchanged wallet", async () => {
  const user = await customer();
  const summary = await assertReadOnlySummary(user.id);
  expect(summary.pendingRechargeAmount).toBe("0");
  expect(summary.rechargeRequests).toEqual([]);
  expect(summary.wallet).toMatchObject({ availableBalance: "42.75", frozenBalance: "6.25", transactions: [] });
});

test("provider evidence is excluded from both the pending sum and history using the same exact prefix", async () => {
  const user = await customer();
  await recharge(user.id, "777.77", 0, ReviewStatus.PENDING, `${PROVIDER_RECHARGE_EVIDENCE_PREFIX}synthetic-old`);
  const manual = await recharge(user.id, "2.34", 1);
  const nearPrefix = await recharge(user.id, "0.66", 2, ReviewStatus.PENDING, "XPROVIDER_PAYMENT:synthetic-manual");
  await recharge(user.id, "888.88", 3, ReviewStatus.PENDING, `${PROVIDER_RECHARGE_EVIDENCE_PREFIX}synthetic-recent`);

  const summary = await assertReadOnlySummary(user.id);
  expect(summary.pendingRechargeAmount).toBe("3");
  expect(summary.rechargeRequests.map(row => row.id)).toEqual([nearPrefix.id, manual.id]);
});

test("pending recharges from another customer never enter the customer's aggregate or history", async () => {
  const owner = await customer();
  const other = await customer();
  const ownRequest = await recharge(owner.id, "3.14", 0);
  const otherRequest = await recharge(other.id, "999.99", 1);

  const summary = await assertReadOnlySummary(owner.id);
  expect(summary.pendingRechargeAmount).toBe("3.14");
  expect(summary.rechargeRequests.map(row => row.id)).toEqual([ownRequest.id]);
  expect(summary.rechargeRequests.map(row => row.id)).not.toContain(otherRequest.id);
  expect((await assertReadOnlySummary(other.id)).pendingRechargeAmount).toBe("999.99");
});

test("pending amounts retain exact Decimal cents even when their sum exceeds one recharge column's range", async () => {
  const user = await customer();
  for (const [index, amount] of ["9999999999.90", "0.10", "0.20", "0.01"].entries()) {
    await recharge(user.id, amount, index);
  }
  await recharge(user.id, "1234.56", 4, ReviewStatus.APPROVED);
  await recharge(user.id, "6543.21", 5, ReviewStatus.REJECTED);

  const summary = await assertReadOnlySummary(user.id);
  expect(summary.pendingRechargeAmount).toBe("10000000000.21");
  expect(summary.rechargeRequests).toHaveLength(6);
});
