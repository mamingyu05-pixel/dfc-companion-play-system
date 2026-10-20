import { randomUUID } from "node:crypto";
import { OrderStatus } from "@prisma/client";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";

export const prisma = new PrismaService();
export const notifications = { syncCustomerMembershipLevels: jest.fn().mockResolvedValue([]) } as unknown as BotNotificationService;
export const orders = new OrdersService(prisma, notifications);

export async function fixture(status: OrderStatus = "AWAITING_ACCEPTANCE", ageHours = 49) {
  const makeUser = (role: "CUSTOMER" | "COMPANION" | "ADMIN") => {
    const id = randomUUID();
    return prisma.user.create({ data: { email: `${id}@synthetic.invalid`, displayName: id, displayNameKey: id,
      passwordHash: "synthetic-unusable-hash", role,
      wallet: { create: role === "CUSTOMER" ? { frozenBalance: "100" } : { pendingIncome: "80" } },
      ...(role === "COMPANION" ? { companionProfile: { create: { nickname: id, skillModes: [], pricePerHour: "100", status: "LISTED" } } } : {}) } });
  };
  const customer = await makeUser("CUSTOMER"), companion = await makeUser("COMPANION"), admin = await makeUser("ADMIN");
  const order = await prisma.order.create({ data: { orderNo: randomUUID(), customerId: customer.id, companionId: companion.id,
    status, mode: "synthetic", hours: "1", unitPrice: "100", totalAmount: "100", companionIncome: "80", platformFee: "20",
    commissionRateSnapshot: "0.2", reportedCompletedAt: new Date(Date.now() - ageHours * 3_600_000),
    startedAt: new Date(Date.now() - (ageHours + 2) * 3_600_000),
    ...(status === "COMPLETED" ? { verifiedAt: new Date(), completedAt: new Date() } : {}) } });
  return { order, customer, companion, admin };
}
