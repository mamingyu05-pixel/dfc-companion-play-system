import { randomUUID } from "node:crypto";
import { OrderStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { OperationsService } from "../src/modules/admin/operations.service";

const prisma = new PrismaService();
const service = new OperationsService(prisma);
beforeAll(() => prisma.$connect());
afterAll(() => prisma.$disconnect());

test("operations: financial recognition, refund, appeal, historical and test exclusions reconcile to original orders", async () => {
  const store = randomUUID();
  const person = async (role: "CUSTOMER" | "COMPANION") => {
    const id = randomUUID();
    return prisma.user.create({
      data: {
        email: `${id}@synthetic.invalid`,
        displayName: id,
        displayNameKey: id,
        passwordHash: "synthetic",
        role,
      },
    });
  };
  const [customer, companion] = await Promise.all([
    person("CUSTOMER"),
    person("COMPANION"),
  ]);
  const date = new Date("2030-01-15T12:00:00Z");
  const make = (data: Partial<Prisma.OrderUncheckedCreateInput> = {}) =>
    prisma.order.create({
      data: {
        customerId: customer.id,
        companionId: companion.id,
        orderNo: randomUUID(),
        mode: "synthetic",
        hours: "1",
        unitPrice: "100",
        totalAmount: "100",
        status: OrderStatus.COMPLETED,
        verifiedAt: date,
        createdAt: date,
        platformFee: "40",
        companionIncome: "40",
        refundAmount: "20",
        storeKey: store,
        ...data,
      },
    });
  const a = await make();
  const appealed = await make({
    totalAmount: "40",
    refundAmount: "0",
    platformFee: "20",
    companionIncome: "20",
  });
  await prisma.complaint.create({
    data: {
      orderId: appealed.id,
      reporterId: customer.id,
      reason: "synthetic pending appeal",
    },
  });
  const historical = await make({ verifiedAt: null });
  const testOrder = await make({ totalAmount: "999", isTest: true });
  await make({ storeKey: "OTHER-SYNTHETIC-STORE" });
  const pending = await make({
    status: "AWAITING_ACCEPTANCE",
    verifiedAt: null,
  });
  const wallet = await prisma.wallet.create({ data: { userId: companion.id } });
  await prisma.walletTransaction.create({
    data: {
      walletId: wallet.id,
      userId: companion.id,
      type: "REFERRAL_REWARD",
      direction: "CREDIT",
      amount: "5",
      balanceAfter: "5",
      referenceType: "ORDER_REFERRAL_COMMISSION",
      referenceId: a.id,
    },
  });
  const report = await service.overview({
    from: "2030-01-01T00:00:00Z",
    to: "2030-02-01T00:00:00Z",
    store,
  });
  expect(report.financial.serviceRevenue).toBe("120.00");
  expect(report.financial.grossCommission).toBe("60.00");
  expect(report.financial.knownCostContribution).toBe("55.00");
  expect(report.financial.recognizedRevenueUnderReview).toBe("40.00");
  expect(report.financial.historicalUnverifiedCount).toBe(1);
  expect(report.financial.recognizedOrderCount).toBe(2);
  expect(
    report.orderEvidence.find((o) => o.id === historical.id)?.includedInRevenue,
  ).toBe(false);
  expect(report.orderEvidence.some((o) => o.id === testOrder.id)).toBe(false);
  expect(report.exceptions.orders.some((o) => o.id === pending.id)).toBe(true);
  expect(report.companionMetrics[0].orderIds).not.toContain(appealed.id);
  expect(report.companionMetrics[0].sampleWarning).toBeTruthy();
  expect(
    report.cohorts
      .reduce((sum, c) => sum.add(c.serviceRevenue), new Prisma.Decimal(0))
      .toFixed(2),
  ).toBe(report.financial.serviceRevenue);
  expect(report.formulas.walletScope).toContain("全平台");
});

test("operations: malformed periods, oversized windows and unknown dimensions are rejected", async () => {
  for (const query of [
    { from: "not-a-date" },
    { from: "2020-01-01", to: "2030-01-01" },
    { game: "UNKNOWN" },
    { tier: "UNKNOWN" },
  ]) {
    await expect(service.overview(query)).rejects.toThrow();
  }
});
