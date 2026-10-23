import { randomUUID } from "node:crypto";
import { BotPlatform, UserRole } from "@prisma/client";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";

const prisma = new PrismaService();
const notifications = { sendOrderAssignedNotifications: jest.fn().mockResolvedValue([]), refreshAcceptedOrderCards: jest.fn() } as unknown as BotNotificationService;
const orders = new OrdersService(prisma, notifications);
beforeAll(() => prisma.$connect());
afterAll(() => prisma.$disconnect());

async function user(role: UserRole, name: string = randomUUID()) {
  return prisma.user.create({ data: {
    email: `${randomUUID()}@synthetic.invalid`, displayName: name, displayNameKey: name.toLowerCase(), passwordHash: "x", role,
    wallet: { create: { availableBalance: "500" } },
    ...(role === "COMPANION" ? { companionProfile: { create: { nickname: name, skillModes: [], pricePerHour: "50.00", status: "LISTED" } } } : {})
  } });
}

test("companions see the customer's name on their orders but never the customer's email", async () => {
  const customer = await user("CUSTOMER");
  const companion = await user("COMPANION");
  await orders.createOrder(customer.id, { requestId: randomUUID(), mode: "烽火地带", hours: "1", companionId: companion.id });
  const order = await prisma.order.findFirstOrThrow({ where: { customerId: customer.id } });
  await prisma.order.update({ where: { id: order.id }, data: { companionId: companion.id, status: "ASSIGNED" } });

  const mine = await orders.listCompanionOrders(companion.id);
  const row = mine.find(o => o.id === order.id)!;
  expect(row.customer).toEqual({ id: customer.id, displayName: customer.displayName });
  expect(JSON.stringify(mine)).not.toContain(customer.email);
});

test("the public companion list shows no companion emails or platform user IDs", async () => {
  const companion = await user("COMPANION");
  const externalUserId = `9${Date.now()}`;
  await prisma.userExternalAccount.create({ data: { userId: companion.id, platform: BotPlatform.KOOK, externalUserId, displayName: "kook-name" } });
  const listed = (await orders.listOrderableCompanions()).find(c => c.id === companion.id)!;
  expect(listed.externalAccounts).toEqual([{ platform: "KOOK", displayName: "kook-name" }]);
  const text = JSON.stringify(await orders.listOrderableCompanions());
  expect(text).not.toContain(companion.email);
  expect(text).not.toContain(externalUserId);
});

test("the companion customer search cannot be used to list customers' emails or platform IDs", async () => {
  const tag = randomUUID().slice(0, 8);
  const customer = await user("CUSTOMER", `老板${tag}`);
  await prisma.userExternalAccount.create({ data: { userId: customer.id, platform: BotPlatform.KOOK, externalUserId: `9${Date.now()}`, displayName: `kook${tag}` } });

  const byName = await orders.searchCustomersForCompanion(`老板${tag}`);
  expect(byName.map(c => c.id)).toContain(customer.id);
  expect(JSON.stringify(byName)).not.toContain(customer.email);
  expect(byName[0].externalAccounts[0]).toEqual({ platform: "KOOK", displayName: `kook${tag}` });

  // A fragment of an email no longer matches; the full address still does.
  expect(await orders.searchCustomersForCompanion(customer.email.slice(0, 8))).toEqual([]);
  expect((await orders.searchCustomersForCompanion(customer.email)).map(c => c.id)).toEqual([customer.id]);
});
