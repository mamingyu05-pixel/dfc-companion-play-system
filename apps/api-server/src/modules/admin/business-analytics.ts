import { BadRequestException } from "@nestjs/common";
import { GameCode, Prisma, ServicePriceTier } from "@prisma/client";

export type AnalyticsQuery = {
  from?: string;
  to?: string;
  store?: string;
  game?: string;
  tier?: string;
};

export type AnalyticsPeriod = { from: Date; to: Date };

// Orders that never took money or were fully reversed are not business volume.
export const EXCLUDED_ORDER_STATUSES = ["PENDING_PAYMENT", "CANCELLED", "REFUNDED"];
const UNRESOLVED_COMPLAINTS = ["OPEN", "IN_REVIEW"];
const DAY_MS = 86_400_000;
const zero = () => new Prisma.Decimal(0);
const total = (values: Prisma.Decimal[]) =>
  values.reduce((sum, value) => sum.add(value), zero());
const money = (value: Prisma.Decimal | null | undefined) =>
  (value ?? zero()).toFixed(2);
const ratio = (numerator: number, denominator: number) => ({
  numerator,
  denominator,
  rate: denominator ? Math.round((numerator / denominator) * 1000) / 10 : null,
});
const dayKey = (date: Date) => date.toISOString().slice(0, 10);

export type AnalyticsOrder = {
  id: string;
  customerId: string;
  companionId: string | null;
  status: string;
  mode: string;
  priceTier: string;
  hours: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  refundAmount: Prisma.Decimal;
  platformFee: Prisma.Decimal;
  companionIncome: Prisma.Decimal;
  createdAt: Date;
  acceptedAt: Date | null;
  customer: { displayName: string } | null;
  companion: { displayName: string } | null;
  complaints: Array<{ status: string }>;
  review: { stars: number; hidden: boolean } | null;
};

export function parseAnalyticsQuery(query: AnalyticsQuery, now = new Date()) {
  const to = query.to ? new Date(query.to) : now;
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - 30 * DAY_MS);
  if (
    !Number.isFinite(from.getTime()) ||
    !Number.isFinite(to.getTime()) ||
    from >= to ||
    to.getTime() - from.getTime() > 366 * DAY_MS
  )
    throw new BadRequestException(
      "Use a valid date range of at most 366 days; end is exclusive",
    );
  if (query.game && !Object.values(GameCode).includes(query.game as GameCode))
    throw new BadRequestException("Invalid game");
  if (
    query.tier &&
    !Object.values(ServicePriceTier).includes(query.tier as ServicePriceTier)
  )
    throw new BadRequestException("Invalid price tier");
  const orderScope: Prisma.OrderWhereInput = {
    isTest: false,
    ...(query.store ? { storeKey: query.store } : {}),
    ...(query.game ? { game: query.game as GameCode } : {}),
    ...(query.tier ? { priceTier: query.tier as ServicePriceTier } : {}),
  };
  return { period: { from, to } as AnalyticsPeriod, orderScope };
}

export const isBusinessOrder = (order: { status: string }) =>
  !EXCLUDED_ORDER_STATUSES.includes(order.status);
const netAmount = (order: AnalyticsOrder) =>
  order.totalAmount.sub(order.refundAmount);

function emptyDays<T>(period: AnalyticsPeriod, make: () => T) {
  const days = new Map<string, T>();
  const start = new Date(period.from);
  start.setUTCHours(0, 0, 0, 0);
  for (let t = start.getTime(); t < period.to.getTime(); t += DAY_MS)
    days.set(dayKey(new Date(t)), make());
  return days;
}

function topBy<T>(rows: T[], score: (row: T) => Prisma.Decimal, limit = 10) {
  return [...rows].sort((a, b) => score(b).comparedTo(score(a))).slice(0, limit);
}

export type CustomerBoardInput = {
  period: AnalyticsPeriod;
  orders: AnalyticsOrder[];
  newCustomers: Array<{ id: string; createdAt: Date }>;
  newCustomerRechargedIds: string[];
  returningCustomerIds: string[];
  approvedRecharges: Array<{
    customerId: string;
    amount: Prisma.Decimal;
    promotionBonus: Prisma.Decimal;
    reviewedAt: Date | null;
  }>;
  customerWallets: {
    availableBalance: Prisma.Decimal | null;
    frozenBalance: Prisma.Decimal | null;
  };
  customersWithBalance: number;
};

