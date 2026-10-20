import { randomUUID } from "node:crypto";
import { Prisma, UserRole, OrderStatus, BotPlatform } from "@prisma/client";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { OrdersService as CurrentOrdersService } from "../src/modules/orders/orders.service";
import { WalletService as CurrentWalletService } from "../src/modules/wallet/wallet.service";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";
import { fixedDecimal, commissionSplit } from "../src/modules/financial-values";
import { ComplaintsController } from "../src/modules/complaints/complaints.controller";
import { AdminController } from "../src/modules/admin/admin.controller";

const baseline = process.env.DFC_TEST_BASELINE === "1";
const OrdersService: typeof CurrentOrdersService = baseline
  ? require("../src/modules/orders/orders.baseline.fixture").OrdersService
  : CurrentOrdersService;
const WalletService: typeof CurrentWalletService = baseline
  ? require("../src/modules/wallet/wallet.baseline.fixture").WalletService
  : CurrentWalletService;
const prisma = new PrismaService();
const notifications = {
  syncCustomerMembershipLevels: jest.fn().mockResolvedValue([]),
  sendOrderAssignedNotifications: jest.fn().mockResolvedValue([]),
} as unknown as BotNotificationService;
const orders = new OrdersService(prisma, notifications);
const wallet = new WalletService(prisma, notifications);

async function user(role: UserRole, balance = "0") {
  const suffix = randomUUID();
  return prisma.user.create({
    data: {
      email: `${suffix}@synthetic.invalid`,
      displayName: suffix,
      displayNameKey: suffix,
      passwordHash: "synthetic-unusable-hash",
      role,
      wallet: { create: { availableBalance: balance } },
      ...(role === "COMPANION"
        ? {
            companionProfile: {
              create: {
                nickname: suffix,
                skillModes: [],
                pricePerHour: "15",
                commissionRate: "0.5",
                status: "LISTED",
              },
            },
          }
        : {}),
    },
  });
}

// Only the baseline reproduction injects a barrier after both vulnerable reads.
// Production fixes run unchanged, with independent PostgreSQL transactions.
function baselineBarrier(
  service: "refund" | "recharge",
  participants: number,
): PrismaService {
  if (!baseline) return prisma;
  let reads = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const wait = async () => {
    if (++reads === participants) release();
    await ready;
  };
  return new Proxy(prisma, {
    get(target, prop) {
      if (prop !== "$transaction") return Reflect.get(target, prop);
      return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        target.$transaction(
          async (tx) => {
            const wrapped = new Proxy(tx, {
              get(inner, model) {
                const delegate = Reflect.get(inner, model);
                if (
                  model !== (service === "refund" ? "order" : "rechargeRequest")
                )
                  return delegate;
                return new Proxy(delegate, {
                  get(d, method) {
                    if (
                      method !== (service === "refund" ? "findUnique" : "count")
                    )
                      return Reflect.get(d, method);
                    return async (...args: unknown[]) => {
                      const value = await Reflect.get(d, method).apply(d, args);
                      await wait();
                      return value;
                    };
                  },
                });
              },
            });
            return callback(wrapped);
          },
          { maxWait: 20000, timeout: 20000 },
        );
    },
  }) as PrismaService;
}

beforeAll(() => prisma.$connect());
afterAll(() => prisma.$disconnect());

