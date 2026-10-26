import { randomUUID } from "node:crypto";
import { UserRole } from "@prisma/client";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { WalletService } from "../src/modules/wallet/wallet.service";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";
import { QuickOrderController } from "../src/modules/admin/quick-order.controller";

const prisma = new PrismaService();
const notifications = {
  syncCustomerMembershipLevels: jest.fn().mockResolvedValue([]),
  sendOrderAssignedNotifications: jest.fn().mockResolvedValue([]),
  refreshAcceptedOrderCards: jest.fn().mockResolvedValue(undefined)
} as unknown as BotNotificationService;
const orders = new OrdersService(prisma, notifications);
const quick = new QuickOrderController(prisma, orders, new WalletService(prisma, notifications));
beforeAll(() => prisma.$connect());
afterAll(() => prisma.$disconnect());

async function user(role: UserRole, balance = "0") {
  const name = randomUUID();
  return prisma.user.create({ data: {
    email: `${name}@synthetic.invalid`, displayName: name, displayNameKey: name, passwordHash: "x", role,
    wallet: { create: { availableBalance: balance } },
    ...(role === "COMPANION" ? { companionProfile: { create: { nickname: name, skillModes: [], pricePerHour: "60.00", kookPricePerHour: "50.00", status: "LISTED", onlineStatus: "ONLINE" } } } : {})
  } });
}
const staffOf = async () => ({ id: (await user("ADMIN")).id, role: UserRole.ADMIN }) as never;

test("quick order: KOOK price preview, direct dispatch to the chosen companion, and safe retry", async () => {
  const staff = await staffOf();
  const customer = await user("CUSTOMER", "500");
  const companion = await user("COMPANION");
  const order = { customerId: customer.id, kind: "HOURLY", mode: "烽火地带", hours: "2", companionId: companion.id };

  const preview = await quick.preview(order);
  expect(preview).toMatchObject({ unitPrice: "50.00", totalAmount: "100.00", balance: "500.00", shortfall: "0.00" });

  const requestId = randomUUID();
  await expect(quick.create(staff, { ...order, requestId, expectedTotalAmount: "120.00" })).rejects.toThrow();
  const first = await quick.create(staff, { ...order, requestId: randomUUID(), expectedTotalAmount: "100.00", notes: "KOOK 私聊下单" });
  expect(first).toMatchObject({ dispatched: true, dispatchMode: "DIRECT", toppedUp: false, order: { totalAmount: "100.00" } });
  if (first.outcome !== "ORDER_CREATED") throw new Error("Expected a created order receipt");
  const saved = await prisma.order.findUniqueOrThrow({ where: { id: first.order.id } });
  expect(saved).toMatchObject({ status: "ASSIGNED", companionId: companion.id, sourcePlatform: "KOOK", notes: "KOOK 私聊下单" });
  expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.id } })).availableBalance.toString()).toBe("400");
  expect(notifications.sendOrderAssignedNotifications).toHaveBeenCalledWith(first.order.id);
});

test("quick order: tops up a short balance first and opens the order to the dispatch channel; retries do not double-charge", async () => {
  const staff = await staffOf();
  const customer = await user("CUSTOMER", "20");
  const order = { customerId: customer.id, kind: "HOURLY", mode: "娱乐", hours: "1", customUnitPrice: "88" };
  const preview = await quick.preview(order);
  expect(preview).toMatchObject({ totalAmount: "88.00", shortfall: "68.00" });

  const body = { ...order, requestId: randomUUID(), expectedTotalAmount: "88.00", topUp: { amount: "100", method: "WECHAT" } };
  const first = await quick.create(staff, body);
  expect(first).toMatchObject({ toppedUp: true, dispatched: true, dispatchMode: "OPEN" });
  if (first.outcome !== "ORDER_CREATED") throw new Error("Expected a created order receipt");
  const retry = await quick.create(staff, body);
  expect(retry).toMatchObject({ toppedUp: false, dispatched: false, order: { id: first.order.id } });

  expect(await prisma.rechargeRequest.count({ where: { customerId: customer.id, status: "APPROVED" } })).toBe(1);
  expect(await prisma.order.count({ where: { customerId: customer.id } })).toBe(1);
  const saved = await prisma.order.findUniqueOrThrow({ where: { id: first.order.id } });
  expect(saved).toMatchObject({ status: "ASSIGNED", companionId: null, assignmentType: "PLATFORM_MATCH" });
});

test("quick order: guarantee package and input validation", async () => {
  const staff = await staffOf();
  const customer = await user("CUSTOMER", "1000");
  const pkg = await prisma.guaranteePackage.findFirstOrThrow({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  const preview = await quick.preview({ customerId: customer.id, kind: "GUARANTEE", packageId: pkg.id });
  expect(preview.totalAmount).toBe(pkg.price.toFixed(2));
  const result = await quick.create(staff, { customerId: customer.id, kind: "GUARANTEE", packageId: pkg.id, requestId: randomUUID(), expectedTotalAmount: preview.totalAmount });
  expect(result.dispatched).toBe(true);
  if (result.outcome !== "ORDER_CREATED") throw new Error("Expected a created order receipt");
  expect((await prisma.order.findUniqueOrThrow({ where: { id: result.order.id } })).serviceKind).toBe("GUARANTEE");

  await expect(quick.preview({ customerId: customer.id, kind: "NOPE" })).rejects.toThrow("小时陪玩、保底护航或套餐");
  await expect(quick.preview({ customerId: "missing", kind: "HOURLY", mode: "x", hours: "1" })).rejects.toThrow("有效的客户");
  await expect(quick.create(staff, { customerId: customer.id, kind: "HOURLY", mode: "x", hours: "1", requestId: "short", expectedTotalAmount: "1" })).rejects.toThrow("requestId");
});
