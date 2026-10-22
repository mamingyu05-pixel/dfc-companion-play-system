import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  AnalyticsOrder,
  buildCompanionBoard,
  buildCustomerBoard,
  parseAnalyticsQuery,
} from "../src/modules/admin/business-analytics";

const d = (value: string | number) => new Prisma.Decimal(value);
const period = {
  from: new Date("2030-01-01T00:00:00Z"),
  to: new Date("2030-01-04T00:00:00Z"),
};
let seq = 0;
const order = (data: Partial<AnalyticsOrder> = {}): AnalyticsOrder => ({
  id: `o${++seq}`,
  customerId: "c1",
  companionId: "p1",
  status: "COMPLETED",
  mode: "烽火",
  priceTier: "RANKED",
  hours: d(2),
  totalAmount: d(200),
  refundAmount: d(0),
  platformFee: d(40),
  companionIncome: d(160),
  createdAt: new Date("2030-01-01T10:00:00Z"),
  acceptedAt: new Date("2030-01-01T10:04:00Z"),
  customer: { displayName: "老板一" },
  companion: { displayName: "陪玩一" },
  complaints: [],
  review: null,
  ...data,
});

test("analytics query: validates window and filters like the operations report", () => {
  const now = new Date("2030-02-01T00:00:00Z");
  const { period: p, orderScope } = parseAnalyticsQuery({}, now);
  expect(p.to).toEqual(now);
  expect(p.from).toEqual(new Date("2030-01-02T00:00:00Z"));
  expect(orderScope).toEqual({ isTest: false });
  expect(
    parseAnalyticsQuery({ store: "MAIN", game: "DELTA_FORCE", tier: "RANKED" }, now)
      .orderScope,
  ).toEqual({ isTest: false, storeKey: "MAIN", game: "DELTA_FORCE", priceTier: "RANKED" });
  for (const bad of [
    { from: "2030-01-05", to: "2030-01-05" },
    { from: "2028-01-01", to: "2030-01-05" },
    { from: "nope" },
    { game: "TETRIS" },
    { tier: "FREE" },
  ])
    expect(() => parseAnalyticsQuery(bad, now)).toThrow(BadRequestException);
});

test("customer board: excludes non-business orders, nets refunds and splits new/repeat/returning", () => {
  const board = buildCustomerBoard({
    period,
    orders: [
      order({ customerId: "c1", totalAmount: d(200), refundAmount: d(50) }),
      order({ customerId: "c1", createdAt: new Date("2030-01-02T01:00:00Z") }),
      order({ customerId: "c2", customer: { displayName: "老板二" }, totalAmount: d(100), priceTier: "ENTERTAINMENT" }),
      order({ customerId: "c3", status: "CANCELLED", totalAmount: d(999) }),
      order({ customerId: "c3", status: "PENDING_PAYMENT", totalAmount: d(999) }),
      order({ customerId: "c3", status: "REFUNDED", totalAmount: d(999), refundAmount: d(999) }),
    ],
    newCustomers: [
      { id: "c2", createdAt: new Date("2030-01-01T05:00:00Z") },
      { id: "c3", createdAt: new Date("2030-01-03T05:00:00Z") },
    ],
    newCustomerRechargedIds: ["c2", "c3"],
    returningCustomerIds: ["c1"],
    approvedRecharges: [
      { customerId: "c2", amount: d(500), promotionBonus: d(30), reviewedAt: new Date("2030-01-01T06:00:00Z") },
      { customerId: "c3", amount: d(100), promotionBonus: d(0), reviewedAt: new Date("2030-01-03T06:00:00Z") },
    ],
    customerWallets: { availableBalance: d(420), frozenBalance: null },
    customersWithBalance: 2,
  });
  expect(board.summary).toMatchObject({
    newCustomers: 2,
    newCustomerRecharge: { numerator: 2, denominator: 2, rate: 100 },
    newCustomerFirstOrder: { numerator: 1, denominator: 2, rate: 50 },
    payingCustomers: 2,
    repeatInPeriod: { numerator: 1, denominator: 2, rate: 50 },
    returningCustomers: { numerator: 1, denominator: 2, rate: 50 },
    orderCount: 3,
    orderAmount: "450.00",
    averageOrderAmount: "150.00",
    amountPerPayingCustomer: "225.00",
    rechargePrincipal: "600.00",
    rechargeBonus: "30.00",
    rechargeCount: 2,
    balanceAvailable: "420.00",
    balanceFrozen: "0.00",
  });
  expect(board.topCustomers.map((c) => [c.id, c.amount, c.returning, c.isNew])).toEqual([
    ["c1", "350.00", true, false],
    ["c2", "100.00", false, true],
  ]);
  expect(board.tierBreakdown[0]).toEqual({ key: "RANKED / 烽火", orders: 2, hours: "4", amount: "350.00" });
  expect(board.trend).toEqual([
    { day: "2030-01-01", newCustomers: 1, orders: 2, orderAmount: "250.00", rechargePrincipal: "500.00" },
    { day: "2030-01-02", newCustomers: 0, orders: 1, orderAmount: "200.00", rechargePrincipal: "0.00" },
    { day: "2030-01-03", newCustomers: 1, orders: 0, orderAmount: "0.00", rechargePrincipal: "100.00" },
  ]);
});