test("refund: 20 concurrent cancellations refund A once and preserve B's frozen 100", async () => {
  const [customer, admin] = await Promise.all([
    user("CUSTOMER"),
    user("ADMIN"),
  ]);
  await prisma.wallet.update({
    where: { userId: customer.id },
    data: { frozenBalance: "200" },
  });
  const create = () =>
    prisma.order.create({
      data: {
        customerId: customer.id,
        orderNo: randomUUID(),
        mode: "synthetic",
        hours: "1",
        unitPrice: "100",
        totalAmount: "100",
        status: "PAID",
      },
    });
  const [a, b] = await Promise.all([create(), create()]);
  const service = new OrdersService(
    baselineBarrier("refund", 20),
    notifications,
  );
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () =>
      service.cancelOrderByAdmin(admin.id, a.id),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
  const state = await prisma.wallet.findUniqueOrThrow({
    where: { userId: customer.id },
  });
  expect(state.availableBalance.toString()).toBe("100");
  expect(state.frozenBalance.toString()).toBe("100");
  expect(
    (await prisma.order.findUniqueOrThrow({ where: { id: b.id } })).status,
  ).toBe("PAID");
  expect(
    await prisma.walletTransaction.count({
      where: { referenceId: a.id, type: "ORDER_REFUND" },
    }),
  ).toBe(1);
});

test("first recharge: two different approvals credit both principals but only one bonus", async () => {
  const [customer, admin] = await Promise.all([
    user("CUSTOMER"),
    user("ADMIN"),
  ]);
  await prisma.platformSetting.upsert({
    where: { key: "NEW_CUSTOMER_FIRST_RECHARGE_BONUS_AMOUNT" },
    create: { key: "NEW_CUSTOMER_FIRST_RECHARGE_BONUS_AMOUNT", value: "5" },
    update: { value: "5" },
  });
  await prisma.platformSetting.upsert({
    where: { key: "NEW_CUSTOMER_FIRST_RECHARGE_BONUS_RATE" },
    create: { key: "NEW_CUSTOMER_FIRST_RECHARGE_BONUS_RATE", value: "0" },
    update: { value: "0" },
  });
  const requests = await Promise.all(
    [1, 2].map(() =>
      prisma.rechargeRequest.create({
        data: {
          customerId: customer.id,
          amount: "100",
          screenshotUrl: "synthetic-only",
        },
      }),
    ),
  );
  const service = new WalletService(
    baselineBarrier("recharge", 2),
    notifications,
  );
  await Promise.all(
    requests.map((r) =>
      service.reviewRecharge(r.id, admin.id, { status: "APPROVED" }),
    ),
  );
  expect(
    (
      await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.id } })
    ).availableBalance.toString(),
  ).toBe("205");
  expect(
    await prisma.walletTransaction.count({
      where: { userId: customer.id, type: "PROMOTION_BONUS" },
    }),
  ).toBe(1);
  expect(
    await prisma.rechargeRequest.count({
      where: { customerId: customer.id, status: "APPROVED" },
    }),
  ).toBe(2);
});

test("group refund: cancelling a discounted item races safely with starting its sibling", async () => {
  const [customer, a, b, admin] = await Promise.all([
    user("CUSTOMER", "500"),
    user("COMPANION"),
    user("COMPANION"),
    user("ADMIN"),
  ]);
  await prisma.companionProfile.updateMany({
    where: { userId: { in: [a.id, b.id] } },
    data: { pricePerHour: "100" },
  });
  const group = await orders.createOrderGroup(customer.id, { requestId: randomUUID(),
    companionIds: [a.id, b.id],
    mode: "娱乐",
    hours: "1",
    assignedById: admin.id,
  });
  expect(group.orderGroup.totalAmount.toString()).toBe("180");
  await orders.acceptOrderFromWeb(group.orders[1].id, b.id, group.orders[1].dispatchVersion);
  const [cancel, start] = await Promise.allSettled([
    orders.cancelOrderByAdmin(admin.id, group.orders[0].id),
    orders.startOrder(group.orders[1].id, b.id),
  ]);
  expect(start.status).toBe("fulfilled");
  const cw = await prisma.wallet.findUniqueOrThrow({
    where: { userId: customer.id },
  });
  expect(cw.availableBalance.add(cw.frozenBalance).toString()).toBe("500");
  const second = await prisma.order.findUniqueOrThrow({
    where: { id: group.orders[1].id },
  });
  expect(second.status).toBe("IN_PROGRESS");
  if (cancel.status === "fulfilled") {
    expect(cw.frozenBalance.toString()).toBe("100");
    expect(second.totalAmount.toString()).toBe("100");
    expect(
      await prisma.walletTransaction.count({
        where: { referenceId: group.orders[0].id, type: "ORDER_REFUND" },
      }),
    ).toBe(1);
  } else {
    expect(cw.frozenBalance.toString()).toBe("180");
    expect(second.totalAmount.toString()).toBe("90");
  }
});

