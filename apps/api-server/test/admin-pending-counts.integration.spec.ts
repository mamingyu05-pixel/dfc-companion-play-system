import { randomUUID } from "node:crypto";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { AdminController } from "../src/modules/admin/admin.controller";

const prisma = new PrismaService();
const controller = new AdminController(prisma, {} as any, {} as any, {} as any, {} as any);
beforeAll(() => prisma.$connect());
afterAll(() => prisma.$disconnect());

test("pending counts: each navigation badge moves by exactly the queue it represents", async () => {
  const before = await controller.pendingCounts();
  const suffix = randomUUID();
  const customer = await prisma.user.create({ data: { email: `${suffix}@synthetic.invalid`, displayName: suffix, displayNameKey: suffix,
    passwordHash: "synthetic-unusable-hash", role: "CUSTOMER" } });
  const order = (status: "PAID" | "ASSIGNED" | "DISPUTED" | "COMPLETED") => prisma.order.create({ data: {
    customerId: customer.id, orderNo: randomUUID(), mode: "synthetic", hours: "1", unitPrice: "1", totalAmount: "1", status } });
  const [paid] = await Promise.all([order("PAID"), order("ASSIGNED"), order("DISPUTED"), order("COMPLETED")]);
  await prisma.rechargeRequest.createMany({ data: [
    { customerId: customer.id, amount: "10", screenshotUrl: "synthetic", status: "PENDING" },
    { customerId: customer.id, amount: "10", screenshotUrl: "synthetic", status: "APPROVED" }
  ] });
  await prisma.complaint.createMany({ data: [
    { orderId: paid.id, reporterId: customer.id, reason: "x", status: "OPEN" },
    { orderId: paid.id, reporterId: customer.id, reason: "y", status: "RESOLVED" }
  ] });

  const after = await controller.pendingCounts();
  expect({
    dispatch: after.dispatch - before.dispatch,
    disputes: after.disputes - before.disputes,
    recharges: after.recharges - before.recharges,
    complaints: after.complaints - before.complaints,
    withdrawals: after.withdrawals - before.withdrawals,
  }).toEqual({ dispatch: 2, disputes: 1, recharges: 1, complaints: 1, withdrawals: 0 });
  expect(Number.isFinite(Date.parse(after.checkedAt))).toBe(true);
});
