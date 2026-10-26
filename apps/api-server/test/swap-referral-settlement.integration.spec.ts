import { randomUUID } from "node:crypto";
import { ReferralSourceType, UserRole } from "@prisma/client";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";

const prisma = new PrismaService();
const notifications = {
  sendOrderAssignedNotifications: jest.fn(async () => []),
  syncCustomerMembershipLevels: jest.fn(async () => [])
} as unknown as BotNotificationService;
const orders = new OrdersService(prisma, notifications);
const settings = {
  CUSTOMER_REFERRER_REWARD_AMOUNT: "10",
  CUSTOMER_INVITEE_BONUS_AMOUNT: "10",
  COMPANION_REFERRAL_REWARD_AMOUNT: "20",
  COMPANION_REFERRAL_COMMISSION_RATE: "0.01"
};
const originalSettings = new Map<string, string>();
const changedSettings = new Set<string>();

beforeAll(async () => {
  await prisma.$connect();
  for (const setting of await prisma.platformSetting.findMany({ where: { key: { in: Object.keys(settings) } } })) {
    originalSettings.set(setting.key, setting.value);
  }
  for (const [key, value] of Object.entries(settings)) {
    await prisma.platformSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    changedSettings.add(key);
  }
});
afterAll(async () => {
  // Restore only the four keys owned by this suite, including their previous absence.
  try {
    for (const key of changedSettings) {
      const value = originalSettings.get(key);
      if (value === undefined) await prisma.platformSetting.deleteMany({ where: { key } });
      else await prisma.platformSetting.update({ where: { key }, data: { value } });
    }
    const restored = await prisma.platformSetting.findMany({ where: { key: { in: [...changedSettings] } } });
    expect(restored.map(row => [row.key, row.value]).sort()).toEqual([...originalSettings].filter(([key]) => changedSettings.has(key)).sort());
  } finally { await prisma.$disconnect(); }
});

async function user(role: UserRole, balance = "0") {
  const id = randomUUID();
  return prisma.user.create({ data: {
    email: `${id}@synthetic.invalid`, displayName: id, displayNameKey: id, passwordHash: "synthetic", role,
    wallet: { create: { availableBalance: balance } },
    ...(role === "COMPANION" ? { companionProfile: { create: {
      nickname: "Synthetic", skillModes: [], pricePerHour: "100", commissionRate: "0.2", status: "LISTED", onlineStatus: "ONLINE"
    } } } : {})
  } });
}