test("money: sub-persistence precision hours are rejected before any debit", async () => {
  const [customer, companion] = await Promise.all([
    user("CUSTOMER", "100"),
    user("COMPANION"),
  ]);
  await expect(
    orders.createOrder(customer.id, { requestId: randomUUID(),
      mode: "娱乐",
      hours: "0.001",
      companionId: companion.id,
    }),
  ).rejects.toThrow();
  const balance = await prisma.wallet.findUniqueOrThrow({
    where: { userId: customer.id },
  });
  expect(balance.availableBalance.toString()).toBe("100");
  expect(balance.frozenBalance.toString()).toBe("0");
});

test("money: 19.99 at 50 percent commission remains exactly 19.99 after database settlement", async () => {
  const [customer, companion] = await Promise.all([
    user("CUSTOMER"),
    user("COMPANION"),
  ]);
  await prisma.wallet.update({
    where: { userId: customer.id },
    data: { frozenBalance: "19.99" },
  });
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      companionId: companion.id,
      orderNo: randomUUID(),
      mode: "synthetic",
      hours: "1",
      unitPrice: "19.99",
      totalAmount: "19.99",
      commissionRateSnapshot: "0.5",
      status: "IN_PROGRESS",
      startedAt: new Date(0),
    },
  });
  const settled = await orders.completeOrder(order.id, companion.id);
  expect(settled.platformFee.add(settled.companionIncome).toString()).toBe(
    "19.99",
  );
  expect(settled.platformFee.toString()).toBe("10");
  expect(settled.companionIncome.toString()).toBe("9.99");
  if (!baseline) {
    expect(settled.status).toBe("AWAITING_ACCEPTANCE");
    const accepted = await orders.acceptCompletion(order.id, customer.id);
    expect(accepted.status).toBe("COMPLETED");
    expect(
      (
        await prisma.wallet.findUniqueOrThrow({
          where: { userId: companion.id },
        })
      ).availableIncome.toString(),
    ).toBe("9.99");
  }
});

test("money: inputs reject invalid, infinite, negative, zero and oversized amounts", async () => {
  const customer = await user("CUSTOMER");
  for (const amount of [
    "NaN",
    "Infinity",
    "-1",
    "0",
    "0.001",
    "10000000000",
    "1e3",
  ]) {
    await expect(
      wallet.createRechargeRequest(customer.id, { amount }),
    ).rejects.toThrow();
  }
});

test("admin pricing: amounts and commission precision are validated before PostgreSQL can round them", async () => {
  const [companion, admin] = await Promise.all([
    user("COMPANION"),
    user("ADMIN"),
  ]);
  const controller = new AdminController(
    prisma,
    orders,
    {} as any,
    wallet,
    {} as any,
  );
  const actor = { id: admin.id, email: admin.email, role: admin.role };
  for (const pricePerHour of ["0.001", "NaN", "Infinity", "10000000000"])
    await expect(
      controller.updateCompanionPricing(actor, companion.id, { pricePerHour }),
    ).rejects.toThrow();
  await expect(
    controller.updateCompanionCommission(actor, companion.id, {
      commissionRate: "0.12345",
    }),
  ).rejects.toThrow();
  const updated = await controller.updateCompanionCommission(
    actor,
    companion.id,
    { commissionRate: "0.1234" },
  );
  expect(updated.commissionRate).toBe("0.1234");
  expect(
    (
      await prisma.companionProfile.findUniqueOrThrow({
        where: { userId: companion.id },
      })
    ).pricePerHour.toString(),
  ).toBe("15");
});

