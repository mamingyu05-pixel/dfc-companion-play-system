import { randomUUID } from "node:crypto";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";

const prisma = new PrismaService();
const notifications = { sendOrderAssignedNotifications: jest.fn().mockResolvedValue([]), refreshAcceptedOrderCards: jest.fn() } as unknown as BotNotificationService;
const orders = new OrdersService(prisma, notifications);
beforeAll(() => prisma.$connect());
afterAll(() => prisma.$disconnect());

test("admin order search reaches orders beyond the latest page", async () => {
  const tag = randomUUID().slice(0, 8);
  const customer = await prisma.user.create({ data: {
    email: `${randomUUID()}@synthetic.invalid`, displayName: `老客户${tag}`, displayNameKey: `老客户${tag}`, passwordHash: "x", role: "CUSTOMER",
    wallet: { create: { availableBalance: "500" } }
  } });
  const companion = await prisma.user.create({ data: {
    email: `${randomUUID()}@synthetic.invalid`, displayName: tag, displayNameKey: tag, passwordHash: "x", role: "COMPANION",
    wallet: { create: {} }, companionProfile: { create: { nickname: `陪玩${tag}`, skillModes: [], pricePerHour: "50.00", status: "LISTED" } }
  } });
  await orders.createOrder(customer.id, { requestId: randomUUID(), mode: "烽火地带", hours: "1", companionId: companion.id });
  const order = await prisma.order.findFirstOrThrow({ where: { customerId: customer.id } });
  // Push it far into the past so it is not among the latest orders.
  await prisma.order.update({ where: { id: order.id }, data: { createdAt: new Date("2020-01-01T00:00:00Z") } });

  expect((await orders.listAdminOrders(`老客户${tag}`)).map(o => o.id)).toEqual([order.id]);
  expect((await orders.listAdminOrders(order.orderNo.toLowerCase())).map(o => o.id)).toContain(order.id);
  expect((await orders.listAdminOrders(customer.email.toUpperCase())).map(o => o.id)).toContain(order.id);
  expect(await orders.listAdminOrders(`无此人${tag}`)).toEqual([]);
});