async function fixture(sourceType: ReferralSourceType = "COMPANION") {
  const admin = await user("ADMIN"), customer = await user("CUSTOMER", "1000");
  const first = await user("COMPANION"), replacement = await user("COMPANION");
  const referrer = await user(sourceType === "COMPANION" ? "COMPANION" : "CUSTOMER");
  const referral = await prisma.userReferral.create({ data: { referrerId: referrer.id, referredUserId: customer.id, sourceType } });
  const order = await orders.createOrder(customer.id, { requestId: randomUUID(), mode: "娱乐", hours: "3", companionId: first.id });
  await prisma.order.update({ where: { id: order.id }, data: {
    status: "IN_PROGRESS", companionId: first.id, acceptedAt: new Date(Date.now() - 3_601_000), startedAt: new Date(Date.now() - 3_601_000)
  } });
  return { admin, customer, first, replacement, referrer, referral, order };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
const swap = (f: Fixture, servedHours = "1") => orders.swapCompanion(f.order.id, f.admin.id, {
  newCompanionId: f.replacement.id, servedHours, reason: "synthetic customer-requested replacement", dispatchVersion: f.order.dispatchVersion
});
const wallet = (userId: string) => prisma.wallet.findUniqueOrThrow({ where: { userId } });
const referralRewards = (referralId: string) => prisma.walletTransaction.findMany({
  where: { type: "REFERRAL_REWARD", referenceType: "USER_REFERRAL", referenceId: referralId }
});

async function commissionTotal(orderIds: string[]) {
  const aggregate = await prisma.walletTransaction.aggregate({ where: {
    type: "REFERRAL_REWARD", referenceType: "ORDER_REFERRAL_COMMISSION", referenceId: { in: orderIds }
  }, _sum: { amount: true } });
  return aggregate._sum.amount?.toFixed(2) ?? "0.00";
}

test("a served first-order segment settles the unchanged referral rules with the partial service payment", async () => {
  const f = await fixture(), result = await swap(f);
  const referral = await prisma.userReferral.findUniqueOrThrow({ where: { id: f.referral.id } });
  const rewards = await referralRewards(f.referral.id);
  console.info("SWAP_REFERRAL_OBSERVATION " + JSON.stringify({ stage: "served-first-segment", rewardStatus: referral.rewardStatus,
    firstRewardEntries: rewards.length, recurringCommission: await commissionTotal([f.order.id]) }));
  expect(referral.rewardStatus).toBe("REWARDED");
  expect(referral.firstOrderId).toBe(f.order.id);
  expect(rewards.map(row => row.amount.toFixed(2)).sort()).toEqual(["10.00", "20.00"]);
  expect(await commissionTotal([f.order.id])).toBe("1.00");
  expect((await wallet(f.referrer.id)).availableIncome.toFixed(2)).toBe("21.00");
  expect((await wallet(f.customer.id)).availableBalance.toFixed(2)).toBe("710.00");
  expect((await wallet(f.customer.id)).frozenBalance.toFixed(2)).toBe("200.00");
  expect((await wallet(f.first.id)).availableIncome.toFixed(2)).toBe("80.00");
  const original = await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } });
  const followOn = await prisma.order.findUniqueOrThrow({ where: { id: result.orderId } });
  expect(original.status).toBe("COMPLETED");
  expect(original.totalAmount.toFixed(2)).toBe("100.00");
  expect(original.platformFee.toFixed(2)).toBe("20.00");
  expect(followOn.totalAmount.toFixed(2)).toBe("200.00");
  expect(followOn.hours.toString()).toBe("2");
});

test("finishing the follow-on pays each segment commission and never loses or duplicates the first-order rewards", async () => {
  const f = await fixture(), result = await swap(f);
  const followOn = await prisma.order.findUniqueOrThrow({ where: { id: result.orderId } });
  await orders.acceptOrderFromWeb(followOn.id, f.replacement.id, followOn.dispatchVersion);
  await orders.startOrder(followOn.id, f.replacement.id);
  await prisma.order.update({ where: { id: followOn.id }, data: { startedAt: new Date(Date.now() - 7_201_000) } });
  await orders.completeOrder(followOn.id, f.replacement.id);
  await orders.acceptCompletion(followOn.id, f.customer.id);
  const referral = await prisma.userReferral.findUniqueOrThrow({ where: { id: f.referral.id } });
  const rewards = await referralRewards(f.referral.id);
  console.info("SWAP_REFERRAL_OBSERVATION " + JSON.stringify({ stage: "follow-on-completed", rewardStatus: referral.rewardStatus,
    firstRewardEntries: rewards.length, recurringCommission: await commissionTotal([f.order.id, followOn.id]) }));
  expect(referral.rewardStatus).toBe("REWARDED");
  expect(referral.firstOrderId).toBe(f.order.id);
  expect(rewards).toHaveLength(2);
  expect(await commissionTotal([f.order.id, followOn.id])).toBe("3.00");
  expect((await wallet(f.referrer.id)).availableIncome.toFixed(2)).toBe("23.00");
  expect((await wallet(f.customer.id)).availableBalance.toFixed(2)).toBe("710.00");
  expect((await wallet(f.customer.id)).frozenBalance.toFixed(2)).toBe("0.00");
  expect((await wallet(f.first.id)).availableIncome.toFixed(2)).toBe("80.00");
  expect((await wallet(f.replacement.id)).availableIncome.toFixed(2)).toBe("160.00");

  const beforeRetry = await wallet(f.referrer.id);
  await expect(swap(f)).rejects.toThrow();
  await expect(orders.acceptCompletion(followOn.id, f.customer.id)).rejects.toThrow("awaiting acceptance");
  expect((await wallet(f.referrer.id)).availableIncome.toFixed(2)).toBe(beforeRetry.availableIncome.toFixed(2));
  expect(await referralRewards(f.referral.id)).toHaveLength(2);
  expect(await commissionTotal([f.order.id, followOn.id])).toBe("3.00");
  expect(await prisma.walletTransaction.count({ where: { userId: f.customer.id, type: "ORDER_PAYMENT" } })).toBe(1);
});