test("money: cent distributions conserve totals across 2000 boundary combinations", () => {
  for (let cents = 1; cents <= 2000; cents++) {
    const total = new Prisma.Decimal(cents).div(100);
    for (const rate of ["0", "0.0001", "0.2", "0.5", "0.9999", "1"]) {
      const split = commissionSplit(total, new Prisma.Decimal(rate));
      expect(split.platformFee.add(split.companionIncome).equals(total)).toBe(
        true,
      );
      expect(split.platformFee.decimalPlaces()).toBeLessThanOrEqual(2);
      expect(split.companionIncome.decimalPlaces()).toBeLessThanOrEqual(2);
    }
  }
  expect(() => fixedDecimal("9999999999.991", "amount")).toThrow();
});

test("order authorization: assigned companion accepts through either platform exactly once", async () => {
  const [customer, companion, other] = await Promise.all([
    user("CUSTOMER"),
    user("COMPANION"),
    user("COMPANION"),
  ]);
  const ids = {
    discord: randomUUID(),
    kook: randomUUID(),
    other: randomUUID(),
  };
  await prisma.userExternalAccount.createMany({
    data: [
      {
        userId: companion.id,
        platform: "DISCORD",
        externalUserId: ids.discord,
      },
      { userId: companion.id, platform: "KOOK", externalUserId: ids.kook },
      { userId: other.id, platform: "KOOK", externalUserId: ids.other },
    ],
  });
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      companionId: companion.id,
      orderNo: randomUUID(),
      mode: "synthetic",
      hours: "1",
      unitPrice: "100",
      totalAmount: "100",
      status: "ASSIGNED",
    },
  });
  await expect(
    orders.acceptOrderFromPlatform(BotPlatform.KOOK, order.id, ids.other, undefined, order.dispatchVersion),
  ).rejects.toThrow();
  const result = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      orders.acceptOrderFromPlatform(
        i % 2 ? BotPlatform.KOOK : BotPlatform.DISCORD,
        order.id,
        i % 2 ? ids.kook : ids.discord,
        undefined,
        order.dispatchVersion,
      ),
    ),
  );
  expect(result.every((r) => r.status === OrderStatus.ACCEPTED)).toBe(true);
  expect(
    await prisma.orderStatusLog.count({
      where: { orderId: order.id, toStatus: "ACCEPTED" },
    }),
  ).toBe(1);
});

test("fulfillment: immediate self-completion fails; only customer/admin acceptance releases pending income once", async () => {
  const [customer, companion, outsider] = await Promise.all([
    user("CUSTOMER"),
    user("COMPANION"),
    user("CUSTOMER"),
  ]);
  await prisma.wallet.update({
    where: { userId: customer.id },
    data: { frozenBalance: "100" },
  });
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      companionId: companion.id,
      orderNo: randomUUID(),
      mode: "synthetic",
      hours: "1",
      unitPrice: "100",
      totalAmount: "100",
      commissionRateSnapshot: "0.5",
      status: "IN_PROGRESS",
      startedAt: new Date(),
    },
  });
  await expect(orders.completeOrder(order.id, companion.id)).rejects.toThrow(
    "duration",
  );
  await prisma.order.update({
    where: { id: order.id },
    data: { startedAt: new Date(0) },
  });
  await orders.completeOrder(order.id, companion.id);
  const pending = await prisma.wallet.findUniqueOrThrow({
    where: { userId: companion.id },
  });
  expect(pending.pendingIncome.toString()).toBe("50");
  expect(pending.availableIncome.toString()).toBe("0");
  await expect(
    wallet.createWithdrawalRequest(companion.id, {
      amount: "1",
      payoutAccount: "synthetic",
    }),
  ).rejects.toThrow();
  await expect(
    orders.acceptCompletion(order.id, outsider.id),
  ).rejects.toThrow();
  await expect(
    orders.acceptCompletion(order.id, companion.id),
  ).rejects.toThrow();
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () =>
      orders.acceptCompletion(order.id, customer.id),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
  const final = await prisma.wallet.findUniqueOrThrow({
    where: { userId: companion.id },
  });
  expect(final.pendingIncome.toString()).toBe("0");
  expect(final.availableIncome.toString()).toBe("50");
});

