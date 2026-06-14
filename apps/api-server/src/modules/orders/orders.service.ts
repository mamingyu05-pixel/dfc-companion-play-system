import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  BotEventType,
  BotPlatform,
  CompanionProfileStatus,
  GameCode,
  OrderAssignmentType,
  OrderSourcePlatform,
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

  async listOrderableCompanions(game?: GameCode) {
    const companions = await this.prisma.companionProfile.findMany({
      where: {
        game,
        status: CompanionProfileStatus.LISTED,
        user: { is: { role: UserRole.COMPANION, status: UserStatus.ACTIVE } }
      },
      orderBy: [{ onlineStatus: "asc" }, { updatedAt: "desc" }],
      include: {
        user: { select: { id: true, email: true, displayName: true } }
      }
    });

    return companions.map((profile) => ({
      id: profile.userId,
      email: profile.user.email,
      displayName: profile.user.displayName,
      nickname: profile.nickname,
      avatarUrl: profile.avatarUrl,
      game: profile.game,
      status: profile.status,
      onlineStatus: profile.onlineStatus,
      deltaForceRank: profile.deltaForceRank,
      skillModes: profile.skillModes,
      pricePerHour: profile.pricePerHour.toString(),
      voicePreference: profile.voicePreference,
      bio: profile.bio
    }));
  }

  async listCustomerOrders(customerId: string) {
    const orders = await this.prisma.order.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      include: {
        companion: { select: { id: true, email: true, displayName: true } },
        statusLogs: { orderBy: { createdAt: "desc" }, take: 5 }
      }
    });
    return orders.map((order) => this.serializeOrder(order));
  }

  async listCompanionOrders(companionId: string) {
    const orders = await this.prisma.order.findMany({
      where: { companionId },
      orderBy: { createdAt: "desc" },
      include: {
        customer: { select: { id: true, email: true, displayName: true } },
        companion: { select: { id: true, email: true, displayName: true } },
        statusLogs: { orderBy: { createdAt: "desc" }, take: 5 }
      }
    });
    return orders.map((order) => this.serializeOrder(order));
  }

  async listAvailableOrdersForCompanion(companionId: string) {
    const companion = await this.prisma.user.findFirst({
      where: {
        id: companionId,
        role: UserRole.COMPANION,
        status: UserStatus.ACTIVE,
        companionProfile: { is: { status: CompanionProfileStatus.LISTED } }
      }
    });
    if (!companion) throw new BadRequestException("Companion is not listed, active or does not exist");

    const orders = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.ASSIGNED,
        OR: [{ companionId }, { companionId: null }]
      },
      orderBy: { createdAt: "asc" },
      include: {
        customer: { select: { id: true, email: true, displayName: true } },
        companion: { select: { id: true, email: true, displayName: true } },
        statusLogs: { orderBy: { createdAt: "desc" }, take: 5 }
      }
    });
    return orders.map((order) => this.serializeOrder(order));
  }

  async listAdminOrders() {
    const orders = await this.prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        customer: { select: { id: true, email: true, displayName: true } },
        companion: { select: { id: true, email: true, displayName: true } },
        assignedBy: { select: { id: true, email: true, displayName: true } },
        sourceDraft: { select: { id: true, draftNo: true, sourcePlatform: true, voiceRoomId: true, status: true } },
        statusLogs: { orderBy: { createdAt: "desc" }, take: 5 }
      }
    });
    return orders.map((order) => this.serializeOrder(order));
  }

  async createOrder(
    customerId: string,
    body: {
      mode: string;
      game?: GameCode;
      hours: string;
      companionId?: string;
      notes?: string;
      voiceTrialRequested?: boolean;
      sourcePlatform?: OrderSourcePlatform;
      sourceDraftId?: string;
      sourceChannelId?: string;
      sourceMessageId?: string;
    }
  ) {
    if (!body.mode) throw new BadRequestException("mode is required");
    const game = body.game ?? GameCode.DELTA_FORCE;
    const hours = this.positiveDecimal(body.hours, "hours");
    const maxHours = this.positiveDecimal(process.env.ORDER_MAX_HOURS ?? "8", "ORDER_MAX_HOURS");
    if (hours.gt(maxHours)) throw new BadRequestException(`hours cannot be greater than ${maxHours.toString()}`);

    const assignmentType = body.companionId ? OrderAssignmentType.DIRECT_COMPANION : OrderAssignmentType.PLATFORM_MATCH;

    const pricing = await this.resolvePricing(body.companionId, game);
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
          game,
          mode: body.mode,
          hours,
          unitPrice: pricing.unitPrice,
          totalAmount,
          commissionRateSnapshot: pricing.commissionRate,
          status: OrderStatus.PAID,
          notes: body.notes,
          voiceTrialRequested: body.voiceTrialRequested ?? false,
          sourcePlatform: body.sourcePlatform ?? OrderSourcePlatform.WEB,
          sourceDraftId: body.sourceDraftId,
          sourceChannelId: body.sourceChannelId,
          sourceMessageId: body.sourceMessageId
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
          commissionRateSnapshot: companion.companionProfile?.commissionRate ?? this.defaultPlatformCommissionRate(),
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
        select: { status: true, commissionRate: true }
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
          commissionRateSnapshot: companionProfile.commissionRate,
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

  async acceptOrderFromWeb(orderId: string, companionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const companion = await tx.user.findFirst({
        where: {
          id: companionId,
          role: UserRole.COMPANION,
          status: UserStatus.ACTIVE,
          companionProfile: { is: { status: CompanionProfileStatus.LISTED } }
        }
      });
      if (!companion) throw new BadRequestException("Companion is not listed, active or does not exist");

      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, status: true, companionId: true }
      });
      if (!order) throw new NotFoundException("Order not found");
      if (order.status !== OrderStatus.ASSIGNED) {
        throw new BadRequestException(`Order cannot be accepted from status ${order.status}`);
      }
      if (order.companionId && order.companionId !== companionId) {
        throw new BadRequestException("Order is assigned to another companion");
      }

      const updated = await tx.order.updateMany({
        where: {
          id: orderId,
          status: OrderStatus.ASSIGNED,
          OR: [{ companionId }, { companionId: null }]
        },
        data: {
          companionId,
          status: OrderStatus.ACCEPTED,
          acceptedAt: new Date()
        }
      });
      if (updated.count !== 1) throw new BadRequestException("Order was already accepted or changed");

      await tx.orderStatusLog.create({
        data: {
          orderId,
          fromStatus: OrderStatus.ASSIGNED,
          toStatus: OrderStatus.ACCEPTED,
          actorId: companionId,
          reason: "WEB_COMPANION_ACCEPT"
        }
      });

      return tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          customer: { select: { id: true, email: true, displayName: true } },
          companion: { select: { id: true, email: true, displayName: true } }
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
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          status: true,
          customerId: true,
          companionId: true,
          totalAmount: true,
          commissionRateSnapshot: true,
          companion: {
            select: {
              companionProfile: { select: { commissionRate: true } }
            }
          }
        }
      });

      if (!order) throw new NotFoundException("Order not found");
      if (order.status !== OrderStatus.IN_PROGRESS) {
        throw new BadRequestException(`Only IN_PROGRESS orders can complete. Current status: ${order.status}`);
      }
      if (!order.companionId) throw new BadRequestException("Order has no companion");
      if (order.companionId !== actorId) {
        const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
        if (!actor || (actor.role !== UserRole.ADMIN && actor.role !== UserRole.SUPER_ADMIN)) {
          throw new BadRequestException("Only assigned companion or admin can complete this order");
        }
      }

      const platformRate = order.commissionRateSnapshot ?? order.companion?.companionProfile?.commissionRate ?? this.defaultPlatformCommissionRate();
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

      await this.settleReferralReward(tx, order.customerId, orderId, actorId);

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

    await this.botNotifications.syncKookCustomerMembershipLevel(result.customerId).catch(() => undefined);

    return result;
  }

  private async settleReferralReward(tx: Prisma.TransactionClient, customerId: string, orderId: string, operatorId: string) {
    const completedOrderCount = await tx.order.count({
      where: {
        customerId,
        status: OrderStatus.COMPLETED,
        id: { not: orderId }
      }
    });
    if (completedOrderCount > 0) return;

    const referral = await tx.userReferral.findUnique({
      where: { referredUserId: customerId },
      include: {
        referrer: { include: { wallet: true } },
        referredUser: { include: { wallet: true } }
      }
    });
    if (!referral || referral.rewardStatus !== "PENDING") return;

    const [customerReferrerReward, customerInviteeBonus, companionReferralReward] = await Promise.all([
      this.getPlatformSettingDecimal(tx, "CUSTOMER_REFERRER_REWARD_AMOUNT", "10"),
      this.getPlatformSettingDecimal(tx, "CUSTOMER_INVITEE_BONUS_AMOUNT", "10"),
      this.getPlatformSettingDecimal(tx, "COMPANION_REFERRAL_REWARD_AMOUNT", "20")
    ]);

    if (referral.referrer.role === UserRole.CUSTOMER && customerReferrerReward.gt(0)) {
      const referrerWallet = referral.referrer.wallet
        ? await tx.wallet.update({
            where: { id: referral.referrer.wallet.id },
            data: { availableBalance: { increment: customerReferrerReward } }
          })
        : await tx.wallet.create({
            data: { userId: referral.referrerId, availableBalance: customerReferrerReward }
          });
      await tx.walletTransaction.create({
        data: {
          walletId: referrerWallet.id,
          userId: referral.referrerId,
          operatorId,
          type: WalletTransactionType.REFERRAL_REWARD,
          direction: TransactionDirection.CREDIT,
          amount: customerReferrerReward,
          balanceAfter: referrerWallet.availableBalance,
          referenceType: "USER_REFERRAL",
          referenceId: referral.id,
          note: "Customer referral reward"
        }
      });
    }

    if (referral.referrer.role === UserRole.COMPANION && companionReferralReward.gt(0)) {
      const referrerWallet = referral.referrer.wallet
        ? await tx.wallet.update({
            where: { id: referral.referrer.wallet.id },
            data: { availableIncome: { increment: companionReferralReward } }
          })
        : await tx.wallet.create({
            data: { userId: referral.referrerId, availableIncome: companionReferralReward }
          });
      await tx.walletTransaction.create({
        data: {
          walletId: referrerWallet.id,
          userId: referral.referrerId,
          operatorId,
          type: WalletTransactionType.REFERRAL_REWARD,
          direction: TransactionDirection.CREDIT,
          amount: companionReferralReward,
          balanceAfter: referrerWallet.availableIncome,
          referenceType: "USER_REFERRAL",
          referenceId: referral.id,
          note: "Companion customer referral reward"
        }
      });
    }

    if (customerInviteeBonus.gt(0)) {
      const inviteeWallet = referral.referredUser.wallet
        ? await tx.wallet.update({
            where: { id: referral.referredUser.wallet.id },
            data: { availableBalance: { increment: customerInviteeBonus } }
          })
        : await tx.wallet.create({
            data: { userId: customerId, availableBalance: customerInviteeBonus }
          });
      await tx.walletTransaction.create({
        data: {
          walletId: inviteeWallet.id,
          userId: customerId,
          operatorId,
          type: WalletTransactionType.REFERRAL_REWARD,
          direction: TransactionDirection.CREDIT,
          amount: customerInviteeBonus,
          balanceAfter: inviteeWallet.availableBalance,
          referenceType: "USER_REFERRAL",
          referenceId: referral.id,
          note: "Invitee first order bonus"
        }
      });
    }

    await tx.userReferral.update({
      where: { id: referral.id },
      data: {
        rewardStatus: "REWARDED",
        firstOrderId: orderId,
        rewardedAt: new Date()
      }
    });
  }

  private async getPlatformSettingDecimal(tx: Prisma.TransactionClient, key: string, fallback: string) {
    const setting = await tx.platformSetting.findUnique({ where: { key } });
    try {
      const value = new Prisma.Decimal(setting?.value ?? fallback);
      return value.lt(0) ? new Prisma.Decimal(0) : value.toDecimalPlaces(2);
    } catch {
      return new Prisma.Decimal(fallback);
    }
  }

  private async resolvePricing(companionId: string | undefined, game: GameCode) {
    if (!companionId) {
      const configuredPrice = process.env.PLATFORM_MATCH_UNIT_PRICE;
      if (!configuredPrice) {
        throw new BadRequestException("PLATFORM_MATCH_UNIT_PRICE is not configured");
      }
      return { unitPrice: this.positiveDecimal(configuredPrice, "PLATFORM_MATCH_UNIT_PRICE"), commissionRate: this.defaultPlatformCommissionRate() };
    }

    const companion = await this.prisma.companionProfile.findFirst({
      where: {
        userId: companionId,
        game,
        status: CompanionProfileStatus.LISTED,
        user: {
          is: {
            role: UserRole.COMPANION,
            status: UserStatus.ACTIVE
          }
        }
      },
      select: { pricePerHour: true, commissionRate: true }
    });

    if (!companion) throw new BadRequestException("Companion is not listed for selected game or does not exist");
    return { unitPrice: companion.pricePerHour, commissionRate: companion.commissionRate };
  }

  private defaultPlatformCommissionRate() {
    return new Prisma.Decimal(process.env.PLATFORM_COMMISSION_RATE ?? "0.2");
  }

  private positiveDecimal(value: string, fieldName: string) {
    let decimal: Prisma.Decimal;
    try {
      decimal = new Prisma.Decimal(value);
    } catch {
      throw new BadRequestException(`${fieldName} must be a valid amount`);
    }
    if (decimal.lte(0)) throw new BadRequestException(`${fieldName} must be greater than 0`);
    return decimal;
  }

  private serializeOrder(order: {
    id: string;
    orderNo: string;
    customerId: string;
    companionId: string | null;
    assignedById?: string | null;
    assignmentType: OrderAssignmentType;
    game: GameCode;
    mode: string;
    hours: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    commissionRateSnapshot?: Prisma.Decimal;
    platformFee: Prisma.Decimal;
    companionIncome: Prisma.Decimal;
    status: OrderStatus;
    notes: string | null;
    voiceTrialRequested: boolean;
    sourcePlatform: OrderSourcePlatform;
    sourceDraftId: string | null;
    sourceChannelId: string | null;
    sourceMessageId: string | null;
    createdAt: Date;
    acceptedAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
    customer?: { id: string; email: string; displayName: string };
    companion?: { id: string; email: string; displayName: string } | null;
    assignedBy?: { id: string; email: string; displayName: string } | null;
    sourceDraft?: { id: string; draftNo: string; sourcePlatform: OrderSourcePlatform; voiceRoomId: string | null; status: string } | null;
    statusLogs?: Array<{ id: string; fromStatus: OrderStatus | null; toStatus: OrderStatus; reason: string | null; createdAt: Date }>;
  }) {
    return {
      id: order.id,
      orderNo: order.orderNo,
      customerId: order.customerId,
      companionId: order.companionId,
      assignmentType: order.assignmentType,
      game: order.game,
      mode: order.mode,
      hours: order.hours.toString(),
      unitPrice: order.unitPrice.toString(),
      totalAmount: order.totalAmount.toString(),
      commissionRateSnapshot: order.commissionRateSnapshot?.toString() ?? null,
      platformFee: order.platformFee.toString(),
      companionIncome: order.companionIncome.toString(),
      status: order.status,
      notes: order.notes,
      voiceTrialRequested: order.voiceTrialRequested,
      sourcePlatform: order.sourcePlatform,
      sourceDraftId: order.sourceDraftId,
      sourceChannelId: order.sourceChannelId,
      sourceMessageId: order.sourceMessageId,
      createdAt: order.createdAt,
      acceptedAt: order.acceptedAt,
      startedAt: order.startedAt,
      completedAt: order.completedAt,
      customer: order.customer,
      companion: order.companion,
      assignedBy: order.assignedBy,
      sourceDraft: order.sourceDraft,
      statusLogs: order.statusLogs ?? []
    };
  }

  private generateOrderNo() {
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `MAY${stamp}${random}`;
  }
}
