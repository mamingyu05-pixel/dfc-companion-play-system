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
  ServicePriceTier,
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
        ...(game ? { OR: [{ game }, { games: { has: game } }] } : {}),
        status: CompanionProfileStatus.LISTED,
        user: { is: { status: UserStatus.ACTIVE } }
      },
      orderBy: [{ onlineStatus: "asc" }, { updatedAt: "desc" }],
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            externalAccounts: {
              select: {
                platform: true,
                externalUserId: true,
                displayName: true
              }
            }
          }
        }
      }
    });

    return companions.map((profile) => ({
      id: profile.userId,
      email: profile.user.email,
      displayName: profile.user.displayName,
      externalAccounts: profile.user.externalAccounts.map((account) => ({
        platform: account.platform,
        externalUserId: account.externalUserId,
        displayName: account.displayName
      })),
      nickname: profile.nickname,
      avatarUrl: profile.avatarUrl,
      photoUrls: profile.photoUrls,
      voiceIntroUrl: profile.voiceIntroUrl,
      game: profile.game,
      games: profile.games.length ? profile.games : [profile.game],
      status: profile.status,
      onlineStatus: profile.onlineStatus,
      deltaForceRank: profile.deltaForceRank,
      skillModes: profile.skillModes,
      pricePerHour: profile.pricePerHour.toString(),
      kookPricePerHour: profile.kookPricePerHour?.toString() ?? null,
      discordPricePerHour: profile.discordPricePerHour?.toString() ?? null,
      entertainmentPricePerHour: profile.entertainmentPricePerHour?.toString() ?? null,
      rankedPricePerHour: profile.rankedPricePerHour?.toString() ?? null,
      highRankedPricePerHour: profile.highRankedPricePerHour?.toString() ?? null,
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
        orderGroup: { select: { id: true, groupNo: true, companionCount: true, originalAmount: true, discountAmount: true, totalAmount: true } },
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
        orderGroup: { select: { id: true, groupNo: true, companionCount: true, originalAmount: true, discountAmount: true, totalAmount: true } },
        statusLogs: { orderBy: { createdAt: "desc" }, take: 5 }
      }
    });
    return orders.map((order) => this.serializeOrder(order));
  }

  async listAvailableOrdersForCompanion(companionId: string) {
    const companion = await this.prisma.user.findFirst({
      where: {
        id: companionId,
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
        orderGroup: { select: { id: true, groupNo: true, companionCount: true, originalAmount: true, discountAmount: true, totalAmount: true } },
        statusLogs: { orderBy: { createdAt: "desc" }, take: 5 }
      }
    });
    return orders.map((order) => this.serializeOrder(order));
  }

  async searchCustomersForCompanion(query = "") {
    const keyword = query.trim();
    if (keyword.length < 2) return [];

    const customers = await this.prisma.user.findMany({
      where: {
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
        OR: [
          { email: { contains: keyword, mode: "insensitive" } },
          { displayName: { contains: keyword, mode: "insensitive" } },
          { externalAccounts: { some: { displayName: { contains: keyword, mode: "insensitive" } } } },
          { externalAccounts: { some: { externalUserId: { contains: keyword } } } }
        ]
      },
      take: 20,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        email: true,
        displayName: true,
        externalAccounts: { select: { platform: true, externalUserId: true, displayName: true } }
      }
    });

    return customers;
  }

  async listAdminOrders() {
    const orders = await this.prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        customer: { select: { id: true, email: true, displayName: true } },
        companion: { select: { id: true, email: true, displayName: true } },
        assignedBy: { select: { id: true, email: true, displayName: true } },
        orderGroup: { select: { id: true, groupNo: true, companionCount: true, originalAmount: true, discountAmount: true, totalAmount: true } },
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
      priceTier?: ServicePriceTier;
      rankTierKey?: string;
      customUnitPrice?: string;
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

    const sourcePlatform = body.sourcePlatform ?? OrderSourcePlatform.WEB;
    const priceTier = this.normalizePriceTier(body.priceTier, body.mode);
    const pricing = await this.resolvePricing(body.companionId, game, sourcePlatform, priceTier, {
      rankTierKey: body.rankTierKey,
      customUnitPrice: body.customUnitPrice
    });
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
          priceTier,
          rankTierKey: pricing.rankTierKey,
          rankTierNameSnapshot: pricing.rankTierName,
          unitPrice: pricing.unitPrice,
          totalAmount,
          commissionRateSnapshot: pricing.commissionRate,
          status: OrderStatus.PAID,
          notes: body.notes,
          voiceTrialRequested: body.voiceTrialRequested ?? false,
          sourcePlatform,
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

  async createOrderGroup(
    customerId: string,
    body: {
      mode: string;
      game?: GameCode;
      hours: string;
      companionIds: string[];
      notes?: string;
      voiceTrialRequested?: boolean;
      priceTier?: ServicePriceTier;
      rankTierKey?: string;
      customUnitPrice?: string;
      sourcePlatform?: OrderSourcePlatform;
      sourceDraftId?: string;
      sourceChannelId?: string;
      sourceMessageId?: string;
      assignedById?: string;
    }
  ) {
    if (!body.mode) throw new BadRequestException("mode is required");
    const companionIds = [...new Set(body.companionIds.map((id) => id.trim()).filter(Boolean))];
    if (!companionIds.length) throw new BadRequestException("companionIds is required");

    const game = body.game ?? GameCode.DELTA_FORCE;
    const hours = this.positiveDecimal(body.hours, "hours");
    const maxHours = this.positiveDecimal(process.env.ORDER_MAX_HOURS ?? "8", "ORDER_MAX_HOURS");
    if (hours.gt(maxHours)) throw new BadRequestException(`hours cannot be greater than ${maxHours.toString()}`);

    const sourcePlatform = body.sourcePlatform ?? OrderSourcePlatform.WEB;
    const priceTier = this.normalizePriceTier(body.priceTier, body.mode);
    const discountConfig = await this.resolveMultiCompanionDiscountConfig();
    const discountEnabled = discountConfig.enabled && companionIds.length >= discountConfig.minCount && discountConfig.discountPerHour.gt(0);

    const items = await Promise.all(
      companionIds.map(async (companionId, index) => {
        const pricing = await this.resolvePricing(companionId, game, sourcePlatform, priceTier, {
          rankTierKey: body.rankTierKey,
          customUnitPrice: body.customUnitPrice
        });
        const originalUnitPrice = pricing.unitPrice;
        const unitPrice = discountEnabled
          ? this.applyUnitDiscount(originalUnitPrice, discountConfig.discountPerHour, discountConfig.floorPrice)
          : originalUnitPrice;
        const discountPerHour = originalUnitPrice.sub(unitPrice);
        const originalAmount = originalUnitPrice.mul(hours);
        const totalAmount = unitPrice.mul(hours);
        return {
          companionId,
          index: index + 1,
          unitPrice,
          originalUnitPrice,
          discountPerHour,
          originalAmount,
          totalAmount,
          commissionRate: pricing.commissionRate,
          rankTierKey: pricing.rankTierKey,
          rankTierName: pricing.rankTierName
        };
      })
    );

    const zero = new Prisma.Decimal(0);
    const originalAmount = items.reduce((sum, item) => sum.add(item.originalAmount), zero);
    const totalAmount = items.reduce((sum, item) => sum.add(item.totalAmount), zero);
    const discountAmount = originalAmount.sub(totalAmount);
    const firstRankPricing = items.find((item) => item.rankTierKey);
    const groupNo = this.generateOrderGroupNo();
    const discountNote =
      discountAmount.gt(0) ? `多陪玩折扣：${items.length} 人，每人每小时减 ${discountConfig.discountPerHour.toString()}，共减 ${discountAmount.toString()}` : null;
    const notes = [body.notes, discountNote].filter(Boolean).join("\n") || undefined;

    const result = await this.prisma.$transaction(async (tx) => {
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
      const orderGroup = await tx.orderGroup.create({
        data: {
          groupNo,
          customerId,
          sourceDraftId: body.sourceDraftId,
          sourcePlatform,
          sourceChannelId: body.sourceChannelId,
          sourceMessageId: body.sourceMessageId,
          companionCount: items.length,
          rankTierKey: firstRankPricing?.rankTierKey,
          rankTierNameSnapshot: firstRankPricing?.rankTierName,
          originalAmount,
          discountAmount,
          totalAmount,
          note: notes
        }
      });

      const orders = [];
      for (const item of items) {
        const initialStatus = body.assignedById ? OrderStatus.ASSIGNED : OrderStatus.PAID;
        const order = await tx.order.create({
          data: {
            orderNo: this.generateOrderNo(),
            orderGroupId: orderGroup.id,
            groupItemIndex: item.index,
            customerId,
            companionId: item.companionId,
            assignedById: body.assignedById,
            assignmentType: OrderAssignmentType.DIRECT_COMPANION,
            game,
            mode: body.mode,
            hours,
            priceTier,
            rankTierKey: item.rankTierKey,
            rankTierNameSnapshot: item.rankTierName,
            originalUnitPrice: item.originalUnitPrice,
            unitPrice: item.unitPrice,
            discountPerHour: item.discountPerHour,
            originalAmount: item.originalAmount,
            totalAmount: item.totalAmount,
            commissionRateSnapshot: item.commissionRate,
            status: initialStatus,
            notes,
            voiceTrialRequested: body.voiceTrialRequested ?? false,
            sourcePlatform,
            sourceChannelId: body.sourceChannelId,
            sourceMessageId: body.sourceMessageId
          }
        });
        await tx.orderStatusLog.create({
          data: {
            orderId: order.id,
            fromStatus: OrderStatus.PENDING_PAYMENT,
            toStatus: OrderStatus.PAID,
            actorId: customerId,
            reason: "CUSTOMER_CREATE_ORDER_GROUP"
          }
        });
        if (body.assignedById) {
          await tx.orderStatusLog.create({
            data: {
              orderId: order.id,
              fromStatus: OrderStatus.PAID,
              toStatus: OrderStatus.ASSIGNED,
              actorId: body.assignedById,
              reason: "ADMIN_ASSIGN_ORDER_GROUP"
            }
          });
          await tx.adminLog.create({
            data: {
              actorId: body.assignedById,
              targetUserId: item.companionId,
              action: "ASSIGN_ORDER",
              entityType: "ORDER",
              entityId: order.id,
              detail: { companionId: item.companionId, orderGroupId: orderGroup.id, groupNo }
            }
          });
        }
        orders.push(order);
      }

      await tx.walletTransaction.create({
        data: {
          walletId: customer.wallet.id,
          userId: customerId,
          type: WalletTransactionType.ORDER_PAYMENT,
          direction: TransactionDirection.DEBIT,
          amount: totalAmount,
          balanceAfter: walletAfter.availableBalance,
          referenceType: "ORDER_GROUP",
          referenceId: orderGroup.id,
          note: `Customer multi-companion order payment frozen; original ${originalAmount.toString()}, discount ${discountAmount.toString()}`
        }
      });

      return { orderGroup, orders };
    });

    const notifications = body.assignedById
      ? await Promise.all(result.orders.map((order) => this.botNotifications.sendOrderAssignedNotifications(order.id).catch((error) => ({ error }))))
      : [];
    return { ...result, notifications };
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

  async startAssignedOrderByAdmin(orderId: string, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({ where: { id: adminId }, select: { role: true } });
      if (!actor || (actor.role !== UserRole.ADMIN && actor.role !== UserRole.SUPER_ADMIN)) {
        throw new BadRequestException("Only admin can start assigned orders");
      }

      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, status: true, companionId: true }
      });

      if (!order) throw new NotFoundException("Order not found");
      if (order.status !== OrderStatus.ASSIGNED) {
        throw new BadRequestException(`Only ASSIGNED orders can be started by admin. Current status: ${order.status}`);
      }
      if (!order.companionId) throw new BadRequestException("Order has no assigned companion");

      const now = new Date();
      const updated = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.ASSIGNED },
        data: { status: OrderStatus.IN_PROGRESS, acceptedAt: now, startedAt: now }
      });
      if (updated.count !== 1) throw new BadRequestException("Order was already changed");

      await tx.orderStatusLog.createMany({
        data: [
          {
            orderId,
            fromStatus: OrderStatus.ASSIGNED,
            toStatus: OrderStatus.ACCEPTED,
            actorId: adminId,
            reason: "ADMIN_FORCE_ACCEPT_AFTER_ASSIGN"
          },
          {
            orderId,
            fromStatus: OrderStatus.ACCEPTED,
            toStatus: OrderStatus.IN_PROGRESS,
            actorId: adminId,
            reason: "ADMIN_START_AFTER_ASSIGN"
          }
        ]
      });

      await tx.adminLog.create({
        data: {
          actorId: adminId,
          targetUserId: order.companionId,
          action: "START_ASSIGNED_ORDER",
          entityType: "ORDER",
          entityId: orderId,
          detail: { companionId: order.companionId }
        }
      });

      return tx.order.findUniqueOrThrow({ where: { id: orderId } });
    });
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
      if (externalAccount.user.status !== UserStatus.ACTIVE) {
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

      await this.settleCompanionRecurringReferralCommission(tx, {
        customerId: order.customerId,
        orderId,
        operatorId: actorId,
        orderTotalAmount: order.totalAmount,
        platformFee
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

    await this.botNotifications.syncCustomerMembershipLevels(result.customerId).catch(() => undefined);

    return result;
  }

  async cancelOrderByAdmin(adminId: string, orderId: string, body: { note?: string } = {}) {
    const discountConfig = await this.resolveMultiCompanionDiscountConfig();
    const cancellableStatuses: OrderStatus[] = [OrderStatus.PAID, OrderStatus.ASSIGNED, OrderStatus.ACCEPTED];
    const unsafeGroupStatuses: OrderStatus[] = [OrderStatus.IN_PROGRESS, OrderStatus.COMPLETED, OrderStatus.DISPUTED];

    return this.prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({ where: { id: adminId }, select: { role: true } });
      if (!actor || (actor.role !== UserRole.ADMIN && actor.role !== UserRole.SUPER_ADMIN)) {
        throw new BadRequestException("Only admin can cancel orders");
      }

      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          customer: { include: { wallet: true } },
          orderGroup: true
        }
      });
      if (!order) throw new NotFoundException("Order not found");
      if (!cancellableStatuses.includes(order.status)) {
        throw new BadRequestException(`Only unstarted paid orders can be cancelled. Current status: ${order.status}`);
      }
      if (!order.customer.wallet) throw new BadRequestException("Customer wallet does not exist");

      const now = new Date();
      const reason = body.note?.trim() || "Admin cancelled unstarted order";
      let walletMove = order.totalAmount;
      const walletNoteParts = [`Refund cancelled order ${order.orderNo}`];

      if (order.orderGroupId) {
        const groupOrders = await tx.order.findMany({
          where: { orderGroupId: order.orderGroupId },
          orderBy: { groupItemIndex: "asc" }
        });
        const unsafeSibling = groupOrders.find((item) => item.id !== order.id && unsafeGroupStatuses.includes(item.status));
        if (unsafeSibling) {
          throw new BadRequestException("Order group has started or settled orders; please use manual finance review");
        }

        const closedStatuses: OrderStatus[] = [OrderStatus.CANCELLED, OrderStatus.REFUNDED];
        const remainingOrders = groupOrders.filter((item) => item.id !== order.id && !closedStatuses.includes(item.status));
        const shouldRemoveDiscount = remainingOrders.length > 0 && remainingOrders.length < discountConfig.minCount;
        const repricedRemaining = remainingOrders.map((item) => {
          const originalUnitPrice = item.originalUnitPrice ?? item.unitPrice.add(item.discountPerHour);
          const originalAmount = item.originalAmount ?? originalUnitPrice.mul(item.hours);
          const nextTotalAmount = shouldRemoveDiscount ? originalAmount : item.totalAmount;
          return {
            id: item.id,
            originalUnitPrice,
            originalAmount,
            unitPrice: shouldRemoveDiscount ? originalUnitPrice : item.unitPrice,
            discountPerHour: shouldRemoveDiscount ? new Prisma.Decimal(0) : item.discountPerHour,
            totalAmount: nextTotalAmount,
            adjustment: nextTotalAmount.sub(item.totalAmount)
          };
        });

        const zero = new Prisma.Decimal(0);
        const adjustmentAmount = repricedRemaining.reduce((sum, item) => sum.add(item.adjustment.gt(0) ? item.adjustment : zero), zero);
        walletMove = order.totalAmount.sub(adjustmentAmount);
        if (adjustmentAmount.gt(0)) {
          walletNoteParts.push(`Multi-companion discount rollback ${adjustmentAmount.toString()}`);
        }

        for (const item of repricedRemaining) {
          await tx.order.update({
            where: { id: item.id },
            data: {
              originalUnitPrice: item.originalUnitPrice,
              originalAmount: item.originalAmount,
              unitPrice: item.unitPrice,
              discountPerHour: item.discountPerHour,
              totalAmount: item.totalAmount
            }
          });
        }

        const nextOriginalAmount = repricedRemaining.reduce((sum, item) => sum.add(item.originalAmount), zero);
        const nextTotalAmount = repricedRemaining.reduce((sum, item) => sum.add(item.totalAmount), zero);
        await tx.orderGroup.update({
          where: { id: order.orderGroupId },
          data: {
            companionCount: repricedRemaining.length,
            originalAmount: nextOriginalAmount,
            discountAmount: nextOriginalAmount.sub(nextTotalAmount),
            totalAmount: nextTotalAmount,
            note: [order.orderGroup?.note, `Cancelled ${order.orderNo}: ${reason}`].filter(Boolean).join("\n")
          }
        });
      }

      if (walletMove.gte(0)) {
        const refund = await tx.wallet.updateMany({
          where: {
            userId: order.customerId,
            frozenBalance: { gte: walletMove }
          },
          data: {
            frozenBalance: { decrement: walletMove },
            availableBalance: { increment: walletMove }
          }
        });
        if (refund.count !== 1) throw new BadRequestException("Customer frozen balance is insufficient for refund");
      } else {
        const topUp = walletMove.abs();
        const topUpResult = await tx.wallet.updateMany({
          where: {
            userId: order.customerId,
            availableBalance: { gte: topUp }
          },
          data: {
            availableBalance: { decrement: topUp },
            frozenBalance: { increment: topUp }
          }
        });
        if (topUpResult.count !== 1) {
          throw new BadRequestException("Customer available balance is insufficient after discount rollback");
        }
      }

      const walletAfter = await tx.wallet.findUniqueOrThrow({ where: { userId: order.customerId } });
      if (walletMove.gt(0)) {
        await tx.walletTransaction.create({
          data: {
            walletId: walletAfter.id,
            userId: order.customerId,
            operatorId: adminId,
            type: WalletTransactionType.ORDER_REFUND,
            direction: TransactionDirection.CREDIT,
            amount: walletMove,
            balanceAfter: walletAfter.availableBalance,
            referenceType: order.orderGroupId ? "ORDER_GROUP" : "ORDER",
            referenceId: order.orderGroupId ?? order.id,
            note: walletNoteParts.join("; ")
          }
        });
      } else if (walletMove.lt(0)) {
        await tx.walletTransaction.create({
          data: {
            walletId: walletAfter.id,
            userId: order.customerId,
            operatorId: adminId,
            type: WalletTransactionType.ORDER_PAYMENT,
            direction: TransactionDirection.DEBIT,
            amount: walletMove.abs(),
            balanceAfter: walletAfter.availableBalance,
            referenceType: "ORDER_GROUP",
            referenceId: order.orderGroupId ?? order.id,
            note: walletNoteParts.join("; ")
          }
        });
      }

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.REFUNDED,
          cancelledAt: now,
          notes: [order.notes, `取消/退款：${reason}`].filter(Boolean).join("\n")
        }
      });

      await tx.orderStatusLog.create({
        data: {
          orderId: order.id,
          fromStatus: order.status,
          toStatus: OrderStatus.REFUNDED,
          actorId: adminId,
          reason: "ADMIN_CANCEL_ORDER_REFUND"
        }
      });

      await tx.adminLog.create({
        data: {
          actorId: adminId,
          targetUserId: order.customerId,
          action: "CANCEL_ORDER_REFUND",
          entityType: "ORDER",
          entityId: order.id,
          detail: {
            orderNo: order.orderNo,
            orderGroupId: order.orderGroupId,
            walletMove: walletMove.toString(),
            note: body.note
          }
        }
      });

      const updated = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: {
          customer: { select: { id: true, email: true, displayName: true } },
          companion: { select: { id: true, email: true, displayName: true } },
          assignedBy: { select: { id: true, email: true, displayName: true } },
          orderGroup: { select: { id: true, groupNo: true, companionCount: true, originalAmount: true, discountAmount: true, totalAmount: true } },
          sourceDraft: { select: { id: true, draftNo: true, sourcePlatform: true, voiceRoomId: true, status: true } },
          statusLogs: { orderBy: { createdAt: "desc" }, take: 5 }
        }
      });

      return this.serializeOrder(updated);
    });
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

    if (referral.sourceType === "COMPANION" && companionReferralReward.gt(0)) {
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

  private async settleCompanionRecurringReferralCommission(
    tx: Prisma.TransactionClient,
    input: {
      customerId: string;
      orderId: string;
      operatorId: string;
      orderTotalAmount: Prisma.Decimal;
      platformFee: Prisma.Decimal;
    }
  ) {
    const referral = await tx.userReferral.findUnique({
      where: { referredUserId: input.customerId },
      include: {
        referrer: { include: { wallet: true } }
      }
    });
    if (!referral || referral.sourceType !== "COMPANION" || referral.referrer.status !== UserStatus.ACTIVE) return;

    const rate = await this.getPlatformSettingRate(tx, "COMPANION_REFERRAL_COMMISSION_RATE", "0.01");
    const rawReward = input.orderTotalAmount.mul(rate).toDecimalPlaces(2);
    const reward = rawReward.gt(input.platformFee) ? input.platformFee : rawReward;
    if (reward.lte(0)) return;

    const referrerWallet = referral.referrer.wallet
      ? await tx.wallet.update({
          where: { id: referral.referrer.wallet.id },
          data: { availableIncome: { increment: reward } }
        })
      : await tx.wallet.create({
          data: { userId: referral.referrerId, availableIncome: reward }
        });

    await tx.walletTransaction.create({
      data: {
        walletId: referrerWallet.id,
        userId: referral.referrerId,
        operatorId: input.operatorId,
        type: WalletTransactionType.REFERRAL_REWARD,
        direction: TransactionDirection.CREDIT,
        amount: reward,
        balanceAfter: referrerWallet.availableIncome,
        referenceType: "ORDER_REFERRAL_COMMISSION",
        referenceId: input.orderId,
        note: "Companion recurring referral commission"
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

  private async getPlatformSettingRate(tx: Prisma.TransactionClient, key: string, fallback: string) {
    const setting = await tx.platformSetting.findUnique({ where: { key } });
    try {
      const value = new Prisma.Decimal(setting?.value ?? fallback);
      if (value.lt(0)) return new Prisma.Decimal(0);
      if (value.gt(1)) return new Prisma.Decimal(1);
      return value.toDecimalPlaces(4);
    } catch {
      return new Prisma.Decimal(fallback);
    }
  }

  private async resolvePricing(
    companionId: string | undefined,
    game: GameCode,
    sourcePlatform: OrderSourcePlatform,
    priceTier: ServicePriceTier,
    options: { rankTierKey?: string; customUnitPrice?: string } = {}
  ) {
    const companion = companionId
      ? await this.prisma.companionProfile.findFirst({
          where: {
            userId: companionId,
            OR: [{ game }, { games: { has: game } }],
            status: CompanionProfileStatus.LISTED,
            user: {
              is: {
                status: UserStatus.ACTIVE
              }
            }
          },
          select: {
            pricePerHour: true,
            kookPricePerHour: true,
            discordPricePerHour: true,
            entertainmentPricePerHour: true,
            rankedPricePerHour: true,
            highRankedPricePerHour: true,
            commissionRate: true
          }
        })
      : null;

    if (companionId && !companion) throw new BadRequestException("Companion is not listed for selected game or does not exist");
    const commissionRate = companion?.commissionRate ?? this.defaultPlatformCommissionRate();
    const rankPricing = await this.resolveGameRankPrice(game, options.rankTierKey);
    if (rankPricing) {
      return {
        unitPrice: rankPricing.unitPrice,
        commissionRate,
        rankTierKey: rankPricing.tierKey,
        rankTierName: rankPricing.tierName
      };
    }

    if (priceTier === ServicePriceTier.CUSTOM && options.customUnitPrice?.trim()) {
      return {
        unitPrice: this.positiveDecimal(options.customUnitPrice.trim(), "customUnitPrice"),
        commissionRate,
        rankTierKey: null,
        rankTierName: null
      };
    }

    if (!companion) {
      return {
        unitPrice: await this.resolvePlatformMatchUnitPrice(sourcePlatform, priceTier),
        commissionRate,
        rankTierKey: null,
        rankTierName: null
      };
    }

    return {
      unitPrice: this.pickCompanionPriceForTier(companion, sourcePlatform, priceTier),
      commissionRate,
      rankTierKey: null,
      rankTierName: null
    };
  }

  private async resolveGameRankPrice(game: GameCode, rawTierKey?: string) {
    const tierKey = this.normalizeRankTierKey(rawTierKey);
    if (!tierKey) return null;
    const rankPrice = await this.prisma.gameRankPrice.findUnique({
      where: { game_tierKey: { game, tierKey } },
      select: { tierKey: true, tierName: true, unitPrice: true, isActive: true }
    });
    if (!rankPrice || !rankPrice.isActive) throw new BadRequestException("Rank price tier is not configured for selected game");
    return rankPrice;
  }

  private normalizeRankTierKey(value?: string | null) {
    const normalized = value?.trim();
    if (!normalized || normalized === "CUSTOM") return undefined;
    return normalized.slice(0, 80);
  }

  private async resolvePlatformMatchUnitPrice(sourcePlatform: OrderSourcePlatform, priceTier: ServicePriceTier) {
    for (const key of this.platformMatchPriceKeys(sourcePlatform, priceTier)) {
      const configured = await this.readPositivePlatformPrice(key);
      if (configured) return configured;
    }

    return this.positiveDecimal(this.defaultPlatformMatchUnitPrice(priceTier), `DEFAULT_${priceTier}_PLATFORM_MATCH_UNIT_PRICE`);
  }

  private platformMatchPriceKeys(sourcePlatform: OrderSourcePlatform, priceTier: ServicePriceTier) {
    const platformPrefix =
      sourcePlatform === OrderSourcePlatform.DISCORD ? "DISCORD_" : sourcePlatform === OrderSourcePlatform.KOOK ? "KOOK_" : "";
    const tier = priceTier === ServicePriceTier.HIGH_RANKED ? "HIGH_RANKED" : priceTier;
    const tierKeys = [
      ...(platformPrefix ? [`${platformPrefix}PLATFORM_MATCH_${tier}_UNIT_PRICE`] : []),
      `PLATFORM_MATCH_${tier}_UNIT_PRICE`
    ];
    if (priceTier !== ServicePriceTier.CUSTOM) return tierKeys;

    return [
      ...tierKeys,
      ...(platformPrefix ? [`${platformPrefix}PLATFORM_MATCH_UNIT_PRICE`] : []),
      "PLATFORM_MATCH_UNIT_PRICE"
    ];
  }

  private async readPositivePlatformPrice(key: string) {
    const configured = await this.readPlatformSettingValue(key);
    return configured ? this.positiveDecimal(configured, key) : null;
  }

  private async readPlatformSettingValue(key: string) {
    const setting = await this.prisma.platformSetting.findUnique({
      where: { key },
      select: { value: true }
    });
    return setting?.value ?? process.env[key];
  }

  private async resolveMultiCompanionDiscountConfig() {
    const enabledRaw = (await this.readPlatformSettingValue("MULTI_COMPANION_DISCOUNT_ENABLED")) ?? "1";
    const minCountRaw = (await this.readPlatformSettingValue("MULTI_COMPANION_DISCOUNT_MIN_COUNT")) ?? "2";
    const discountRaw = (await this.readPlatformSettingValue("MULTI_COMPANION_DISCOUNT_AMOUNT")) ?? "10";
    const floorRaw = (await this.readPlatformSettingValue("MULTI_COMPANION_DISCOUNT_FLOOR_PRICE")) ?? "68";
    const minCount = Number.parseInt(minCountRaw, 10);
    if (!Number.isInteger(minCount) || minCount < 1) throw new BadRequestException("MULTI_COMPANION_DISCOUNT_MIN_COUNT must be a positive integer");
    return {
      enabled: !["0", "false", "off", "disabled"].includes(enabledRaw.trim().toLowerCase()),
      minCount: Math.max(2, minCount),
      discountPerHour: this.nonNegativeDecimal(discountRaw, "MULTI_COMPANION_DISCOUNT_AMOUNT"),
      floorPrice: this.nonNegativeDecimal(floorRaw, "MULTI_COMPANION_DISCOUNT_FLOOR_PRICE")
    };
  }

  private applyUnitDiscount(unitPrice: Prisma.Decimal, discountPerHour: Prisma.Decimal, floorPrice: Prisma.Decimal) {
    const discounted = unitPrice.sub(discountPerHour);
    if (discounted.gte(floorPrice)) return discounted;
    return unitPrice.lt(floorPrice) ? unitPrice : floorPrice;
  }

  private defaultPlatformMatchUnitPrice(_priceTier: ServicePriceTier) {
    return "98";
  }
  private pickCompanionPriceForTier(
    companion: {
      pricePerHour: Prisma.Decimal;
      kookPricePerHour: Prisma.Decimal | null;
      discordPricePerHour: Prisma.Decimal | null;
      entertainmentPricePerHour: Prisma.Decimal | null;
      rankedPricePerHour: Prisma.Decimal | null;
      highRankedPricePerHour: Prisma.Decimal | null;
    },
    sourcePlatform: OrderSourcePlatform,
    priceTier: ServicePriceTier
  ) {
    if (priceTier === ServicePriceTier.ENTERTAINMENT) return companion.entertainmentPricePerHour ?? this.pickCompanionPriceForPlatform(companion, sourcePlatform);
    if (priceTier === ServicePriceTier.RANKED) return companion.rankedPricePerHour ?? this.pickCompanionPriceForPlatform(companion, sourcePlatform);
    if (priceTier === ServicePriceTier.HIGH_RANKED) return companion.highRankedPricePerHour ?? companion.rankedPricePerHour ?? this.pickCompanionPriceForPlatform(companion, sourcePlatform);
    return this.pickCompanionPriceForPlatform(companion, sourcePlatform);
  }

  private pickCompanionPriceForPlatform(
    companion: { pricePerHour: Prisma.Decimal; kookPricePerHour: Prisma.Decimal | null; discordPricePerHour: Prisma.Decimal | null },
    sourcePlatform: OrderSourcePlatform
  ) {
    if (sourcePlatform === OrderSourcePlatform.DISCORD) return companion.discordPricePerHour ?? companion.pricePerHour;
    if (sourcePlatform === OrderSourcePlatform.KOOK) return companion.kookPricePerHour ?? companion.pricePerHour;
    return companion.pricePerHour;
  }

  private normalizePriceTier(priceTier: ServicePriceTier | undefined, mode: string) {
    if (priceTier && Object.values(ServicePriceTier).includes(priceTier)) return priceTier;
    const normalizedMode = mode.toLowerCase();
    if (/高端|高分|高段|高等级|大师|王者|巅峰|immortal|radiant|master|challenger|predator/.test(normalizedMode)) {
      return ServicePriceTier.HIGH_RANKED;
    }
    if (/排位|上分|rank|ranked|competitive|天梯/.test(normalizedMode)) return ServicePriceTier.RANKED;
    if (/娱乐|休闲|陪聊|随便|随意|不限|都行|无所谓|casual|fun/.test(normalizedMode)) return ServicePriceTier.ENTERTAINMENT;
    return ServicePriceTier.CUSTOM;
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

  private nonNegativeDecimal(value: string, fieldName: string) {
    let decimal: Prisma.Decimal;
    try {
      decimal = new Prisma.Decimal(value);
    } catch {
      throw new BadRequestException(`${fieldName} must be a valid amount`);
    }
    if (decimal.lt(0)) throw new BadRequestException(`${fieldName} cannot be negative`);
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
    priceTier: ServicePriceTier;
    rankTierKey?: string | null;
    rankTierNameSnapshot?: string | null;
    originalUnitPrice?: Prisma.Decimal | null;
    unitPrice: Prisma.Decimal;
    discountPerHour?: Prisma.Decimal;
    originalAmount?: Prisma.Decimal | null;
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
    cancelledAt?: Date | null;
    customer?: { id: string; email: string; displayName: string };
    companion?: { id: string; email: string; displayName: string } | null;
    assignedBy?: { id: string; email: string; displayName: string } | null;
    orderGroup?: {
      id: string;
      groupNo: string;
      companionCount: number;
      rankTierKey?: string | null;
      rankTierNameSnapshot?: string | null;
      originalAmount: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
      totalAmount: Prisma.Decimal;
    } | null;
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
      priceTier: order.priceTier,
      rankTierKey: order.rankTierKey ?? null,
      rankTierNameSnapshot: order.rankTierNameSnapshot ?? null,
      originalUnitPrice: order.originalUnitPrice?.toString() ?? null,
      unitPrice: order.unitPrice.toString(),
      discountPerHour: order.discountPerHour?.toString() ?? "0",
      originalAmount: order.originalAmount?.toString() ?? null,
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
      cancelledAt: order.cancelledAt ?? null,
      customer: order.customer,
      companion: order.companion,
      assignedBy: order.assignedBy,
      orderGroup: order.orderGroup
        ? {
            ...order.orderGroup,
            originalAmount: order.orderGroup.originalAmount.toString(),
            discountAmount: order.orderGroup.discountAmount.toString(),
            totalAmount: order.orderGroup.totalAmount.toString()
          }
        : null,
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

  private generateOrderGroupNo() {
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const random = Math.random().toString(36).slice(2, 7).toUpperCase();
    return `MAYG${stamp}${random}`;
  }
}