test.each(["40", "100"])(
  "fulfillment: manual dispute refund %s preserves customer/companion/platform totals",
  async (refund) => {
    const [customer, companion, admin] = await Promise.all([
      user("CUSTOMER"),
      user("COMPANION"),
      user("ADMIN"),
    ]);
    await prisma.wallet.update({
      where: { userId: customer.id },
      data: { frozenBalance: "100" },
    });
    const order = await prisma.order.create({
      data: {
        customerId: customer.id,
        companionId: companion.id,
        orderNo: randomUUID(),
        mode: "synthetic",
        hours: "1",
        unitPrice: "100",
        totalAmount: "100",
        commissionRateSnapshot: "0.5",
        status: "IN_PROGRESS",
        startedAt: new Date(0),
      },
    });
    await orders.completeOrder(order.id, companion.id);
    await new ComplaintsController(prisma).createComplaint(
      { id: customer.id, email: customer.email, role: customer.role },
      { orderId: order.id, reason: "synthetic dispute" },
    );
    await expect(
      orders.acceptCompletion(order.id, customer.id),
    ).rejects.toThrow();
    await expect(
      orders.acceptCompletion(order.id, admin.id, "", refund),
    ).rejects.toThrow();
    const resolved = await orders.acceptCompletion(
      order.id,
      admin.id,
      "Synthetic evidence checked and agreed resolution",
      refund,
    );
    const cw = await prisma.wallet.findUniqueOrThrow({
      where: { userId: customer.id },
    });
    const pw = await prisma.wallet.findUniqueOrThrow({
      where: { userId: companion.id },
    });
    expect(
      cw.availableBalance
        .add(pw.availableIncome)
        .add(resolved.platformFee)
        .toString(),
    ).toBe("100");
    expect(cw.frozenBalance.toString()).toBe("0");
    expect(pw.pendingIncome.toString()).toBe("0");
    expect(cw.availableBalance.toString()).toBe(refund);
    await expect(
      orders.acceptCompletion(order.id, admin.id, "repeat", refund),
    ).rejects.toThrow();
  },
);

test("fulfillment: a complaint after acceptance reserves only that order's income, allowing unrelated earnings", async () => {
  const [customer, companion, admin] = await Promise.all([
    user("CUSTOMER"),
    user("COMPANION"),
    user("ADMIN"),
  ]);
  await prisma.wallet.update({
    where: { userId: companion.id },
    data: { availableIncome: "80" },
  });
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      companionId: companion.id,
      orderNo: randomUUID(),
      mode: "synthetic",
      hours: "1",
      unitPrice: "100",
      totalAmount: "100",
      companionIncome: "50",
      platformFee: "50",
      status: "COMPLETED",
      verifiedAt: new Date(),
    },
  });
  await new ComplaintsController(prisma).createComplaint(
    { id: customer.id, email: customer.email, role: customer.role },
    { orderId: order.id, reason: "synthetic post-acceptance appeal" },
  );
  const summary = await wallet.getCompanionWalletSummary(companion.id);
  expect(summary.wallet?.availableIncome).toBe("30");
  expect(summary.wallet?.disputeReserve).toBe("50");
  await expect(
    wallet.createWithdrawalRequest(companion.id, {
      amount: "31",
      payoutAccount: "synthetic",
    }),
  ).rejects.toThrow();
  const withdrawal = await wallet.createWithdrawalRequest(companion.id, {
    amount: "30",
    payoutAccount: "synthetic",
  });
  await wallet.reviewWithdrawal(withdrawal.id, admin.id, {
    status: "APPROVED",
    note: "Synthetic unrelated income reviewed",
  });
  expect(
    (
      await prisma.wallet.findUniqueOrThrow({ where: { userId: companion.id } })
    ).availableIncome.toString(),
  ).toBe("50");
});
