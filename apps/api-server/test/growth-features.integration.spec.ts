import { randomUUID } from "node:crypto";
import { UserRole } from "@prisma/client";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";
import { ServicePackagesController } from "../src/modules/admin/service-packages.controller";

const prisma = new PrismaService();
const notifications = { sendOrderAssignedNotifications: jest.fn().mockResolvedValue([]), refreshAcceptedOrderCards: jest.fn() } as unknown as BotNotificationService;
const orders = new OrdersService(prisma, notifications);
const packages = new ServicePackagesController(prisma, orders);
const SETTINGS = ["MEMBER_LV3_DISCOUNT_RATE", "TIP_COMMISSION_RATE"];
beforeAll(() => prisma.$connect());
afterAll(async () => {
  // The synthetic database is shared by every suite: put the settings back to "off".
  await prisma.platformSetting.updateMany({ where: { key: { in: SETTINGS } }, data: { value: "1" } });
  await prisma.platformSetting.updateMany({ where: { key: "TIP_COMMISSION_RATE" }, data: { value: "0" } });
  await prisma.$disconnect();
});
const setting = (key: string, value: string) =>
  prisma.platformSetting.upsert({ where: { key }, create: { key, value }, update: { value } });

async function user(role: UserRole, balance = "1000") {
  const name = randomUUID();
  return prisma.user.create({ data: {
    email: `${name}@synthetic.invalid`, displayName: name, displayNameKey: name, passwordHash: "x", role,
    wallet: { create: { availableBalance: balance } },
    ...(role === "COMPANION" ? { companionProfile: { create: { nickname: name, skillModes: [], pricePerHour: "60.00", status: "LISTED", onlineStatus: "ONLINE" } } } : {})
  } });
}
const approvedRecharge = (customerId: string, amount: string) =>
  prisma.rechargeRequest.create({ data: { customerId, amount, screenshotUrl: "synthetic://recharge", status: "APPROVED", reviewedAt: new Date() } });

test("member discount: Lv.3 pays the member price, the list price stays on the order, negotiated prices are untouched", async () => {
  await setting("MEMBER_LV3_DISCOUNT_RATE", "0.9");
  const companion = await user("COMPANION");
  const member = await user("CUSTOMER");
  await approvedRecharge(member.id, "600");
  const newcomer = await user("CUSTOMER");

  const preview = await orders.previewCustomerOrder(member.id, { mode: "烽火地带", hours: "2", companionId: companion.id });
  expect(preview).toMatchObject({ unitPrice: "54.00", totalAmount: "108.00", originalTotalAmount: "120.00", memberDiscount: { level: 3 } });
  expect(await orders.previewCustomerOrder(newcomer.id, { mode: "烽火地带", hours: "2", companionId: companion.id }))
    .toMatchObject({ totalAmount: "120.00", memberDiscount: null });

  const order = await orders.createOrder(member.id, { requestId: randomUUID(), mode: "烽火地带", hours: "2", companionId: companion.id, expectedTotalAmount: "108.00" });
  expect(order.totalAmount.toFixed(2)).toBe("108.00");
  expect(order.originalAmount?.toFixed(2)).toBe("120.00");
  expect(order.memberDiscountRate?.toString()).toBe("0.9");
  expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: member.id } })).availableBalance.toFixed(2)).toBe("892.00");

  // A staff-negotiated price is the deal already.
  expect(await orders.quoteOrder({ mode: "烽火地带", hours: "1", companionId: companion.id, priceTier: "CUSTOM", customUnitPrice: "80" }, member.id))
    .toMatchObject({ totalAmount: "80.00", memberDiscount: null });
});