test("customer board: empty window reports null rates instead of zero success", () => {
  const board = buildCustomerBoard({
    period,
    orders: [],
    newCustomers: [],
    newCustomerRechargedIds: [],
    returningCustomerIds: [],
    approvedRecharges: [],
    customerWallets: { availableBalance: null, frozenBalance: null },
    customersWithBalance: 0,
  });
  expect(board.summary.newCustomerRecharge.rate).toBeNull();
  expect(board.summary.repeatInPeriod.rate).toBeNull();
  expect(board.summary.averageOrderAmount).toBe("0.00");
  expect(board.trend).toHaveLength(3);
});

test("companion board: supply, latency, complaints, reviews, withdrawals and ranking", () => {
  const board = buildCompanionBoard({
    period,
    orders: [
      order({ review: { stars: 5, hidden: false } }),
      order({ customerId: "c2", acceptedAt: new Date("2030-01-01T10:20:00Z"), review: { stars: 3, hidden: false } }),
      order({ status: "IN_PROGRESS", acceptedAt: new Date("2030-01-01T10:10:00Z"), review: { stars: 1, hidden: true } }),
      order({ companionId: "p2", companion: { displayName: "陪玩二" }, hours: d(1), companionIncome: d(80), platformFee: d(20), acceptedAt: null, complaints: [{ status: "RESOLVED" }] }),
      order({ companionId: "p2", companion: { displayName: "陪玩二" }, status: "DISPUTED", acceptedAt: new Date("2030-01-01T11:00:00Z"), complaints: [{ status: "OPEN" }] }),
      order({ companionId: null, status: "PAID", acceptedAt: null }),
      order({ status: "CANCELLED", hours: d(9) }),
    ],
    profiles: [
      { userId: "p1", status: "LISTED", onlineStatus: "ONLINE", createdAt: new Date("2029-06-01T00:00:00Z") },
      { userId: "p2", status: "LISTED", onlineStatus: "BUSY", createdAt: new Date("2030-01-02T00:00:00Z") },
      { userId: "p3", status: "PENDING_REVIEW", onlineStatus: "OFFLINE", createdAt: new Date("2030-01-02T00:00:00Z") },
      { userId: "p4", status: "LISTED", onlineStatus: "OFFLINE", createdAt: new Date("2030-01-03T00:00:00Z") },
    ],
    withdrawals: [
      { status: "PAID", amount: d(100), createdAt: new Date("2029-12-30T00:00:00Z"), paidAt: new Date("2030-01-01T00:00:00Z") },
      { status: "PENDING", amount: d(60), createdAt: new Date("2030-01-02T00:00:00Z"), paidAt: null },
      { status: "APPROVED", amount: d(40), createdAt: new Date("2029-12-01T00:00:00Z"), paidAt: null },
    ],
  });
  expect(board.summary).toMatchObject({
    listedCompanions: 3,
    onlineNow: 1,
    busyNow: 1,
    activeCompanions: 2,
    orderCount: 5,
    completedCount: 3,
    serviceHours: "5",
    companionIncome: "400.00",
    platformFee: "100.00",
    acceptMinutes: { sample: 4, median: 10, p90: 60 },
    complaintOrders: { numerator: 2, denominator: 5, rate: 40 },
    upheldComplaintOrders: { numerator: 1, denominator: 5, rate: 20 },
    reviews: { count: 2, averageStars: 4 },
    withdrawalRequested: "60.00",
    withdrawalPaid: "100.00",
    withdrawalOpen: "100.00",
    withdrawalOpenCount: 2,
  });
  expect(board.recruitment).toEqual({
    joined: 3,
    byStatus: { PENDING_REVIEW: 1, LISTED: 2, UNLISTED: 0, BANNED: 0 },
  });
  expect(board.topCompanions.map((c) => [c.id, c.serviceHours, c.income, c.averageStars, c.complaintOrders, c.openComplaintOrders])).toEqual([
    ["p1", "4", "320.00", 4, 0, 0],
    ["p2", "1", "80.00", null, 2, 1],
  ]);
  expect(board.trend[0]).toEqual({ day: "2030-01-01", orders: 5, serviceHours: "5", companionIncome: "400.00" });
});