export function buildCustomerBoard(input: CustomerBoardInput) {
  const orders = input.orders.filter(isBusinessOrder);
  const byCustomer = new Map<string, AnalyticsOrder[]>();
  for (const order of orders)
    byCustomer.set(order.customerId, [
      ...(byCustomer.get(order.customerId) ?? []),
      order,
    ]);
  const payers = [...byCustomer.keys()];
  const newIds = new Set(input.newCustomers.map((c) => c.id));
  const recharged = new Set(input.newCustomerRechargedIds);
  const returning = new Set(input.returningCustomerIds);
  const orderAmount = total(orders.map(netAmount));
  const rechargePrincipal = total(input.approvedRecharges.map((r) => r.amount));
  const rechargeBonus = total(
    input.approvedRecharges.map((r) => r.promotionBonus),
  );

  const byTier = new Map<string, AnalyticsOrder[]>();
  for (const order of orders) {
    const key = `${order.priceTier} / ${order.mode}`;
    byTier.set(key, [...(byTier.get(key) ?? []), order]);
  }

  const trend = emptyDays(input.period, () => ({
    newCustomers: 0,
    orders: 0,
    orderAmount: zero(),
    rechargePrincipal: zero(),
  }));
  for (const customer of input.newCustomers) {
    const day = trend.get(dayKey(customer.createdAt));
    if (day) day.newCustomers += 1;
  }
  for (const order of orders) {
    const day = trend.get(dayKey(order.createdAt));
    if (!day) continue;
    day.orders += 1;
    day.orderAmount = day.orderAmount.add(netAmount(order));
  }
  for (const recharge of input.approvedRecharges) {
    const day = recharge.reviewedAt && trend.get(dayKey(recharge.reviewedAt));
    if (day) day.rechargePrincipal = day.rechargePrincipal.add(recharge.amount);
  }

  return {
    summary: {
      newCustomers: input.newCustomers.length,
      newCustomerRecharge: ratio(
        [...newIds].filter((id) => recharged.has(id)).length,
        newIds.size,
      ),
      newCustomerFirstOrder: ratio(
        [...newIds].filter((id) => byCustomer.has(id)).length,
        newIds.size,
      ),
      payingCustomers: payers.length,
      repeatInPeriod: ratio(
        payers.filter((id) => byCustomer.get(id)!.length > 1).length,
        payers.length,
      ),
      returningCustomers: ratio(
        payers.filter((id) => returning.has(id)).length,
        payers.length,
      ),
      orderCount: orders.length,
      orderAmount: money(orderAmount),
      averageOrderAmount: money(
        orders.length ? orderAmount.div(orders.length) : null,
      ),
      amountPerPayingCustomer: money(
        payers.length ? orderAmount.div(payers.length) : null,
      ),
      rechargePrincipal: money(rechargePrincipal),
      rechargeBonus: money(rechargeBonus),
      rechargeCount: input.approvedRecharges.length,
      balanceAvailable: money(input.customerWallets.availableBalance),
      balanceFrozen: money(input.customerWallets.frozenBalance),
      customersWithBalance: input.customersWithBalance,
    },
    tierBreakdown: [...byTier]
      .map(([key, rows]) => ({
        key,
        orders: rows.length,
        hours: total(rows.map((o) => o.hours)).toString(),
        amount: money(total(rows.map(netAmount))),
      }))
      .sort((a, b) => b.orders - a.orders),
    topCustomers: topBy(
      payers.map((id) => {
        const rows = byCustomer.get(id)!;
        return {
          id,
          name: rows[0].customer?.displayName ?? id,
          orders: rows.length,
          amount: total(rows.map(netAmount)),
          returning: returning.has(id),
          isNew: newIds.has(id),
        };
      }),
      (row) => row.amount,
    ).map((row) => ({ ...row, amount: money(row.amount) })),
    trend: [...trend].map(([day, row]) => ({
      day,
      newCustomers: row.newCustomers,
      orders: row.orders,
      orderAmount: money(row.orderAmount),
      rechargePrincipal: money(row.rechargePrincipal),
    })),
  };
}

export type CompanionBoardInput = {
  period: AnalyticsPeriod;
  orders: AnalyticsOrder[];
  profiles: Array<{
    userId: string;
    status: string;
    onlineStatus: string;
    createdAt: Date;
  }>;
  withdrawals: Array<{
    status: string;
    amount: Prisma.Decimal;
    createdAt: Date;
    paidAt: Date | null;
  }>;
};

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

