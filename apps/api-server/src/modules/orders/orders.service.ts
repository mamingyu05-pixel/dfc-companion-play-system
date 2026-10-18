import { requireKookActor } from "../kook/kook-flow-identity";
import { orderEnvironment } from "./order-environment";
import { dispatchReminder } from "./dispatch-reminder";
import { buildWorkQueue } from "./work-queue";
import { findCustomerOrderRequest } from "./order-request";
import { beginOrderRequest, completeOrderRequest, rejectUncommittedOrderRequest } from "./order-request";
import { assertDispatchVersion, requireDispatchVersion } from "./dispatch-version";
import { publicServiceLabel } from "./public-dispatch";
import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { fixedDecimal, money, commissionSplit } from "../financial-values";
import { lockOrder } from "./order-lock";
import { acceptanceDueAt, acceptanceHours, AUTO_ACCEPTANCE_HOURS } from "./acceptance-policy";
import { enqueueJob, IntegrationJobsService } from "../bot/integration-jobs.service";
import { NotificationOutcomeUnknown, withDeliveryContext } from "../bot/delivery-context";
import {
  BotEventType,
  BotPlatform,
  CompanionProfileStatus,
  GameCode,
  OrderAssignmentType,
  OrderSourcePlatform,
  OrderStatus,
  Order,
  Prisma,
  ServicePriceTier,
  TransactionDirection,
  UserRole,
  UserStatus,
  WalletTransactionType
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { BotNotificationService } from "../bot/bot-notification.service";

type CreateOrderBody = {
      requestId?: string;
      expectedTotalAmount?: string;
      testEnvironment?: string;
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
    };

const CUSTOMER_SELECTED_DISPATCH = "CUSTOMER_SELECTED_DISPATCH:";

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly botNotifications: BotNotificationService,
    @Optional() private readonly jobs?: IntegrationJobsService
  ) {}

  onModuleInit() {
    this.jobs?.registerPoll("ORDER_COMPLETION_AUTO_ACCEPTANCE", () => this.autoAcceptCompletions());
    this.jobs?.register("ORDER_ACCEPTANCE_TIMEOUT", async payload => {
      const task = payload as { orderId: string; dispatchVersion: number };
      await this.expireAssignment(task.orderId, task.dispatchVersion);
    });
  }

  findCustomerOrderRequest(customerId: string, requestId: string) {
    return findCustomerOrderRequest(this.prisma, customerId, requestId);
  }

  getOrderEnvironment() {
    return orderEnvironment(this.prisma);
  }

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
            _count: { select: { companionOrders: { where: { status: { in: [OrderStatus.ACCEPTED, OrderStatus.IN_PROGRESS] } } } } },
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

    const reviews = await this.prisma.orderReview.findMany({
      where: { hidden: false, order: { companionId: { in: companions.map(profile => profile.userId) } } },
      select: { stars: true, comment: true, createdAt: true, order: { select: { companionId: true } } },
      orderBy: { createdAt: "desc" }
    });
    return companions.map((profile) => ({
      ...this.companionReviewSummary(reviews.filter(review => review.order.companionId === profile.userId)),
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
      activeServiceCount: profile.user._count.companionOrders,
      availability: profile.onlineStatus === "BUSY" ? "PAUSED" : profile.user._count.companionOrders > 0
        ? "IN_SERVICE" : profile.onlineStatus === "ONLINE" ? "AVAILABLE" : "CONTACT_FIRST",
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
    const hours = await this.autoAcceptanceHours();
    const orders = await this.prisma.order.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      include: {
        review: { select: { id: true } },
        complaints: { where: { status: { notIn: ["RESOLVED", "REJECTED"] } }, select: { id: true } },
        companion: { select: { id: true, email: true, displayName: true } },
        orderGroup: { select: { id: true, groupNo: true, companionCount: true, originalAmount: true, discountAmount: true, totalAmount: true } },
        statusLogs: { orderBy: { createdAt: "desc" }, take: 5 }
      }
    });
    return orders.map((order) => ({ ...this.serializeOrder(order, false),
      hasReview: Boolean(order.review),
      autoAcceptanceDueAt: order.status === OrderStatus.AWAITING_ACCEPTANCE && !order.complaints.length
        ? acceptanceDueAt(order.reportedCompletedAt, hours) : null,
      autoAcceptanceHours: hours
    }));
  }

  async getWorkQueue() {
    const limit = 100;
    const orderInclude = { customer: { select: { displayName: true } }, assignedBy: { select: { displayName: true } },
      statusLogs: { orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], take: 1 } };
    // Reserve a bounded read for disputes/refunds so older routine orders cannot hide them.
    // Routine orders remain a bounded oldest-first sample, not a full global priority scan.
    const [urgentOrders, routineOrders, drafts, complaints] = await Promise.all([
      this.prisma.order.findMany({ where: { status: { in: [OrderStatus.DISPUTED, OrderStatus.REFUND_REQUESTED] } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit + 1, include: orderInclude }),
      this.prisma.order.findMany({ where: { status: { in: [OrderStatus.PAID, OrderStatus.ASSIGNED, OrderStatus.ACCEPTED,
        OrderStatus.AWAITING_ACCEPTANCE] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limit + 1, include: orderInclude }),
      this.prisma.orderDraft.findMany({ where: { status: { in: ["OPEN", "TRIALING", "SELECTED", "CUSTOMER_CONFIRMED"] } },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: limit + 1,
        include: { customer: { select: { displayName: true } }, serviceAdmin: { select: { displayName: true } },
          candidates: { select: { status: true } }, events: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } } }),
      this.prisma.complaint.findMany({ where: { status: { in: ["OPEN", "IN_REVIEW"] } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit + 1,
        include: { resolvedBy: { select: { displayName: true } }, order: { select: { orderNo: true, customer: { select: { displayName: true } } } } } })
    ]);
    // A status can change between reads. Keep one row per order, preferring the urgent snapshot.
    const orders = [...new Map([...routineOrders, ...urgentOrders].map(order => [order.id, order])).values()];
    const checkedAt = new Date();
    let includedOrders = 0;
    const items = buildWorkQueue(orders, drafts.slice(0, limit), complaints.slice(0, limit), checkedAt)
      .filter(item => item.kind !== "ORDER" || ++includedOrders <= limit);
    return { checkedAt, limitPerKind: limit, hasMore: { orders: orders.length > limit, drafts: drafts.length > limit, complaints: complaints.length > limit },
      items };
  }

  async getOrderRecord(orderId: string, viewer: { id: string; role: UserRole }) {
    const admin = viewer.role === UserRole.ADMIN || viewer.role === UserRole.SUPER_ADMIN;
    // Authorize in the database predicate before reading audit records or notes.
    const order = await this.prisma.order.findFirst({ where: { id: orderId,
      ...(admin ? {} : { OR: [{ customerId: viewer.id }, { companionId: viewer.id }] }) },
      include: { orderGroup: { select: { groupNo: true, companionCount: true } },
        statusLogs: { take: 101, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: { actor: { select: { role: true, displayName: true } } } },
        complaints: { where: admin ? {} : { reporterId: viewer.id }, take: 31,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, status: true, reason: true, resolution: true, createdAt: true, updatedAt: true } } }
    });
    if (!order) throw new NotFoundException("订单不存在或无权查看");
    return {
      id: order.id, orderNo: order.orderNo, status: order.status,
      quote: { reference: order.orderNo, capturedAt: order.createdAt, game: order.game, mode: order.mode,
        hours: order.hours.toString(), unit: "小时 / 本单一位陪玩", rank: order.rankTierNameSnapshot,
        originalUnitPrice: order.originalUnitPrice?.toString() ?? null, unitPrice: order.unitPrice.toString(),
        discountPerHour: order.discountPerHour.toString(), originalAmount: order.originalAmount?.toString() ?? null,
        totalAmount: order.totalAmount.toString(), group: order.orderGroup },
      refundAmount: order.refundAmount.toString(),
      timeline: order.statusLogs.slice(0, 100).reverse().map(log => ({ id: log.id, fromStatus: log.fromStatus,
        toStatus: log.toStatus, createdAt: log.createdAt,
        actor: admin ? log.actor?.displayName || "系统" : !log.actorId ? "系统"
          : log.actorId === order.customerId && log.actorId === order.companionId ? "本单参与者"
          : log.actorId === order.customerId ? "客户" : log.actorId === order.companionId ? "陪玩"
          : log.actor?.role === UserRole.ADMIN || log.actor?.role === UserRole.SUPER_ADMIN ? "客服"
          : log.actor ? "参与者" : "系统",
        reason: admin ? log.reason : null })),
      timelineTruncated: order.statusLogs.length > 100,
      complaints: order.complaints.slice(0, 30).map(complaint => ({ ...complaint, resolution: admin ? complaint.resolution : null })),
      complaintsTruncated: order.complaints.length > 30,
      evidenceScope: admin ? "管理员可见订单日志与投诉记录" : "订单状态日志及本人提交的投诉记录；内部处置备注不展示",
      financialNotice: "创建时确认金额来自已保存订单；refundAmount 为站内钱包退款记录金额，不代表外部支付渠道到账；投诉、备注和通知不是到账凭证。"
    };
  }

  private companionReviewSummary(reviews: Array<{ stars: number; comment: string; createdAt: Date }>) {
    return { reviewCount: reviews.length,
      averageRating: reviews.length ? reviews.reduce((sum, review) => sum + review.stars, 0) / reviews.length : null,
      reviews: reviews.slice(0, 20).map(({ stars, comment, createdAt }) => ({ stars, comment, createdAt })) };
  }

  async autoAcceptanceHours(db: Prisma.TransactionClient = this.prisma) {
    const setting = await db.platformSetting.findUnique({ where: { key: AUTO_ACCEPTANCE_HOURS } });
    return acceptanceHours(setting?.value);
  }

  async autoAcceptCompletions() {
    const hours = await this.autoAcceptanceHours();
    const due = await this.prisma.order.findMany({
      where: { status: OrderStatus.AWAITING_ACCEPTANCE, reportedCompletedAt: { lte: new Date(Date.now() - hours * 3_600_000) },
        complaints: { none: { status: { notIn: ["RESOLVED", "REJECTED"] } } } },
      select: { id: true, customerId: true }, orderBy: { reportedCompletedAt: "asc" }, take: 100
    });
    let accepted = 0;
    for (const order of due) {
      try {
        if (await this.acceptCompletion(order.id, order.customerId, "系统超时自动验收", undefined, true)) accepted++;
      } catch {
        Logger.error(`Auto acceptance failed for order ${order.id}`, "OrdersService");
      }
    }
    return { scanned: due.length, accepted };
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
    return orders.map((order) => this.serializeOrder(order, false));
  }

  async listAvailableOrdersForCompanion(companionId: string) {
    const companion = await this.prisma.user.findFirst({
      where: {
        id: companionId,
        status: UserStatus.ACTIVE,
        companionProfile: { is: { status: CompanionProfileStatus.LISTED } }
      },
      include: { companionProfile: true }
    });
    if (!companion) throw new BadRequestException("Companion is not listed, active or does not exist");
    const profile = companion.companionProfile!;
    if (profile.onlineStatus === "BUSY") return [];

    const orders = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.ASSIGNED,
        game: { in: [...new Set([profile.game, ...profile.games])] },
        AND: [
          { OR: [{ companionId }, { companionId: null }] },
          { OR: [{ acceptanceDeadline: null }, { acceptanceDeadline: { gt: new Date() } }] }
        ]
      },
      orderBy: { createdAt: "asc" },
      include: {
        customer: { select: { id: true, email: true, displayName: true } },
        companion: { select: { id: true, email: true, displayName: true } },
        orderGroup: { select: { id: true, groupNo: true, companionCount: true, originalAmount: true, discountAmount: true, totalAmount: true } },
        statusLogs: { orderBy: { createdAt: "desc" }, take: 5 }
      }
    });
    return orders.map(order => ({ id: order.id, orderNo: order.orderNo, game: order.game,
      mode: publicServiceLabel(order.priceTier), hours: order.hours.toString(), totalAmount: order.totalAmount.toString(),
      unitPrice: order.unitPrice.toString(), status: order.status, companionId: order.companionId,
      dispatchVersion: order.dispatchVersion, acceptanceDeadline: order.acceptanceDeadline }));
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
        statusLogs: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5 }
      }
    });
    const assignedIds = orders.filter(order => order.status === OrderStatus.ASSIGNED).map(order => order.id);
    const assignments = assignedIds.length ? await this.prisma.orderStatusLog.findMany({
      where: { orderId: { in: assignedIds }, toStatus: OrderStatus.ASSIGNED },
      orderBy: [{ orderId: "asc" }, { createdAt: "desc" }, { id: "desc" }], distinct: ["orderId"],
      select: { orderId: true, toStatus: true, createdAt: true, reason: true }
    }) : [];
    const checkedAt = new Date();
    return orders.map(order => ({ ...this.serializeOrder(order),
      dispatchReminder: dispatchReminder(order, assignments.find(log => log.orderId === order.id), checkedAt) }));
  }

  async previewCustomerOrder(customerId: string, body: { game?: GameCode; mode: string; hours: string; companionId: string; testEnvironment?: string }) {
    const environment = await orderEnvironment(this.prisma, body.testEnvironment);
    if (!body.mode?.trim() || !body.companionId?.trim()) throw new BadRequestException("请选择陪玩和模式");
    const customer = await this.prisma.user.findFirst({ where: { id: customerId, role: UserRole.CUSTOMER, status: UserStatus.ACTIVE }, select: { id: true } });
    if (!customer) throw new BadRequestException("请使用有效的客户账号");
    const game = body.game ?? GameCode.DELTA_FORCE;
    const hours = this.positiveDecimal(body.hours, "hours");
    const maxHours = this.positiveDecimal(process.env.ORDER_MAX_HOURS ?? "8", "ORDER_MAX_HOURS");
    if (hours.gt(maxHours)) throw new BadRequestException("服务时长超出当前上限");
    const pricing = await this.resolvePricing(body.companionId, game, OrderSourcePlatform.WEB, this.normalizePriceTier(undefined, body.mode));
    return { ...environment, customerId, companionId: body.companionId, game, mode: body.mode, hours: hours.toString(), unitPrice: pricing.unitPrice.toString(),
      totalAmount: money(pricing.unitPrice.mul(hours), true).toString() };
  }

  async createOrder(customerId: string, body: CreateOrderBody) {
    return this.prisma.$transaction(tx => this.createOrderInTransaction(tx, customerId, body)).catch(rejectUncommittedOrderRequest);
  }

  private async createOrderInTransaction(tx: Prisma.TransactionClient, customerId: string, body: CreateOrderBody) {
    const environment = await orderEnvironment(tx, body.testEnvironment);
    if (!body.mode) throw new BadRequestException("mode is required");
      if (body.sourceDraftId) await tx.$queryRaw`SELECT "id" FROM "order_drafts" WHERE "id" = ${body.sourceDraftId} FOR UPDATE`;
      const receipt = await beginOrderRequest(tx, "ORDER", customerId, body);
      if (receipt.resourceId) return tx.order.findUniqueOrThrow({ where: { id: receipt.resourceId } });
      if (body.sourceDraftId) await this.lockUnconvertedDraft(tx, body.sourceDraftId, customerId);
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
      }, tx);
      const totalAmount = money(pricing.unitPrice.mul(hours), true);
      if (body.expectedTotalAmount !== undefined) {
        const confirmedAmount = fixedDecimal(body.expectedTotalAmount, "expectedTotalAmount");
        if (!totalAmount.eq(confirmedAmount)) {
          throw new BadRequestException("价格已变化，请重新核对订单金额后提交");
        }
      }

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
          storeKey: environment.storeKey,
          isTest: environment.isTest,
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

      // Customer selection is a preference. Only the service desk dispatches paid orders.
      await completeOrderRequest(tx, receipt, order.id);
      return order;
  }

  async previewKookCustomerOrder(tx: Prisma.TransactionClient, customerId: string, body: { mode: string; hours: string; companionId: string }) {
    const customer = await tx.user.findFirst({ where: { id: customerId, role: UserRole.CUSTOMER, status: UserStatus.ACTIVE } });
    if (!customer) throw new BadRequestException("请使用有效的客户账号");
    const hours = this.positiveDecimal(body.hours, "hours");
    if (hours.gt(this.positiveDecimal(process.env.ORDER_MAX_HOURS ?? "8", "ORDER_MAX_HOURS"))) throw new BadRequestException("服务时长超出当前上限");
    const pricing = await this.resolvePricing(body.companionId, GameCode.DELTA_FORCE, OrderSourcePlatform.KOOK, this.normalizePriceTier(undefined, body.mode), {}, tx);
    return { ...body, unitPrice: pricing.unitPrice.toString(), totalAmount: money(pricing.unitPrice.mul(hours), true).toString() };
  }

  // Server-only entry: the persisted flow, wallet debit, request receipt and
  // dispatch outbox share the caller's transaction. No body flag grants authority.
  async createConfirmedKookOrder(tx: Prisma.TransactionClient, customerId: string, platformUserId: string,
    body: { requestId: string; mode: string; hours: string; companionId: string; expectedTotalAmount: string; expiresAt?: number }) {
    await requireKookActor(tx, platformUserId, customerId, UserRole.CUSTOMER, body.expiresAt);
    return this.createOrderInTransaction(tx, customerId, {
      requestId: body.requestId, mode: body.mode, hours: body.hours, companionId: body.companionId,
      expectedTotalAmount: body.expectedTotalAmount, game: GameCode.DELTA_FORCE, sourcePlatform: OrderSourcePlatform.KOOK
    });
  }

  private async lockUnconvertedDraft(tx: Prisma.TransactionClient, draftId: string, customerId: string) {
    // Single orders and legacy multi-companion groups share this draft lock.
    // Their separate unique indexes alone cannot prevent one of each racing.
    await tx.$queryRaw`SELECT "id" FROM "order_drafts" WHERE "id" = ${draftId} FOR UPDATE`;
    const draft = await tx.orderDraft.findUnique({ where: { id: draftId } });
    if (!draft || draft.customerId !== customerId || draft.status === "CANCELLED" || draft.status === "CONVERTED" ||
      await tx.order.count({ where: { sourceDraftId: draftId } }) || await tx.orderGroup.count({ where: { sourceDraftId: draftId } })) {
      throw new BadRequestException("需求已成单、关闭或不属于当前客户，请刷新原回执，不要重复下单。");
    }
  }

  async createConfirmedKookDraftOrder(tx: Prisma.TransactionClient, customerId: string, platformUserId: string,
    body: { draftId: string; companionId: string; mode: string; hours: string; expectedTotalAmount: string; expiresAt?: number }) {
    await requireKookActor(tx, platformUserId, customerId, UserRole.CUSTOMER, body.expiresAt);
    await tx.$queryRaw`SELECT "id" FROM "order_drafts" WHERE "id" = ${body.draftId} FOR UPDATE`;
    const draft = await tx.orderDraft.findUnique({ where: { id: body.draftId } });
    if (!draft || draft.customerId !== customerId || draft.customerPlatformUserId !== platformUserId || draft.sourcePlatform !== OrderSourcePlatform.KOOK ||
      draft.status !== "SELECTED" || draft.selectedCompanionId !== body.companionId || draft.game !== GameCode.DELTA_FORCE || draft.mode !== body.mode ||
      !draft.hours?.eq(this.positiveDecimal(body.hours, "hours")) || draft.rankTierKey || draft.priceTier !== this.normalizePriceTier(undefined, draft.mode)) throw new BadRequestException("需求或所选陪玩已变化，请刷新后重新确认。");
    if (body.expiresAt !== undefined && Date.now() >= body.expiresAt) throw new BadRequestException("报价已过期，请刷新后重新确认。");
    return this.createOrderInTransaction(tx, customerId, {
      requestId: `kook-demand-${draft.id}`, mode: draft.mode, hours: draft.hours.toString(), companionId: body.companionId,
      expectedTotalAmount: body.expectedTotalAmount, game: draft.game, sourcePlatform: OrderSourcePlatform.KOOK,
      sourceDraftId: draft.id, voiceTrialRequested: true, sourceChannelId: draft.sourceChannelId ?? undefined, sourceMessageId: draft.sourceMessageId ?? undefined
    });
  }

  async createOrderGroup(
    customerId: string,
    body: {
      requestId?: string;
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

    const result = await this.prisma.$transaction(async (tx) => {
      const environment = await orderEnvironment(tx);
      if (body.sourceDraftId) await tx.$queryRaw`SELECT "id" FROM "order_drafts" WHERE "id" = ${body.sourceDraftId} FOR UPDATE`;
      const receipt = await beginOrderRequest(tx, "ORDER_GROUP", customerId, body);
      if (receipt.resourceId) {
        const orderGroup = await tx.orderGroup.findUniqueOrThrow({ where: { id: receipt.resourceId } });
        const orders = await tx.order.findMany({ where: { orderGroupId: orderGroup.id }, orderBy: { groupItemIndex: "asc" } });
        return { orderGroup, orders, requestReplayed: true };
      }
      if (body.sourceDraftId) await this.lockUnconvertedDraft(tx, body.sourceDraftId, customerId);
      const game = body.game ?? GameCode.DELTA_FORCE;
      const hours = this.positiveDecimal(body.hours, "hours");
      const maxHours = this.positiveDecimal(process.env.ORDER_MAX_HOURS ?? "8", "ORDER_MAX_HOURS");
      if (hours.gt(maxHours)) throw new BadRequestException(`hours cannot be greater than ${maxHours.toString()}`);

      const sourcePlatform = body.sourcePlatform ?? OrderSourcePlatform.WEB;
      const priceTier = this.normalizePriceTier(body.priceTier, body.mode);
      const discountConfig = await this.resolveMultiCompanionDiscountConfig(tx);
      const discountEnabled = discountConfig.enabled && companionIds.length >= discountConfig.minCount && discountConfig.discountPerHour.gt(0);

      const items = await Promise.all(
        companionIds.map(async (companionId, index) => {
          const pricing = await this.resolvePricing(companionId, game, sourcePlatform, priceTier, {
            rankTierKey: body.rankTierKey,
            customUnitPrice: body.customUnitPrice
          }, tx);
          const originalUnitPrice = pricing.unitPrice;
          const unitPrice = discountEnabled
            ? this.applyUnitDiscount(originalUnitPrice, discountConfig.discountPerHour, discountConfig.floorPrice)
            : originalUnitPrice;
          const discountPerHour = originalUnitPrice.sub(unitPrice);
          const originalAmount = money(originalUnitPrice.mul(hours), true);
          const totalAmount = money(unitPrice.mul(hours), true);
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
      const totalAmount = money(items.reduce((sum, item) => sum.add(item.totalAmount), zero), true);
      const discountAmount = originalAmount.sub(totalAmount);
      const firstRankPricing = items.find((item) => item.rankTierKey);
      const groupNo = this.generateOrderGroupNo();
      const discountNote =
        discountAmount.gt(0) ? `多陪玩折扣：${items.length} 人，每人每小时减 ${discountConfig.discountPerHour.toString()}，共减 ${discountAmount.toString()}` : null;
      const notes = [body.notes, discountNote].filter(Boolean).join("\n") || undefined;

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
            storeKey: environment.storeKey,
            isTest: environment.isTest,
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

      await completeOrderRequest(tx, receipt, orderGroup.id);
      return { orderGroup, orders, requestReplayed: false };
    }).catch(rejectUncommittedOrderRequest);

    const notifications = body.assignedById && !result.requestReplayed
      ? await Promise.all(result.orders.map((order) => this.botNotifications.sendOrderAssignedNotifications(order.id).catch((error) => ({ error }))))
      : [];
    return { ...result, notifications };
  }

  async assignOrder(orderId: string, companionId: string, assignedById?: string, dispatchVersion?: number) {
    return this.dispatchOrder(orderId, assignedById, {
      mode: "DIRECT", companionId, reason: "ADMIN_ASSIGN_ORDER", dispatchVersion
    }, true);
  }

  async dispatchOrder(orderId: string, adminId: string | undefined, body: {
    mode: "DIRECT" | "OPEN"; companionId?: string; reason: string; acceptanceDeadline?: string | null; dispatchVersion?: number;
  }, onlyPaid = false) {
    requireDispatchVersion(body.dispatchVersion);
    if (!adminId) throw new BadRequestException("Active admin required");
    if (!["DIRECT", "OPEN"].includes(body.mode)) throw new BadRequestException("mode must be DIRECT or OPEN");
    if (typeof body.reason !== "string" || !body.reason.trim()) throw new BadRequestException("Dispatch reason is required");
    if (body.mode === "DIRECT" && (typeof body.companionId !== "string" || !body.companionId.trim())) {
      throw new BadRequestException("companionId is required for direct assignment");
    }
    if (body.mode === "OPEN" && body.companionId) throw new BadRequestException("Open dispatch cannot specify a companion");
    const deadline = body.acceptanceDeadline ? new Date(body.acceptanceDeadline) : null;
    if (deadline && (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= Date.now())) {
      throw new BadRequestException("acceptanceDeadline must be an explicit future date");
    }
    const order = await this.prisma.$transaction(async tx => {
      await lockOrder(tx, orderId);
      if (adminId) {
        const admin = await tx.user.findUnique({ where: { id: adminId } });
        if (!admin || admin.status !== UserStatus.ACTIVE || (admin.role !== UserRole.ADMIN && admin.role !== UserRole.SUPER_ADMIN)) throw new BadRequestException("Active admin required");
      }
      const current = await tx.order.findUnique({ where: { id: orderId } });
      if (!current) throw new NotFoundException("Order not found");
      if (current.status !== OrderStatus.PAID && (onlyPaid || current.status !== OrderStatus.ASSIGNED)) {
        throw new BadRequestException("Only PAID orders can be assigned; use dispatch to change an unaccepted assignment");
      }
      const companionId = body.mode === "DIRECT" ? body.companionId!.trim() : null;
      const sameAssignment = current.status === OrderStatus.ASSIGNED && current.companionId === companionId &&
        current.assignmentType === (companionId ? OrderAssignmentType.DIRECT_COMPANION : OrderAssignmentType.PLATFORM_MATCH) &&
        (current.acceptanceDeadline?.getTime() ?? null) === (deadline?.getTime() ?? null);
      if (sameAssignment && body.dispatchVersion === current.dispatchVersion) return current;
      // A retry of the exact already-applied command may return its result, never mutate a later round.
      if (sameAssignment && adminId && current.assignedById === adminId && body.dispatchVersion === current.dispatchVersion - 1) {
        const receipt = await tx.adminLog.findFirst({ where: { actorId: adminId, entityId: orderId, action: "DISPATCH_ORDER",
          detail: { path: ["dispatchVersion"], equals: current.dispatchVersion } } });
        const detail = receipt?.detail as { requestedVersion?: number; reason?: string } | undefined;
        if (detail?.requestedVersion === body.dispatchVersion && detail.reason === body.reason.trim()) return current;
      }
      assertDispatchVersion(current.dispatchVersion, body.dispatchVersion);
      if (companionId) await this.assertAvailableCompanion(tx, companionId, current);
      const updated = await tx.order.update({ where: { id: orderId }, data: {
        companionId, assignedById: adminId, assignmentType: companionId ? OrderAssignmentType.DIRECT_COMPANION : OrderAssignmentType.PLATFORM_MATCH,
        status: OrderStatus.ASSIGNED, acceptanceDeadline: deadline, dispatchVersion: { increment: 1 }
      } });
      const detail = { previousMode: current.assignmentType, previousCompanionId: current.companionId,
        mode: body.mode, companionId, requestedVersion: body.dispatchVersion!, reason: body.reason.trim(), acceptanceDeadline: deadline?.toISOString() ?? null, dispatchVersion: updated.dispatchVersion };
      await tx.orderStatusLog.create({ data: { orderId, fromStatus: current.status, toStatus: OrderStatus.ASSIGNED, actorId: adminId, reason: JSON.stringify(detail) } });
      if (adminId) await tx.adminLog.create({ data: { actorId: adminId, targetUserId: companionId, action: "DISPATCH_ORDER", entityType: "ORDER", entityId: orderId, detail } });
      await enqueueJob(tx, "ORDER_DISPATCH", `order-dispatch:${orderId}:${updated.dispatchVersion}`, { orderId, dispatchVersion: updated.dispatchVersion });
      if (deadline) {
        const task = await enqueueJob(tx, "ORDER_ACCEPTANCE_TIMEOUT", `order-timeout:${orderId}:${updated.dispatchVersion}`, { orderId, dispatchVersion: updated.dispatchVersion });
        await tx.integrationJob.update({ where: { id: task.id }, data: { nextAttemptAt: deadline } });
      }
      return updated;
    });
    // Delivery remains retryable independently of this committed business change.
    const jobKey = `order-dispatch:${order.id}:${order.dispatchVersion}`;
    let notifications: Awaited<ReturnType<BotNotificationService["sendOrderAssignedNotifications"]>> = [];
    let notificationPending = false;
    try {
      await withDeliveryContext(jobKey, async () => {
        await this.botNotifications.refreshAcceptedOrderCards(order.id, order.dispatchVersion);
        notifications = await this.botNotifications.sendOrderAssignedNotifications(order.id);
      });
      notificationPending = notifications.some(result => result.status === "FAILED");
    } catch (error) {
      notificationPending = true;
      if (error instanceof NotificationOutcomeUnknown) await this.prisma.integrationJob.updateMany({
        where: { key: jobKey, status: "PENDING" }, data: { status: "UNKNOWN", lastError: error.name }
      });
    }
    return { order, notifications, notificationPending, autoStarted: false };
  }

  private async assertAvailableCompanion(tx: Prisma.TransactionClient, companionId: string, order: { id: string; game: GameCode }) {
    // Serialize different-order claims by the same person, as well as profile edits.
    await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${companionId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "companion_profiles" WHERE "userId" = ${companionId} FOR UPDATE`;
    const companion = await tx.user.findUnique({ where: { id: companionId }, include: { companionProfile: true } });
    const profile = companion?.companionProfile;
    if (companion?.status !== UserStatus.ACTIVE || profile?.status !== CompanionProfileStatus.LISTED) throw new BadRequestException("Companion is not listed, active or does not exist");
    if (profile.game !== order.game && !profile.games.includes(order.game)) throw new BadRequestException("Companion is not qualified for this game");
    // OFFLINE is presence, not an agreed appointment policy. Explicit BUSY is unavailable.
    if (profile.onlineStatus === "BUSY") throw new BadRequestException("Companion is busy");
    const conflict = await tx.order.findFirst({ where: { companionId, id: { not: order.id }, OR: [
      { status: { in: [OrderStatus.ACCEPTED, OrderStatus.IN_PROGRESS] } },
      { status: OrderStatus.DISPUTED, disputeFromStatus: { in: [OrderStatus.ACCEPTED, OrderStatus.IN_PROGRESS] } }
    ] }, select: { id: true } });
    if (conflict) throw new BadRequestException("Companion already has an active service order");
  }

  private async returnAssignment(tx: Prisma.TransactionClient, order: { id: string; status: OrderStatus; assignmentType: OrderAssignmentType; companionId: string | null; dispatchVersion: number }, reason: string, actorId?: string) {
    const selected = await tx.orderStatusLog.findFirst({ where: { orderId: order.id, reason: { startsWith: CUSTOMER_SELECTED_DISPATCH } }, select: { id: true } });
    const detail = { reason, previousMode: order.assignmentType, previousCompanionId: order.companionId,
      dispatchVersion: order.dispatchVersion, customerSelectionRetained: Boolean(selected) };
    await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.PAID,
      companionId: selected ? order.companionId : null, acceptanceDeadline: null, dispatchVersion: { increment: 1 } } });
    await tx.orderStatusLog.create({ data: { orderId: order.id, fromStatus: order.status, toStatus: OrderStatus.PAID, actorId, reason: JSON.stringify(detail) } });
    await enqueueJob(tx, "ORDER_CARD_REFRESH", `order-returned:${order.id}:${order.dispatchVersion}`, { orderId: order.id, staleBeforeVersion: order.dispatchVersion + 1 });
  }

  async declineOrder(orderId: string, companionId: string, reason: string, dispatchVersion?: number, kookContext?: { platformUserId: string; expiresAt: number }) {
    if (typeof reason !== "string" || !reason.trim()) throw new BadRequestException("Decline reason is required");
    return this.prisma.$transaction(async tx => {
      await lockOrder(tx, orderId);
      if (kookContext) await requireKookActor(tx, kookContext.platformUserId, companionId, UserRole.COMPANION, kookContext.expiresAt);
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException("Order not found");
      assertDispatchVersion(order.dispatchVersion, dispatchVersion);
      if (order.status !== OrderStatus.ASSIGNED || order.companionId !== companionId) throw new BadRequestException("Only the assigned companion can decline an unaccepted order");
      await this.returnAssignment(tx, order, `COMPANION_DECLINED: ${reason.trim()}`, companionId);
      return tx.order.findUniqueOrThrow({ where: { id: orderId } });
    });
  }

  async expireAssignment(orderId: string, dispatchVersion?: number) {
    requireDispatchVersion(dispatchVersion);
    return this.prisma.$transaction(async tx => {
      await lockOrder(tx, orderId);
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order || order.status !== OrderStatus.ASSIGNED || !order.acceptanceDeadline || order.acceptanceDeadline.getTime() > Date.now() || order.dispatchVersion !== dispatchVersion) return false;
      await this.returnAssignment(tx, order, "ACCEPTANCE_DEADLINE_EXPIRED");
      return true;
    });
  }

  async expireAssignments() {
    const due = await this.prisma.order.findMany({ where: { status: OrderStatus.ASSIGNED, acceptanceDeadline: { lte: new Date() } }, select: { id: true, dispatchVersion: true }, take: 100 });
    let expired = 0;
    for (const order of due) if (await this.expireAssignment(order.id, order.dispatchVersion)) expired++;
    return { expired };
  }

  async acceptOrderFromPlatform(platform: BotPlatform, orderId: string, platformUserId: string, platformMessageId?: string, dispatchVersion?: number, kookExpiresAt?: number) {
    const account = await this.prisma.userExternalAccount.findUnique({ where: { platform_externalUserId: { platform, externalUserId: platformUserId } } });
    if (!account) throw new BadRequestException("Platform user is not bound to a companion account");
    return this.acceptOrder(orderId, account.userId, { platform, platformUserId, platformMessageId, expiresAt: kookExpiresAt }, dispatchVersion);
  }

  async acceptOrderFromWeb(orderId: string, companionId: string, dispatchVersion?: number) {
    return this.acceptOrder(orderId, companionId, undefined, dispatchVersion);
  }

  private async acceptOrder(orderId: string, companionId: string, event?: { platform: BotPlatform; platformUserId: string; platformMessageId?: string; expiresAt?: number }, dispatchVersion?: number) {
    const result = await this.prisma.$transaction(async tx => {
      await lockOrder(tx, orderId);
      if (event?.platform === BotPlatform.KOOK) await requireKookActor(tx, event.platformUserId, companionId, UserRole.COMPANION, event.expiresAt, true);
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException("Order not found");
      assertDispatchVersion(order.dispatchVersion, dispatchVersion);
      if (order.companionId && order.companionId !== companionId) throw new BadRequestException("Order is assigned to another companion");
      if (event && order.status === OrderStatus.ACCEPTED && order.companionId === companionId) return order;
      if (order.status !== OrderStatus.ASSIGNED) throw new BadRequestException(`Order cannot be accepted from status ${order.status}`);
      if (order.acceptanceDeadline && order.acceptanceDeadline.getTime() <= Date.now()) {
        await this.returnAssignment(tx, order, "ACCEPTANCE_DEADLINE_EXPIRED");
        return null; // Commit the return before responding with a client error.
      }
      await this.assertAvailableCompanion(tx, companionId, order);
      if (order.acceptanceDeadline && order.acceptanceDeadline.getTime() <= Date.now()) {
        await this.returnAssignment(tx, order, "ACCEPTANCE_DEADLINE_EXPIRED");
        return null;
      }
      await tx.order.update({ where: { id: orderId }, data: { companionId, status: OrderStatus.ACCEPTED, acceptedAt: new Date() } });
      await enqueueJob(tx, "ORDER_CARD_REFRESH", `order-accepted:${orderId}`, { orderId });
      await tx.orderStatusLog.create({ data: { orderId, fromStatus: OrderStatus.ASSIGNED, toStatus: OrderStatus.ACCEPTED, actorId: companionId, reason: event ? `${event.platform}_ORDER_ACCEPT` : "WEB_COMPANION_ACCEPT" } });
      if (event) await tx.botEvent.create({ data: { platform: event.platform, type: BotEventType.ORDER_ACCEPT_CLICKED, actorId: companionId, orderId,
        platformUserId: event.platformUserId, platformMessageId: event.platformMessageId, payload: { platformUserId: event.platformUserId } } });
      return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { companion: { select: { id: true, email: true, displayName: true } } } });
    });
    if (!result) throw new BadRequestException("Acceptance deadline expired; order returned to dispatch desk");
    return result;
  }

  async startOrder(orderId: string, actorId: string, kookContext?: { platformUserId: string; dispatchVersion: number; expiresAt?: number }) {
    return this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, orderId);
      if (kookContext) await requireKookActor(tx, kookContext.platformUserId, actorId, UserRole.COMPANION, kookContext.expiresAt);
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, status: true, companionId: true, dispatchVersion: true }
      });

      if (!order) throw new NotFoundException("Order not found");
      if (kookContext) {
        assertDispatchVersion(order.dispatchVersion, kookContext.dispatchVersion);
        if (order.companionId !== actorId) throw new BadRequestException("只有本单陪玩可以操作");
        if (order.status === OrderStatus.IN_PROGRESS || order.status === OrderStatus.AWAITING_ACCEPTANCE) return tx.order.findUniqueOrThrow({ where: { id: orderId } });
      }
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

  async completeOrder(orderId: string, actorId: string, kookContext?: { platformUserId: string; dispatchVersion: number; expiresAt?: number }) {
    return this.prisma.$transaction(async tx => {
      await lockOrder(tx, orderId);
      if (kookContext) await requireKookActor(tx, kookContext.platformUserId, actorId, UserRole.COMPANION, kookContext.expiresAt);
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (kookContext) {
        assertDispatchVersion(order.dispatchVersion, kookContext.dispatchVersion);
        if (order.companionId !== actorId) throw new BadRequestException("只有本单陪玩可以操作");
        if (order.status === OrderStatus.AWAITING_ACCEPTANCE || order.status === OrderStatus.COMPLETED) return order;
      }
      const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
      if (order.companionId !== actorId && actor.role !== UserRole.ADMIN && actor.role !== UserRole.SUPER_ADMIN) throw new BadRequestException("Only assigned companion or admin can report completion");
      if (order.status !== OrderStatus.IN_PROGRESS || !order.companionId) throw new BadRequestException("Only an in-progress assigned order can report completion");
      if (!order.startedAt || Date.now() - order.startedAt.getTime() < order.hours.mul(3_600_000).toNumber()) throw new BadRequestException("Agreed service duration has not elapsed; use a documented dispute resolution for early termination");
      if (await tx.complaint.count({ where: { orderId, status: { in: ["OPEN", "IN_REVIEW"] } } })) throw new BadRequestException("An unresolved complaint blocks completion");
      const split = commissionSplit(order.totalAmount, order.commissionRateSnapshot);
      const changed = await tx.order.updateMany({ where: { id: orderId, status: OrderStatus.IN_PROGRESS }, data: { status: OrderStatus.AWAITING_ACCEPTANCE, reportedCompletedAt: new Date(), ...split } });
      if (changed.count !== 1) throw new BadRequestException("Order was already changed");
      const wallet = await tx.wallet.upsert({ where: { userId: order.companionId }, create: { userId: order.companionId, pendingIncome: split.companionIncome }, update: { pendingIncome: { increment: split.companionIncome } } });
      await tx.walletTransaction.create({ data: { walletId: wallet.id, userId: order.companionId, operatorId: actorId, businessKey: `order-pending:${orderId}`, type: WalletTransactionType.ORDER_PENDING_INCOME, direction: TransactionDirection.CREDIT, amount: split.companionIncome, balanceAfter: wallet.pendingIncome, referenceType: "ORDER", referenceId: orderId, note: "Reported completion; not withdrawable before acceptance" } });
      await tx.orderStatusLog.create({ data: { orderId, actorId, fromStatus: OrderStatus.IN_PROGRESS, toStatus: OrderStatus.AWAITING_ACCEPTANCE, reason: "COMPANION_REPORTED_COMPLETION" } });
      return tx.order.findUniqueOrThrow({ where: { id: orderId } });
    });
  }

  async acceptCompletion(orderId: string, actorId: string, note?: string, refundInput?: string): Promise<Order>;
  async acceptCompletion(orderId: string, actorId: string, note: string, refundInput: undefined, automatic: true): Promise<Order | null>;
  async acceptCompletion(orderId: string, actorId: string, note?: string, refundInput?: string, automatic = false) {
    const result = await this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, orderId);
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          status: true,
          customerId: true,
          companionId: true,
          totalAmount: true,
          companionIncome: true,
          disputeFromStatus: true,
          acceptedAt: true,
          startedAt: true,
          completedAt: true,
          reportedCompletedAt: true,
          commissionRateSnapshot: true,
          companion: {
            select: {
              companionProfile: { select: { commissionRate: true } }
            }
          }
        }
      });

      if (!order) throw new NotFoundException("Order not found");
      if (automatic) {
        const dueAt = acceptanceDueAt(order.reportedCompletedAt, await this.autoAcceptanceHours(tx));
        if (refundInput !== undefined || order.status !== OrderStatus.AWAITING_ACCEPTANCE || !dueAt || dueAt.getTime() > Date.now()) return null;
        if (await tx.complaint.count({ where: { orderId, status: { notIn: ["RESOLVED", "REJECTED"] } } })) return null;
      }
      const disputed = refundInput !== undefined;
      const heldStatuses: OrderStatus[] = [OrderStatus.PAID, OrderStatus.ASSIGNED, OrderStatus.ACCEPTED, OrderStatus.IN_PROGRESS, OrderStatus.AWAITING_ACCEPTANCE];
      if (disputed ? order.status !== OrderStatus.DISPUTED || !order.disputeFromStatus || !heldStatuses.includes(order.disputeFromStatus) : order.status !== OrderStatus.AWAITING_ACCEPTANCE) throw new BadRequestException("Order is not awaiting acceptance or an eligible dispute resolution");
      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, status: true } });
      const admin = actor?.role === UserRole.ADMIN || actor?.role === UserRole.SUPER_ADMIN;
      if (disputed ? !admin : actorId !== order.customerId && !admin) throw new BadRequestException("Only the order customer or an authorized admin can accept completion");
      if (admin && !note?.trim()) throw new BadRequestException("Admin acceptance or dispute resolution requires documented evidence");
      if (!disputed && await tx.complaint.count({ where: { orderId, status: { in: ["OPEN", "IN_REVIEW"] } } })) throw new BadRequestException("Unresolved complaints block acceptance");
      const refundAmount = disputed ? fixedDecimal(refundInput!, "refundAmount", { zero: true }) : new Prisma.Decimal(0);
      if (refundAmount.gt(order.totalAmount)) throw new BadRequestException("Refund exceeds the paid order amount");
      const netAmount = order.totalAmount.sub(refundAmount);

      if (!order.companionId) {
        const unservedStatuses: OrderStatus[] = [OrderStatus.PAID, OrderStatus.ASSIGNED];
        if (!disputed || actor?.status !== UserStatus.ACTIVE || !order.disputeFromStatus ||
            !unservedStatuses.includes(order.disputeFromStatus) || order.acceptedAt || order.startedAt ||
            order.completedAt || !order.companionIncome.eq(0) || !netAmount.eq(0)) {
          throw new BadRequestException("An unassigned dispute requires an active admin, no service history and an explicit full refund");
        }
        const refunded = await tx.order.updateMany({
          where: { id: orderId, status: OrderStatus.DISPUTED, companionId: null },
          data: { status: OrderStatus.REFUNDED, verifiedAt: new Date(), refundAmount, platformFee: 0, companionIncome: 0, acceptanceDeadline: null }
        });
        if (refunded.count !== 1) throw new BadRequestException("Order was already settled or changed");
        const released = await tx.wallet.updateMany({
          where: { userId: order.customerId, frozenBalance: { gte: order.totalAmount } },
          data: { frozenBalance: { decrement: order.totalAmount }, availableBalance: { increment: refundAmount } }
        });
        if (released.count !== 1) throw new BadRequestException("Customer frozen balance is insufficient for settlement");
        const customerWallet = await tx.wallet.findUniqueOrThrow({ where: { userId: order.customerId } });
        await tx.walletTransaction.create({ data: {
          walletId: customerWallet.id, userId: order.customerId, operatorId: actorId,
          businessKey: `order-dispute-refund:${orderId}`, type: WalletTransactionType.ORDER_REFUND,
          direction: TransactionDirection.CREDIT, amount: refundAmount,
          balanceAfter: customerWallet.availableBalance, referenceType: "ORDER", referenceId: orderId, note: note!.trim()
        } });
        await tx.complaint.updateMany({
          where: { orderId, status: { in: ["OPEN", "IN_REVIEW"] } },
          data: { status: "RESOLVED", resolution: note!.trim(), resolvedById: actorId }
        });
        await tx.orderStatusLog.create({ data: {
          orderId, fromStatus: OrderStatus.DISPUTED, toStatus: OrderStatus.REFUNDED, actorId,
          reason: `DISPUTE_RESOLUTION_UNASSIGNED_FULL_REFUND: ${note!.trim()}`
        } });
        await tx.adminLog.create({ data: {
          actorId, targetUserId: order.customerId, action: "REFUND_UNASSIGNED_DISPUTE", entityType: "ORDER", entityId: orderId,
          detail: { refundAmount: refundAmount.toString(), disputeFromStatus: order.disputeFromStatus, note: note!.trim() }
        } });
        return tx.order.findUniqueOrThrow({ where: { id: orderId } });
      }


      const platformRate = order.commissionRateSnapshot ?? order.companion?.companionProfile?.commissionRate ?? this.defaultPlatformCommissionRate();
      const { platformFee, companionIncome } = commissionSplit(netAmount, platformRate);
      const finalStatus = netAmount.eq(0) ? OrderStatus.REFUNDED : OrderStatus.COMPLETED;

      const updated = await tx.order.updateMany({
        where: { id: orderId, status: order.status },
        data: {
          status: finalStatus,
          completedAt: new Date(),
          verifiedAt: new Date(),
          refundAmount,
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
          frozenBalance: { decrement: order.totalAmount },
          availableBalance: { increment: refundAmount }
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
          amount: netAmount,
          businessKey: `order-settlement-customer:${orderId}`,
          balanceAfter: customerWalletAfter.frozenBalance,
          referenceType: "ORDER",
          referenceId: orderId,
          note: "Customer frozen balance settled"
        }
      });

      if (order.companionIncome.eq(0)) await tx.wallet.upsert({ where: { userId: order.companionId }, create: { userId: order.companionId }, update: {} });
      const released = await tx.wallet.updateMany({ where: { userId: order.companionId, pendingIncome: { gte: order.companionIncome } }, data: { pendingIncome: { decrement: order.companionIncome }, availableIncome: { increment: companionIncome } } });
      if (released.count !== 1) throw new BadRequestException("Pending income is insufficient for acceptance");
      const companionWallet = await tx.wallet.findUniqueOrThrow({ where: { userId: order.companionId } });
      await tx.walletTransaction.create({ data: { walletId: companionWallet.id, userId: order.companionId, operatorId: actorId, businessKey: `order-pending-release:${orderId}`, type: WalletTransactionType.ORDER_PENDING_RELEASE, direction: TransactionDirection.DEBIT, amount: order.companionIncome, balanceAfter: companionWallet.pendingIncome, referenceType: "ORDER", referenceId: orderId, note: "Release pending income after acceptance or adjudication" } });
      if (refundAmount.gt(0)) await tx.walletTransaction.create({ data: { walletId: customerWalletAfter.id, userId: order.customerId, operatorId: actorId, businessKey: `order-dispute-refund:${orderId}`, type: WalletTransactionType.ORDER_REFUND, direction: TransactionDirection.CREDIT, amount: refundAmount, balanceAfter: customerWalletAfter.availableBalance, referenceType: "ORDER", referenceId: orderId, note: note?.trim() } });
      if (disputed) await tx.complaint.updateMany({ where: { orderId, status: { in: ["OPEN", "IN_REVIEW"] } }, data: { status: "RESOLVED", resolution: note?.trim(), resolvedById: actorId } });

      await tx.walletTransaction.create({
        data: {
          walletId: companionWallet.id,
          userId: order.companionId,
          operatorId: actorId,
          type: WalletTransactionType.ORDER_SETTLEMENT,
          direction: TransactionDirection.CREDIT,
          businessKey: `order-settlement-companion:${orderId}`,
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
        orderTotalAmount: netAmount,
        platformFee
      });
      if (netAmount.gt(0)) await this.settleReferralReward(tx, order.customerId, orderId, actorId);

      await tx.orderStatusLog.create({
        data: {
          orderId,
          fromStatus: order.status,
          toStatus: finalStatus,
          actorId,
          reason: automatic ? "系统超时自动验收" : `${disputed ? "DISPUTE_RESOLUTION" : "CUSTOMER_OR_ADMIN_ACCEPTANCE"}: ${note?.trim() || "Customer confirmed"}`
        }
      });

      return tx.order.findUniqueOrThrow({ where: { id: orderId } });
    });

    if (result) await this.botNotifications.syncCustomerMembershipLevels(result.customerId).catch(() => undefined);

    return result;
  }

  async cancelOrderByAdmin(adminId: string, orderId: string, body: { note?: string } = {}) {
    const discountConfig = await this.resolveMultiCompanionDiscountConfig();
    const cancellableStatuses: OrderStatus[] = [OrderStatus.PAID, OrderStatus.ASSIGNED, OrderStatus.ACCEPTED];
    const unsafeGroupStatuses: OrderStatus[] = [OrderStatus.IN_PROGRESS, OrderStatus.AWAITING_ACCEPTANCE, OrderStatus.COMPLETED, OrderStatus.DISPUTED];

    return this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, orderId);
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

      const claimed = await tx.order.updateMany({
        where: { id: orderId, status: order.status },
        data: { status: OrderStatus.REFUNDED }
      });
      if (claimed.count !== 1) throw new BadRequestException("Order was already changed");

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
          const originalAmount = item.originalAmount ?? money(originalUnitPrice.mul(item.hours), true);
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
            businessKey: `order-cancel:${order.id}`,
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
            businessKey: `order-cancel:${order.id}`,
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
          refundAmount: walletMove.gt(0) ? walletMove : new Prisma.Decimal(0),
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

      // The worker can only see this notification after cancellation commits.
      await enqueueJob(tx, "ORDER_CARD_REFRESH", `order-cancelled:${order.id}:${order.dispatchVersion}`, { orderId: order.id });

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
    options: { rankTierKey?: string; customUnitPrice?: string } = {},
    db: Prisma.TransactionClient = this.prisma
  ) {
    const companion = companionId
      ? await db.companionProfile.findFirst({
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
    const rankPricing = await this.resolveGameRankPrice(game, options.rankTierKey, db);
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
        unitPrice: await this.resolvePlatformMatchUnitPrice(sourcePlatform, priceTier, db),
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

  private async resolveGameRankPrice(game: GameCode, rawTierKey?: string, db: Prisma.TransactionClient = this.prisma) {
    const tierKey = this.normalizeRankTierKey(rawTierKey);
    if (!tierKey) return null;
    const rankPrice = await db.gameRankPrice.findUnique({
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

  private async resolvePlatformMatchUnitPrice(sourcePlatform: OrderSourcePlatform, priceTier: ServicePriceTier, db: Prisma.TransactionClient = this.prisma) {
    for (const key of this.platformMatchPriceKeys(sourcePlatform, priceTier)) {
      const configured = await this.readPositivePlatformPrice(key, db);
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

  private async readPositivePlatformPrice(key: string, db: Prisma.TransactionClient = this.prisma) {
    const configured = await this.readPlatformSettingValue(key, db);
    return configured ? this.positiveDecimal(configured, key) : null;
  }

  private async readPlatformSettingValue(key: string, db: Prisma.TransactionClient = this.prisma) {
    const setting = await db.platformSetting.findUnique({
      where: { key },
      select: { value: true }
    });
    return setting?.value ?? process.env[key];
  }

  private async resolveMultiCompanionDiscountConfig(db: Prisma.TransactionClient = this.prisma) {
    const enabledRaw = (await this.readPlatformSettingValue("MULTI_COMPANION_DISCOUNT_ENABLED", db)) ?? "1";
    const minCountRaw = (await this.readPlatformSettingValue("MULTI_COMPANION_DISCOUNT_MIN_COUNT", db)) ?? "2";
    const discountRaw = (await this.readPlatformSettingValue("MULTI_COMPANION_DISCOUNT_AMOUNT", db)) ?? "10";
    const floorRaw = (await this.readPlatformSettingValue("MULTI_COMPANION_DISCOUNT_FLOOR_PRICE", db)) ?? "68";
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
    return fixedDecimal(value, fieldName, { max: /hours/i.test(fieldName) ? "9999.99" : undefined });
  }

  private nonNegativeDecimal(value: string, fieldName: string) {
    return fixedDecimal(value, fieldName, { zero: true });
  }

  private serializeOrder(order: {
    isTest?: boolean;
    storeKey?: string;
    id: string;
    orderNo: string;
    customerId: string;
    companionId: string | null;
    assignedById?: string | null;
    dispatchVersion?: number;
    acceptanceDeadline?: Date | null;
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
  }, includeInternal = true) {
    return {
      id: order.id,
      orderNo: order.orderNo,
      isTest: order.isTest === true,
      storeKey: order.storeKey,
      customerId: order.customerId,
      companionId: order.companionId,
      assignmentType: order.assignmentType,
      dispatchVersion: order.dispatchVersion ?? 0,
      acceptanceDeadline: order.acceptanceDeadline ?? null,
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
      notes: includeInternal ? order.notes : null,
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
      statusLogs: includeInternal ? order.statusLogs ?? [] : []
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