test("tips: paid once per request from available balance into the companion's withdrawable income, only after completion is reported", async () => {
  await setting("TIP_COMMISSION_RATE", "0.1");
  const customer = await user("CUSTOMER", "200");
  const companion = await user("COMPANION");
  const order = await orders.createOrder(customer.id, { requestId: randomUUID(), mode: "烽火地带", hours: "1", companionId: companion.id });
  await expect(orders.tipCompanion(order.id, customer.id, { amount: "10", requestId: randomUUID() })).rejects.toThrow("陪玩报完成后");
  await prisma.order.update({ where: { id: order.id }, data: { status: "AWAITING_ACCEPTANCE" } });

  const requestId = randomUUID();
  expect(await orders.tipCompanion(order.id, customer.id, { amount: "20", requestId })).toMatchObject({ replayed: false });
  expect(await orders.tipCompanion(order.id, customer.id, { amount: "20", requestId })).toMatchObject({ replayed: true });
  expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.id } })).availableBalance.toFixed(2)).toBe("120.00");
  expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: companion.id } })).availableIncome.toFixed(2)).toBe("18.00");
  expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).tipAmount.toFixed(2)).toBe("20.00");

  const stranger = await user("CUSTOMER");
  await expect(orders.tipCompanion(order.id, stranger.id, { amount: "5", requestId: randomUUID() })).rejects.toThrow("订单不存在");
  await expect(orders.tipCompanion(order.id, customer.id, { amount: "501", requestId: randomUUID() })).rejects.toThrow();
  await expect(orders.tipCompanion(order.id, customer.id, { amount: "500", requestId: randomUUID() })).rejects.toThrow("Insufficient balance");
});

test("blown runs raise a guarantee target by the bonus snapshotted at purchase; customers cannot record them", async () => {
  const customer = await user("CUSTOMER");
  const companion = await user("COMPANION");
  const tier = await prisma.guaranteePackage.findFirstOrThrow({ where: { isActive: true } });
  const order = await orders.createGuaranteeOrder(customer.id, { requestId: randomUUID(), packageId: tier.id });
  expect(order.guaranteeBlownBonusWan).toBe(50);
  await prisma.order.update({ where: { id: order.id }, data: { companionId: companion.id, status: "IN_PROGRESS", startedAt: new Date() } });
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  await expect(orders.addOrderEvidence(order.id, { id: customer.id, role: UserRole.CUSTOMER }, { kind: "BLOWN_RUN", imageUrl: PNG }))
    .rejects.toThrow("炸单由陪玩或客服记录");
  await orders.addOrderEvidence(order.id, { id: companion.id, role: UserRole.COMPANION }, { kind: "BLOWN_RUN", imageUrl: PNG });
  const view = await orders.listOrderEvidence(order.id, { id: customer.id, role: UserRole.CUSTOMER });
  expect(view).toMatchObject({ targetWan: tier.targetWan + 50, baseTargetWan: tier.targetWan, blownBonusWan: 50 });
  expect(view.progress).toMatchObject({ blownRuns: 1, targetWan: tier.targetWan + 50 });
});

test("service packages: staff list one, customers order it at the package price, and it completes on delivery", async () => {
  const staff = await user("ADMIN");
  const actor = { id: staff.id, role: UserRole.ADMIN } as never;
  const name = `指定大红${randomUUID().slice(0, 6)}`;
  await expect(packages.create(actor, { category: "大红任务", name, price: "0" })).rejects.toThrow();
  const { id } = await packages.create(actor, { category: "大红任务", name, description: "带出即完成", price: "49" });
  expect((await orders.listServicePackages()).find(p => p.id === id)).toMatchObject({ name, price: "49.00", isActive: true });

  const customer = await user("CUSTOMER");
  const companion = await user("COMPANION");
  expect(await orders.previewPackageOrder(customer.id, { packageId: id })).toMatchObject({ mode: name, totalAmount: "49.00" });
  const order = await orders.createPackageOrder(customer.id, { requestId: randomUUID(), packageId: id, expectedTotalAmount: "49.00" });
  expect(order).toMatchObject({ serviceKind: "PACKAGE", mode: name, servicePackageId: id });

  // No hourly clock: the companion reports completion as soon as the item is delivered.
  await prisma.order.update({ where: { id: order.id }, data: { companionId: companion.id, status: "IN_PROGRESS", startedAt: new Date() } });
  expect((await orders.completeOrder(order.id, companion.id)).status).toBe("AWAITING_ACCEPTANCE");

  await packages.update(actor, id, { isActive: false });
  await expect(orders.previewPackageOrder(customer.id, { packageId: id })).rejects.toThrow("套餐已下架");
});

