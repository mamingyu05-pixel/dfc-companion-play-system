import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  BotEventType,
  BotPlatform,
  CompanionProfileStatus,
  OrderAssignmentType,
  OrderStatus,
  Prisma,
  TransactionDirection,
  UserRole,
  UserStatus,
  WalletTransactionType
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { BotNotificationService } from "../bot/bot-notification.service";

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly botNotifications: BotNotificationService
  ) {}

  async createOrder(
    customerId: string,
    body: {
      mode: string;
      hours: string;
      companionId?: string;
      notes?: string;
      voiceTrialRequested?: boolean;
    }
  ) {
    if (!body.mode) throw new BadRequestException("mode is required");
    const hours = this.positiveDecimal(body.hours, "hours");
    const maxHours = this.positiveDecimal(process.env.ORDER_MAX_HOURS ?? "8", "ORDER_MAX_HOURS");
    if (hours.gt(maxHours)) throw new BadRequestException(`hours cannot be greater than ${maxHours.toString()}`);

    const assignmentType = body.companionId ? OrderAssignmentType.DIRECT_COMPANION : OrderAssignmentType.PLATFORM_MATCH;

    const pricing = await this.resolvePricing(body.companionId);
    const totalAmount = pricing.unitPrice.mul(hours);

    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.user.findFirst({
        where: { id: customerId, role: UserRole.CUSTOMER, status: UserStatus.ACTIVE },
        include: { wallet: true }
      });

      if (!customer?.wallet) throw new BadRequestException("Customer wallet does not exist");

      const debit = await tx.wallet.updateMany({
        where: {
          id: customer.wallet.id,
          userId: customerId,
          availableBalance: { gte: totalAmount }
        },
        data: {
          availableBalance: { decrement: totalAmount },
          frozenBalance: { increment: totalAmount }
        }
      });

      if (debit.count !== 1) throw new BadRequestException("Insufficient balance");

      const walletAfter = await tx.wallet.findUniqueOrThrow({ where: { id: customer.wallet.id } });
      const order = await tx.order.create({
        data: {
          orderNo: this.generateOrderNo(),
          customerId,
          companionId: body.companionId,
          assignmentType,
          mode: body.mode,
          hours,
          unitPrice: pricing.unitPrice,
          totalAmount,
          status: OrderStatus.PAID,
          notes: body.notes,
          voiceTrialRequested: body.voiceTrialRequested ?? false
        }
      });

      await tx.walletTransaction.create({
        data: {
          walletId: customer.wallet.id,
          userId: customerId,
          type: WalletTransactionType.ORDER_PAYMENT,
          direction: TransactionDirection.DEBIT,
          amount: totalAmount,
          balanceAfter: walletAfter.availableBalance,
          referenceType: "ORDER",
          referenceId: order.id,
          note: "Customer order payment frozen"
        }
      });

      await tx.orderStatusLog.create({
        data: {
          orderId: order.id,
          fromStatus: OrderStatus.PENDING_PAYMENT,
          toStatus: OrderStatus.PAID,
          actorId: customerId,
          reason: "CUSTOMER_CREATE_ORDER"
        }
      });

      return order;
    });
  }

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
          status: UserStatus.ACTIVE,
          companionProfile: {
            is: {
              status: CompanionProfileStatus.LISTED
            }
          }
        },
        include: { companionProfile: true }
      });

      if (!companion) throw new BadRequestException("Companion is not listed, active or does not exist");

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

      const companionProfile = await tx.companionProfile.findUnique({
        where: { userId: externalAccount.userId },
        select: { status: true }
      });

      if (companionProfile?.status !== CompanionProfileStatus.LISTED) {
        throw new BadRequestException("Bound companion profile is not listed");
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

  async startOrder(orderId: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, status: true, companionId: true }
      });

      if (!order) throw new NotFoundException("Order not found");
      if (order.status !== OrderStatus.ACCEPTED) {
        throw new BadRequestException(`Only ACCEPTED orders can start. Current status: ${order.status}`);
      }
      if (order.companionId !== actorId) {
        const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
        if (!actor || (actor.role !== UserRole.ADMIN && actor.role !== UserRole.SUPER_ADMIN)) {
          throw new BadRequestException("Only assigned companion or admin can start this order");
        }
      }

      const updated = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.ACCEPTED },
        data: { status: OrderStatus.IN_PROGRESS, startedAt: new Date() }
      });
      if (updated.count !== 1) throw new BadRequestException("Order was already changed");

      await tx.orderStatusLog.create({
        data: {
          orderId,
          fromStatus: OrderStatus.ACCEPTED,
          toStatus: OrderStatus.IN_PROGRESS,
          actorId,
          reason: "ORDER_START"
        }
      });

      return tx.order.findUniqueOrThrow({ where: { id: orderId } });
    });
  }

  async completeOrder(orderId: string, actorId: string) {
    const platformRate = new Prisma.Decimal(process.env.PLATFORM_COMMISSION_RATE ?? "0.2");

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, status: true, customerId: true, companionId: true, totalAmount: true }
      });

      if (!order) throw new NotFoundException("Order not found");
      if (order.status !== OrderStatus.IN_PROGRESS) {
        throw new BadRequestException(`Only IN_PROGRESS orders can complete. Current status: ${order.status}`);
      }
      if (!order.companionId) throw new BadRequestException("Order has no companion");

      const platformFee = order.totalAmount.mul(platformRate);
      const companionIncome = order.totalAmount.sub(platformFee);

      const updated = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.IN_PROGRESS },
        data: {
          status: OrderStatus.COMPLETED,
          completedAt: new Date(),
          platformFee,
          companionIncome
        }
      });
      if (updated.count !== 1) throw new BadRequestException("Order was already settled or changed");

      const settledCustomerWallet = await tx.wallet.updateMany({
        where: {
          userId: order.customerId,
          frozenBalance: { gte: order.totalAmount }
        },
        data: {
          frozenBalance: { decrement: order.totalAmount }
        }
      });
      if (settledCustomerWallet.count !== 1) {
        throw new BadRequestException("Customer frozen balance is insufficient for settlement");
      }

      const customerWalletAfter = await tx.wallet.findUniqueOrThrow({ where: { userId: order.customerId } });
      await tx.walletTransaction.create({
        data: {
          walletId: customerWalletAfter.id,
          userId: order.customerId,
          operatorId: actorId,
          type: WalletTransactionType.ORDER_SETTLEMENT,
          direction: TransactionDirection.DEBIT,
          amount: order.totalAmount,
          balanceAfter: customerWalletAfter.frozenBalance,
          referenceType: "ORDER",
          referenceId: orderId,
          note: "Customer frozen balance settled"
        }
      });

      // Phase 1 skips a dispute holding period: completed orders become withdrawable immediately.
      // Keep pendingIncome reserved for a later settlement-delay workflow.
      const companionWallet = await tx.wallet.upsert({
        where: { userId: order.companionId },
        update: { availableIncome: { increment: companionIncome } },
        create: {
          userId: order.companionId,
          availableIncome: companionIncome
        }
      });

      await tx.walletTransaction.create({
        data: {
          walletId: companionWallet.id,
          userId: order.companionId,
          operatorId: actorId,
          type: WalletTransactionType.ORDER_SETTLEMENT,
          direction: TransactionDirection.CREDIT,
          amount: companionIncome,
          balanceAfter: companionWallet.availableIncome,
          referenceType: "ORDER",
          referenceId: orderId,
          note: "Order completed settlement"
        }
      });

      await tx.orderStatusLog.create({
        data: {
          orderId,
          fromStatus: OrderStatus.IN_PROGRESS,
          toStatus: OrderStatus.COMPLETED,
          actorId,
          reason: "ORDER_COMPLETE_SETTLEMENT"
        }
      });

      return tx.order.findUniqueOrThrow({ where: { id: orderId } });
    });
  }

  private async resolvePricing(companionId?: string) {
    if (!companionId) {
      const configuredPrice = process.env.PLATFORM_MATCH_UNIT_PRICE;
      if (!configuredPrice) {
        throw new BadRequestException("PLATFORM_MATCH_UNIT_PRICE is not configured");
      }
      return { unitPrice: this.positiveDecimal(configuredPrice, "PLATFORM_MATCH_UNIT_PRICE") };
    }

    const companion = await this.prisma.companionProfile.findFirst({
      where: {
        userId: companionId,
        status: CompanionProfileStatus.LISTED,
        user: {
          is: {
            role: UserRole.COMPANION,
            status: UserStatus.ACTIVE
          }
        }
      },
      select: { pricePerHour: true }
    });

    if (!companion) throw new BadRequestException("Companion is not listed or does not exist");
    return { unitPrice: companion.pricePerHour };
  }

  private positiveDecimal(value: string, fieldName: string) {
    const decimal = new Prisma.Decimal(value);
    if (decimal.lte(0)) throw new BadRequestException(`${fieldName} must be greater than 0`);
    return decimal;
  }

  private generateOrderNo() {
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `DFC${stamp}${random}`;
  }
}
