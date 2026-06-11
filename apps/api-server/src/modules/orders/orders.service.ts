import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { BotEventType, BotPlatform, OrderStatus, UserRole, UserStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { BotNotificationService } from "../bot/bot-notification.service";

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly botNotifications: BotNotificationService
  ) {}

  async assignOrder(orderId: string, companionId: string, assignedById?: string) {
    const order = await this.prisma.$transaction(async (tx) => {
      const currentOrder = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, status: true }
      });

      if (!currentOrder) throw new NotFoundException("Order not found");
      if (currentOrder.status !== OrderStatus.PAID) {
        throw new BadRequestException(`Only PAID orders can be assigned. Current status: ${currentOrder.status}`);
      }

      const companion = await tx.user.findFirst({
        where: {
          id: companionId,
          role: UserRole.COMPANION,
          status: UserStatus.ACTIVE
        },
        include: { companionProfile: true }
      });

      if (!companion) throw new BadRequestException("Companion is not active or does not exist");

      const updated = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.PAID },
        data: {
          companionId,
          assignedById,
          status: OrderStatus.ASSIGNED
        }
      });

      if (updated.count !== 1) {
        throw new BadRequestException("Order has already been assigned or changed");
      }

      await tx.orderStatusLog.create({
        data: {
          orderId,
          fromStatus: OrderStatus.PAID,
          toStatus: OrderStatus.ASSIGNED,
          actorId: assignedById,
          reason: "ADMIN_ASSIGN_ORDER"
        }
      });

      if (assignedById) {
        await tx.adminLog.create({
          data: {
            actorId: assignedById,
            targetUserId: companionId,
            action: "ASSIGN_ORDER",
            entityType: "ORDER",
            entityId: orderId,
            detail: { companionId }
          }
        });
      }

      return tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { companion: { include: { companionProfile: true } } }
      });
    });

    const notifications = await this.botNotifications.sendOrderAssignedNotifications(order.id);

    return {
      order,
      notifications
    };
  }

  async acceptOrderFromPlatform(platform: BotPlatform, orderId: string, platformUserId: string, platformMessageId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const externalAccount = await tx.userExternalAccount.findUnique({
        where: {
          platform_externalUserId: {
            platform,
            externalUserId: platformUserId
          }
        },
        include: { user: true }
      });

      if (!externalAccount) throw new BadRequestException("Platform user is not bound to a companion account");
      if (externalAccount.user.role !== UserRole.COMPANION || externalAccount.user.status !== UserStatus.ACTIVE) {
        throw new BadRequestException("Bound user is not an active companion");
      }

      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, status: true, companionId: true }
      });

      if (!order) throw new NotFoundException("Order not found");
      if (order.status !== OrderStatus.ASSIGNED) {
        throw new BadRequestException(`Order cannot be accepted from status ${order.status}`);
      }

      if (order.companionId && order.companionId !== externalAccount.userId) {
        throw new BadRequestException("Order is assigned to another companion");
      }

      const updated = await tx.order.updateMany({
        where: {
          id: orderId,
          status: OrderStatus.ASSIGNED,
          OR: [{ companionId: externalAccount.userId }, { companionId: null }]
        },
        data: {
          companionId: externalAccount.userId,
          status: OrderStatus.ACCEPTED,
          acceptedAt: new Date()
        }
      });

      if (updated.count !== 1) {
        throw new BadRequestException("Order was already accepted or changed");
      }

      await tx.orderStatusLog.create({
        data: {
          orderId,
          fromStatus: OrderStatus.ASSIGNED,
          toStatus: OrderStatus.ACCEPTED,
          actorId: externalAccount.userId,
          reason: `${platform}_ORDER_ACCEPT`
        }
      });

      await tx.botEvent.create({
        data: {
          platform,
          type: BotEventType.ORDER_ACCEPT_CLICKED,
          actorId: externalAccount.userId,
          orderId,
          platformUserId,
          platformMessageId,
          platformGuildId: platform === BotPlatform.DISCORD ? process.env.DISCORD_GUILD_ID : process.env.KOOK_GUILD_ID,
          payload: platformMessageId ? { platformUserId, platformMessageId } : { platformUserId }
        }
      });

      return tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          companion: {
            select: { id: true, email: true, displayName: true }
          }
        }
      });
    });
  }
}