test("the public companion list carries trust marks and a completed-order count", async () => {
  const companion = await user("COMPANION");
  await prisma.companionProfile.update({ where: { userId: companion.id }, data: { verified: true, badges: ["金牌护航"] } });
  const listed = (await orders.listOrderableCompanions()).find(c => c.id === companion.id)!;
  expect(listed).toMatchObject({ verified: true, badges: ["金牌护航"], completedOrders: 0 });
});

describe("swapping the companion mid-order", () => {
  async function running(hours: string) {
    const admin = await user("ADMIN");
    const customer = await user("CUSTOMER", "500");
    const first = await user("COMPANION");
    const second = await user("COMPANION");
    const order = await orders.createOrder(customer.id, { requestId: randomUUID(), mode: "烽火地带", hours, companionId: first.id });
    await prisma.order.update({ where: { id: order.id }, data: { companionId: first.id, status: "IN_PROGRESS", acceptedAt: new Date(), startedAt: new Date() } });
    const current = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    return { admin, customer, first, second, order: current };
  }

  test("served hours settle to the first companion; the rest becomes a follow-on order for the new one, at no extra cost", async () => {
    const { admin, customer, first, second, order } = await running("3");
    const result = await orders.swapCompanion(order.id, admin.id, { newCompanionId: second.id, servedHours: "1", reason: "客户要求换人", dispatchVersion: order.dispatchVersion });
    expect(result).toMatchObject({ settledOrderId: order.id, dispatched: true });

    const settled = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(settled).toMatchObject({ status: "COMPLETED" });
    expect(settled.totalAmount.toFixed(2)).toBe("60.00");
    const followOn = await prisma.order.findUniqueOrThrow({ where: { id: result.orderId } });
    expect(followOn).toMatchObject({ status: "ASSIGNED", companionId: second.id, customerId: customer.id });
    expect(followOn.totalAmount.toFixed(2)).toBe("120.00");
    expect(followOn.hours.toString()).toBe("2");

    // The customer paid 180 once: 60 settled, 120 still frozen for the follow-on order, nothing added.
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.id } });
    expect(wallet.availableBalance.toFixed(2)).toBe("320.00");
    expect(wallet.frozenBalance.toFixed(2)).toBe("120.00");
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: first.id } })).availableIncome.toFixed(2)).toBe("48.00");
  });

  test("with nothing served the order itself goes to the new companion and no money moves", async () => {
    const { admin, customer, second, order } = await running("2");
    const result = await orders.swapCompanion(order.id, admin.id, { newCompanionId: second.id, servedHours: "0", reason: "陪玩临时有事", dispatchVersion: order.dispatchVersion });
    expect(result).toMatchObject({ orderId: order.id, settledOrderId: null, dispatched: true });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "ASSIGNED", companionId: second.id, startedAt: null });
    expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.id } })).frozenBalance.toFixed(2)).toBe("120.00");
  });

  test("refuses unsafe swaps", async () => {
    const { admin, first, second, order } = await running("2");
    const swap = (extra: Record<string, unknown>) => orders.swapCompanion(order.id, admin.id, { newCompanionId: second.id, reason: "x", dispatchVersion: order.dispatchVersion, ...extra });
    await expect(swap({ servedHours: "2" })).rejects.toThrow("已服务时长要小于订单时长");
    await expect(swap({ servedHours: "0.3" })).rejects.toThrow("0.5");
    await expect(swap({ newCompanionId: first.id })).rejects.toThrow("另一位陪玩");
    await expect(swap({ reason: "" })).rejects.toThrow("换人原因");
  });
});