test("customer referrers keep the same first-order wallet rewards and receive no companion recurring commission", async () => {
  const f = await fixture("CUSTOMER");
  await swap(f);
  expect((await prisma.userReferral.findUniqueOrThrow({ where: { id: f.referral.id } })).rewardStatus).toBe("REWARDED");
  expect((await wallet(f.referrer.id)).availableBalance.toFixed(2)).toBe("10.00");
  expect((await wallet(f.referrer.id)).availableIncome.toFixed(2)).toBe("0.00");
  expect((await wallet(f.customer.id)).availableBalance.toFixed(2)).toBe("710.00");
  expect((await referralRewards(f.referral.id)).map(row => row.amount.toFixed(2))).toEqual(["10.00", "10.00"]);
  expect(await commissionTotal([f.order.id])).toBe("0.00");
});

test("a zero-service replacement neither settles service nor grants referral rewards", async () => {
  const f = await fixture(), result = await swap(f, "0");
  expect(result.settledOrderId).toBeNull();
  expect((await prisma.userReferral.findUniqueOrThrow({ where: { id: f.referral.id } })).rewardStatus).toBe("PENDING");
  expect(await referralRewards(f.referral.id)).toHaveLength(0);
  expect(await commissionTotal([f.order.id])).toBe("0.00");
  expect((await wallet(f.customer.id)).availableBalance.toFixed(2)).toBe("700.00");
  expect((await wallet(f.customer.id)).frozenBalance.toFixed(2)).toBe("300.00");
  expect((await wallet(f.first.id)).availableIncome.toFixed(2)).toBe("0.00");
});

test("concurrent retries settle one first segment, one follow-on and one set of referral rewards", async () => {
  const f = await fixture();
  const outcomes = await Promise.allSettled([swap(f), swap(f)]);
  expect(outcomes.filter(value => value.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter(value => value.status === "rejected")).toHaveLength(1);
  expect(await prisma.order.count({ where: { customerId: f.customer.id } })).toBe(2);
  expect(await referralRewards(f.referral.id)).toHaveLength(2);
  expect(await commissionTotal([f.order.id])).toBe("1.00");
  expect((await wallet(f.referrer.id)).availableIncome.toFixed(2)).toBe("21.00");
  expect((await wallet(f.customer.id)).frozenBalance.toFixed(2)).toBe("200.00");
  expect((await wallet(f.first.id)).availableIncome.toFixed(2)).toBe("80.00");
});

test("a follow-on creation failure rolls back service settlement and every referral reward", async () => {
  const f = await fixture();
  // Fail after referral settlement by reusing the original order's unique order number.
  const collision = jest.spyOn(orders as unknown as { generateOrderNo(): string }, "generateOrderNo").mockReturnValue(f.order.orderNo);
  try { await expect(swap(f)).rejects.toThrow(); }
  finally { collision.mockRestore(); }
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("IN_PROGRESS");
  expect(await prisma.order.count({ where: { customerId: f.customer.id } })).toBe(1);
  expect((await prisma.userReferral.findUniqueOrThrow({ where: { id: f.referral.id } })).rewardStatus).toBe("PENDING");
  expect(await referralRewards(f.referral.id)).toHaveLength(0);
  expect(await commissionTotal([f.order.id])).toBe("0.00");
  expect((await wallet(f.referrer.id)).availableIncome.toFixed(2)).toBe("0.00");
  expect((await wallet(f.customer.id)).availableBalance.toFixed(2)).toBe("700.00");
  expect((await wallet(f.customer.id)).frozenBalance.toFixed(2)).toBe("300.00");
  expect((await wallet(f.first.id)).availableIncome.toFixed(2)).toBe("0.00");
});