export function buildCompanionBoard(input: CompanionBoardInput) {
  const { from, to } = input.period;
  const inWindow = (date: Date | null) =>
    date !== null && date >= from && date < to;
  const orders = input.orders.filter(
    (o) => isBusinessOrder(o) && o.companionId,
  );
  const completed = orders.filter((o) => o.status === "COMPLETED");
  const latencies = orders
    .filter((o) => o.acceptedAt && o.acceptedAt >= o.createdAt)
    .map((o) => (o.acceptedAt!.getTime() - o.createdAt.getTime()) / 60_000)
    .sort((a, b) => a - b);
  const reviews = orders.filter((o) => o.review && !o.review.hidden);
  const complained = orders.filter((o) => o.complaints.length > 0);
  const upheld = orders.filter((o) =>
    o.complaints.some((c) => c.status === "RESOLVED"),
  );

  const listed = input.profiles.filter((p) => p.status === "LISTED");
  const joined = input.profiles.filter((p) => inWindow(p.createdAt));
  const funnel: Record<string, number> = {
    PENDING_REVIEW: 0,
    LISTED: 0,
    UNLISTED: 0,
    BANNED: 0,
  };
  for (const profile of joined)
    funnel[profile.status] = (funnel[profile.status] ?? 0) + 1;

  const requested = input.withdrawals.filter((w) => inWindow(w.createdAt));
  const paid = input.withdrawals.filter(
    (w) => w.status === "PAID" && inWindow(w.paidAt),
  );
  const open = input.withdrawals.filter((w) =>
    ["PENDING", "APPROVED"].includes(w.status),
  );

  const byCompanion = new Map<string, AnalyticsOrder[]>();
  for (const order of orders)
    byCompanion.set(order.companionId!, [
      ...(byCompanion.get(order.companionId!) ?? []),
      order,
    ]);

  const trend = emptyDays(input.period, () => ({
    orders: 0,
    serviceHours: zero(),
    companionIncome: zero(),
  }));
  for (const order of orders) {
    const day = trend.get(dayKey(order.createdAt));
    if (!day) continue;
    day.orders += 1;
    if (order.status === "COMPLETED") {
      day.serviceHours = day.serviceHours.add(order.hours);
      day.companionIncome = day.companionIncome.add(order.companionIncome);
    }
  }

  const averageStars = (rows: AnalyticsOrder[]) => {
    const visible = rows.filter((o) => o.review && !o.review.hidden);
    return visible.length
      ? Math.round(
          (visible.reduce((sum, o) => sum + o.review!.stars, 0) /
            visible.length) *
            10,
        ) / 10
      : null;
  };

  return {
    summary: {
      listedCompanions: listed.length,
      onlineNow: listed.filter((p) => p.onlineStatus === "ONLINE").length,
      busyNow: listed.filter((p) => p.onlineStatus === "BUSY").length,
      activeCompanions: byCompanion.size,
      orderCount: orders.length,
      completedCount: completed.length,
      serviceHours: total(completed.map((o) => o.hours)).toString(),
      companionIncome: money(total(completed.map((o) => o.companionIncome))),
      platformFee: money(total(completed.map((o) => o.platformFee))),
      acceptMinutes: {
        sample: latencies.length,
        median: percentile(latencies, 0.5),
        p90: percentile(latencies, 0.9),
      },
      complaintOrders: ratio(complained.length, orders.length),
      upheldComplaintOrders: ratio(upheld.length, orders.length),
      reviews: { count: reviews.length, averageStars: averageStars(orders) },
      withdrawalRequested: money(total(requested.map((w) => w.amount))),
      withdrawalRequestedCount: requested.length,
      withdrawalPaid: money(total(paid.map((w) => w.amount))),
      withdrawalPaidCount: paid.length,
      withdrawalOpen: money(total(open.map((w) => w.amount))),
      withdrawalOpenCount: open.length,
    },
    recruitment: { joined: joined.length, byStatus: funnel },
    topCompanions: topBy(
      [...byCompanion].map(([id, rows]) => {
        const done = rows.filter((o) => o.status === "COMPLETED");
        const perCustomer = new Map<string, number>();
        for (const o of done)
          perCustomer.set(o.customerId, (perCustomer.get(o.customerId) ?? 0) + 1);
        return {
          id,
          name: rows[0].companion?.displayName ?? id,
          orders: rows.length,
          completed: done.length,
          serviceHours: total(done.map((o) => o.hours)),
          income: total(done.map((o) => o.companionIncome)),
          averageStars: averageStars(rows),
          complaintOrders: rows.filter((o) => o.complaints.length > 0).length,
          openComplaintOrders: rows.filter((o) =>
            o.complaints.some((c) => UNRESOLVED_COMPLAINTS.includes(c.status)),
          ).length,
          repeatCustomers: [...perCustomer.values()].filter((n) => n > 1)
            .length,
        };
      }),
      (row) => row.serviceHours,
    ).map((row) => ({
      ...row,
      serviceHours: row.serviceHours.toString(),
      income: money(row.income),
    })),
    trend: [...trend].map(([day, row]) => ({
      day,
      orders: row.orders,
      serviceHours: row.serviceHours.toString(),
      companionIncome: money(row.companionIncome),
    })),
  };
}

export const ANALYTICS_FORMULAS = {
  orders:
    "订单按下单时间（UTC）归入观察窗；排除测试单及待支付、已取消、已全额退款订单；金额为实付减订单退款。",
  scope:
    "门店/游戏/价档过滤只作用于订单类指标；新增客户、充值、钱包余额、陪玩档案和提现是全平台口径。",
  customers:
    "首充转化 = 观察窗内注册且在窗口结束前有已审核充值的客户 / 窗内新客户；回头客 = 窗内下单且窗口前已有有效订单的客户。",
  companions:
    "服务时长、陪玩收入和平台佣金只计当前已完成订单；接单时长 = 接单时间减下单时间，平台代选单包含客服选人时间。",
  reconciliation:
    "本看板用于经营趋势，不替代财务确认收入；以已验收为准的收入、冻结对账请看「经营与绩效」。",
};
