import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  BotEventStatus,
  BotEventType,
  CompanionProfileStatus,
  GameCode,
  OrderDraftActorType,
  OrderDraftCandidateStatus,
  OrderDraftEventType,
  OrderDraftStatus,
  OrderSourcePlatform,
  Prisma,
  ServicePriceTier,
  UserRole,
  UserStatus
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { BotNotificationService } from "../bot/bot-notification.service";
import { OrdersService } from "./orders.service";
import { createHash } from "node:crypto";
import { enqueueJob } from "../bot/integration-jobs.service";
import { fixedDecimal } from "../financial-values";
import { publicServiceLabel } from "./public-dispatch";
import { requireKookActor } from "../kook/kook-flow-identity";

type CreateDraftBody = {
  customerId?: string;
  sourcePlatform?: OrderSourcePlatform;
  customerPlatformUserId?: string;
  customerDisplayName?: string;
  sourceGuildId?: string;
  sourceChannelId?: string;
  sourceMessageId?: string;
  voiceRoomId?: string;
  game?: GameCode;
  mode: string;
  hours?: string;
  priceTier?: ServicePriceTier;
  budgetAmount?: string;
  note?: string;
};

type ParsedDispatchDemand = {
  game: GameCode;
  mode: string;
  hours?: string;
  priceTier?: ServicePriceTier;
  budgetAmount?: string;
  note: string;
  preferences: string[];
};

type CreateDraftFromCompanionBody = {
  customerId: string;
  game?: GameCode;
  mode: string;
  hours?: string;
  budgetAmount?: string;
  note?: string;
};

@Injectable()
export class OrderDraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly botNotifications: BotNotificationService
  ) {}

  async listAdminDrafts() {
    const drafts = await this.prisma.orderDraft.findMany({
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: {
        customer: { select: { id: true, email: true, displayName: true } },
        serviceAdmin: { select: { id: true, email: true, displayName: true } },
        selectedCompanion: { select: { id: true, email: true, displayName: true } },
        convertedOrder: { select: { id: true, orderNo: true, status: true, totalAmount: true } },
        convertedOrderGroup: {
          select: {
            id: true,
            groupNo: true,
            companionCount: true,
            originalAmount: true,
            discountAmount: true,
            totalAmount: true,
            orders: { select: { id: true, orderNo: true, status: true, totalAmount: true } }
          }
        },
        candidates: {
          orderBy: { createdAt: "asc" },
          include: {
            companion: {
              select: {
                id: true,
                email: true,
                displayName: true,
                companionProfile: {
                  select: {
                    nickname: true,
                    avatarUrl: true,
                    pricePerHour: true,
                    kookPricePerHour: true,
                    discordPricePerHour: true,
                    entertainmentPricePerHour: true,
                    rankedPricePerHour: true,
                    highRankedPricePerHour: true,
                    onlineStatus: true,
                    status: true
                  }
                }
              }
            },
            recommendedBy: { select: { id: true, email: true, displayName: true } }
          }
        },
        events: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { actor: { select: { id: true, email: true, displayName: true } } }
        }
      }
    });

    const draftIds = new Set(drafts.map((draft) => draft.id));
    const notificationEvents = await this.prisma.botEvent.findMany({
      where: { type: BotEventType.ADMIN_ALERT_SENT },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        platform: true,
        status: true,
        platformChannelId: true,
        platformMessageId: true,
        error: true,
        payload: true,
        createdAt: true
      }
    });
    const notificationsByDraftId = new Map<string, typeof notificationEvents>();
    for (const event of notificationEvents) {
      const draftId = this.getPayloadDraftId(event.payload);
      if (!draftId || !draftIds.has(draftId)) continue;
      const current = notificationsByDraftId.get(draftId) ?? [];
      current.push(event);
      notificationsByDraftId.set(draftId, current);
    }

    return drafts.map((draft) => this.serializeDraft(draft, notificationsByDraftId.get(draft.id) ?? []));
  }

  async createDraft(adminId: string, body: CreateDraftBody) {
    if (!body.mode?.trim()) throw new BadRequestException("mode is required");

    const hours = body.hours ? this.positiveDecimal(body.hours, "hours") : undefined;
    const priceTier = this.normalizePriceTier(body.priceTier, body.mode);
    const budgetAmount = body.budgetAmount ? this.positiveDecimal(body.budgetAmount, "budgetAmount") : undefined;
    const sourcePlatform = body.sourcePlatform ?? OrderSourcePlatform.WEB;
    const sourceBusinessKey = body.sourceMessageId ? createHash("sha256").update(JSON.stringify([sourcePlatform, body.sourceGuildId, body.sourceChannelId, body.sourceMessageId])).digest("hex") : null;

    return this.prisma.$transaction(async (tx) => {
      if (sourceBusinessKey) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sourceBusinessKey}, 0))::text`;
        const existing = await tx.orderDraft.findUnique({ where: { sourceBusinessKey } });
        if (existing) return { ...existing, newlyCreated: false };
      }
      if (body.customerId) {
        await this.assertActiveCustomer(tx, body.customerId);
      }

      const draft = await tx.orderDraft.create({
        data: {
          draftNo: this.generateDraftNo(),
          sourceBusinessKey,
          customerId: body.customerId,
          serviceAdminId: adminId,
          sourcePlatform,
          customerPlatformUserId: body.customerPlatformUserId,
          customerDisplayName: body.customerDisplayName,
          sourceGuildId: body.sourceGuildId,
          sourceChannelId: body.sourceChannelId,
          sourceMessageId: body.sourceMessageId,
          voiceRoomId: body.voiceRoomId,
          game: body.game ?? GameCode.DELTA_FORCE,
          mode: body.mode.trim(),
          hours,
          priceTier,
          budgetAmount,
          note: body.note
        }
      });

      await this.writeDraftEvent(tx, {
        draftId: draft.id,
        actorUserId: adminId,
        actorType: OrderDraftActorType.ADMIN,
        platform: sourcePlatform,
        platformUserId: body.customerPlatformUserId,
        eventType: OrderDraftEventType.DRAFT_CREATED,
        content: body.note,
        metadata: { customerId: body.customerId, mode: body.mode, hours: body.hours, priceTier, budgetAmount: body.budgetAmount }
      });

      await this.writeAdminLog(tx, adminId, body.customerId, "CREATE_ORDER_DRAFT", draft.id, {
        draftNo: draft.draftNo,
        sourcePlatform,
        mode: draft.mode
      });

      return { ...draft, newlyCreated: true };
    });
  }

  // Customer-owned KOOK demand entry. serviceAdminId routes exceptions; it
  // does not impersonate the administrator or grant the customer admin rights.
  async createKookCustomerDemand(tx: Prisma.TransactionClient, customerId: string, platformUserId: string,
    body: { requestId: string; mode: string; hours: string }) {
    const customer = await requireKookActor(tx, platformUserId, customerId, UserRole.CUSTOMER);
    const hours = this.positiveDecimal(body.hours, "hours");
    if (hours.gt(this.positiveDecimal(process.env.ORDER_MAX_HOURS ?? "8", "ORDER_MAX_HOURS"))) throw new BadRequestException("服务时长超出当前上限");
    if (!body.mode.trim()) throw new BadRequestException("请先选择服务模式");
    const sourceBusinessKey = createHash("sha256").update(JSON.stringify(["KOOK_CUSTOMER_DEMAND", customerId, platformUserId, body.requestId])).digest("hex");
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sourceBusinessKey}, 0))::text`;
    const existing = await tx.orderDraft.findUnique({ where: { sourceBusinessKey } });
    if (existing) {
      if (existing.customerId !== customerId || existing.customerPlatformUserId !== platformUserId || existing.mode !== body.mode || !existing.hours?.eq(hours)) throw new BadRequestException("原需求与本次内容不一致，请刷新原需求");
      return existing;
    }
    const admin = await tx.user.findFirst({ where: { status: UserStatus.ACTIVE, role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] } }, orderBy: [{ role: "desc" }, { createdAt: "asc" }], select: { id: true } });
    if (!admin) throw new BadRequestException("当前没有可用管理员接收需求，尚未发布或扣款，请联系人工客服。");
    const draft = await tx.orderDraft.create({ data: {
      sourceBusinessKey, draftNo: this.generateDraftNo(), customerId, customerPlatformUserId: platformUserId,
      customerDisplayName: customer.displayName, serviceAdminId: admin.id, sourcePlatform: OrderSourcePlatform.KOOK,
      sourceGuildId: process.env.KOOK_GUILD_ID, sourceChannelId: process.env.KOOK_AI_DISPATCH_CHANNEL_ID ?? process.env.KOOK_DISPATCH_CHANNEL_ID,
      sourceMessageId: body.requestId, game: GameCode.DELTA_FORCE, mode: body.mode, hours,
      priceTier: this.normalizePriceTier(undefined, body.mode), status: OrderDraftStatus.OPEN
    } });
    await this.writeDraftEvent(tx, { draftId: draft.id, actorUserId: customerId, actorType: OrderDraftActorType.CUSTOMER,
      platform: OrderSourcePlatform.KOOK, platformUserId, eventType: OrderDraftEventType.CUSTOMER_REQUESTED_ORDER,
      content: "客户提交需求，由客服安排；尚未选人、下单或扣款", metadata: { mode: draft.mode, hours: hours.toString(), requestId: body.requestId } });
    return draft;
  }

  private async ownedKookDemand(tx: Prisma.TransactionClient, customerId: string, platformUserId: string, draftId: string) {
    await requireKookActor(tx, platformUserId, customerId, UserRole.CUSTOMER);
    await tx.$queryRaw`SELECT "id" FROM "order_drafts" WHERE "id" = ${draftId} FOR UPDATE`;
    const draft = await tx.orderDraft.findUnique({ where: { id: draftId } });
    if (!draft || draft.customerId !== customerId || draft.customerPlatformUserId !== platformUserId || draft.sourcePlatform !== OrderSourcePlatform.KOOK) {
      throw new BadRequestException("没有找到属于当前账号的需求，请核对本人绑定。");
    }
    return draft;
  }

  private assertKookDemandFresh(draft: Prisma.OrderDraftGetPayload<{}>) {
    const configured = Number(process.env.ORDER_DRAFT_STALE_MINUTES ?? "60");
    const minutes = Number.isFinite(configured) ? Math.max(10, configured) : 60;
    if (draft.updatedAt.getTime() + minutes * 60_000 <= Date.now()) throw new BadRequestException("需求已超出原报名有效期，请管理员核对原需求；本次没有成单或扣款。");
  }

  private kookDemandVersion(draft: Prisma.OrderDraftGetPayload<{}>) {
    return createHash("sha256").update(JSON.stringify([draft.id, draft.updatedAt.toISOString(), draft.status, draft.selectedCompanionId,
      draft.mode, draft.hours?.toString(), draft.priceTier, draft.rankTierKey, draft.customerId, draft.customerPlatformUserId])).digest("hex");
  }

  async kookDemandSnapshot(tx: Prisma.TransactionClient, customerId: string, platformUserId: string, draftId: string, page = 0) {
    const draft = await this.ownedKookDemand(tx, customerId, platformUserId, draftId);
    const order = await tx.order.findUnique({ where: { sourceDraftId: draftId } });
    if (order) {
      if (order.customerId !== customerId) throw new BadRequestException("需求回执需要管理员核对，请不要重新下单。");
      return { draft, version: this.kookDemandVersion(draft), order, candidates: [] };
    }
    if (![OrderDraftStatus.OPEN, OrderDraftStatus.TRIALING, OrderDraftStatus.SELECTED].includes(draft.status as "OPEN" | "TRIALING" | "SELECTED")) throw new BadRequestException("该需求已关闭或已进入人工处理，请不要重新下单。");
    if (draft.game !== GameCode.DELTA_FORCE || !draft.hours || draft.rankTierKey || draft.priceTier !== this.normalizePriceTier(undefined, draft.mode)) throw new BadRequestException("该需求含定制内容，需要管理员明确报价后处理。");
    const candidates = await tx.orderDraftCandidate.findMany({ where: { draftId, status: { not: OrderDraftCandidateStatus.REJECTED },
      companion: { status: UserStatus.ACTIVE, role: UserRole.COMPANION, companionProfile: { is: { status: CompanionProfileStatus.LISTED, OR: [{ game: draft.game }, { games: { has: draft.game } }] } } }
    }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: Math.max(0, page) * 3, take: 3,
      select: { id: true, companionId: true, companion: { select: { companionProfile: { select: { nickname: true } }, displayName: true } } } });
    return { draft, version: this.kookDemandVersion(draft), order: null,
      candidates: candidates.map(candidate => ({ id: candidate.id, companionId: candidate.companionId, name: candidate.companion.companionProfile?.nickname ?? candidate.companion.displayName })) };
  }

  async selectKookDemandCandidate(tx: Prisma.TransactionClient, customerId: string, platformUserId: string,
    body: { draftId: string; candidateId: string; expectedVersion: string }) {
    const draft = await this.ownedKookDemand(tx, customerId, platformUserId, body.draftId);
    this.assertKookDemandFresh(draft);
    if (this.kookDemandVersion(draft) !== body.expectedVersion || ![OrderDraftStatus.OPEN, OrderDraftStatus.TRIALING].includes(draft.status as "OPEN" | "TRIALING")) throw new BadRequestException("需求或选择已更新，请刷新需求后再选人。");
    await tx.$queryRaw`SELECT "id" FROM "order_draft_candidates" WHERE "id" = ${body.candidateId} FOR UPDATE`;
    const candidate = await tx.orderDraftCandidate.findUnique({ where: { id: body.candidateId } });
    if (!candidate || candidate.draftId !== draft.id || candidate.status === OrderDraftCandidateStatus.REJECTED) throw new BadRequestException("这位报名者已失效，请刷新名单。");
    await this.assertListedCompanion(tx, candidate.companionId, draft.game);
    await tx.orderDraftCandidate.updateMany({ where: { draftId: draft.id, status: OrderDraftCandidateStatus.SELECTED }, data: { status: OrderDraftCandidateStatus.RECOMMENDED } });
    await tx.orderDraftCandidate.update({ where: { id: candidate.id }, data: { status: OrderDraftCandidateStatus.SELECTED } });
    const selected = await tx.orderDraft.update({ where: { id: draft.id }, data: { status: OrderDraftStatus.SELECTED, selectedCompanionId: candidate.companionId } });
    await this.writeDraftEvent(tx, { draftId: draft.id, actorUserId: customerId, actorType: OrderDraftActorType.CUSTOMER,
      platform: OrderSourcePlatform.KOOK, platformUserId, eventType: OrderDraftEventType.CUSTOMER_SELECTED_COMPANION,
      content: "客户本人选TA；尚未确认报价或扣款", metadata: { candidateId: candidate.id, companionId: candidate.companionId } });
    return selected;
  }

  async quoteKookDemand(tx: Prisma.TransactionClient, customerId: string, platformUserId: string, draftId: string, expectedCompanionId: string) {
    const draft = await this.ownedKookDemand(tx, customerId, platformUserId, draftId);
    this.assertKookDemandFresh(draft);
    if (draft.status !== OrderDraftStatus.SELECTED || draft.selectedCompanionId !== expectedCompanionId || !draft.hours || draft.game !== GameCode.DELTA_FORCE || draft.rankTierKey || draft.priceTier !== this.normalizePriceTier(undefined, draft.mode)) throw new BadRequestException("需求或所选陪玩已变化，请先刷新需求。");
    const candidate = await tx.orderDraftCandidate.findUnique({ where: { draftId_companionId: { draftId, companionId: expectedCompanionId } }, include: { companion: { select: { displayName: true, companionProfile: { select: { nickname: true } } } } } });
    if (candidate?.status !== OrderDraftCandidateStatus.SELECTED) throw new BadRequestException("所选报名者已变化，请刷新需求。");
    const quote = await this.orders.previewKookCustomerOrder(tx, customerId, { mode: draft.mode, hours: draft.hours.toString(), companionId: expectedCompanionId });
    return { ...quote, draftId, draftNo: draft.draftNo, draftVersion: this.kookDemandVersion(draft), companionName: candidate.companion.companionProfile?.nickname ?? candidate.companion.displayName };
  }

  async reopenKookDemand(tx: Prisma.TransactionClient, customerId: string, platformUserId: string, draftId: string, expectedVersion: string) {
    const draft = await this.ownedKookDemand(tx, customerId, platformUserId, draftId);
    this.assertKookDemandFresh(draft);
    if (draft.status !== OrderDraftStatus.SELECTED || this.kookDemandVersion(draft) !== expectedVersion || await tx.order.findUnique({ where: { sourceDraftId: draftId } })) throw new BadRequestException("需求已经更新或成单，请刷新原记录。");
    await tx.orderDraftCandidate.updateMany({ where: { draftId, status: OrderDraftCandidateStatus.SELECTED }, data: { status: OrderDraftCandidateStatus.RECOMMENDED } });
    await tx.orderDraft.update({ where: { id: draftId }, data: { status: OrderDraftStatus.TRIALING, selectedCompanionId: null } });
    await this.writeDraftEvent(tx, { draftId, actorUserId: customerId, actorType: OrderDraftActorType.CUSTOMER, platform: OrderSourcePlatform.KOOK,
      platformUserId, eventType: OrderDraftEventType.CUSTOMER_CHANGED_COMPANION, content: "客户明确要求重新选人；未扣款", metadata: { previousCompanionId: draft.selectedCompanionId } });
  }

  async confirmKookDemand(tx: Prisma.TransactionClient, customerId: string, platformUserId: string,
    body: { draftId: string; companionId: string; expectedVersion: string; expectedTotalAmount: string; expiresAt?: number }) {
    const draft = await this.ownedKookDemand(tx, customerId, platformUserId, body.draftId);
    const existing = await tx.order.findUnique({ where: { sourceDraftId: draft.id } });
    if (existing) {
      if (existing.customerId !== customerId) throw new BadRequestException("原订单归属需要管理员核对，请勿重新付款。");
      return existing;
    }
    if (this.kookDemandVersion(draft) !== body.expectedVersion) throw new BadRequestException("需求或报价上下文已变化，请刷新报价后重新确认。");
    const quote = await this.quoteKookDemand(tx, customerId, platformUserId, draft.id, body.companionId);
    if (!fixedDecimal(quote.totalAmount, "totalAmount").eq(fixedDecimal(body.expectedTotalAmount, "expectedTotalAmount"))) throw new BadRequestException("价格已变化，请刷新报价后重新确认。");
    const order = await this.orders.createConfirmedKookDraftOrder(tx, customerId, platformUserId, {
      draftId: draft.id, companionId: body.companionId, expectedTotalAmount: body.expectedTotalAmount, mode: quote.mode, hours: quote.hours, expiresAt: body.expiresAt
    });
    await tx.orderDraft.update({ where: { id: draft.id }, data: { status: OrderDraftStatus.CONVERTED } });
    await this.writeDraftEvent(tx, { draftId: draft.id, actorUserId: customerId, actorType: OrderDraftActorType.CUSTOMER,
      platform: OrderSourcePlatform.KOOK, platformUserId, eventType: OrderDraftEventType.CUSTOMER_CONFIRMED,
      content: "客户明确确认本次报价", metadata: { totalAmount: quote.totalAmount, companionId: body.companionId } });
    await this.writeDraftEvent(tx, { draftId: draft.id, actorUserId: customerId, actorType: OrderDraftActorType.CUSTOMER,
      platform: OrderSourcePlatform.KOOK, platformUserId, eventType: OrderDraftEventType.DRAFT_CONVERTED_TO_ORDER,
      content: "客户本人确认成单；通知尚待送达", metadata: { orderId: order.id, orderNo: order.orderNo } });
    return order;
  }

  async createDraftFromDemand(adminId: string, body: {
    customerId?: string;
    sourcePlatform?: OrderSourcePlatform;
    customerPlatformUserId?: string;
    customerDisplayName?: string;
    sourceGuildId?: string;
    sourceChannelId?: string;
    sourceMessageId?: string;
    voiceRoomId?: string;
    demandText: string;
  }) {
    const parsed = this.parseDemandText(body.demandText);
    const draft = await this.createDraft(adminId, {
      customerId: body.customerId,
      sourcePlatform: body.sourcePlatform,
      customerPlatformUserId: body.customerPlatformUserId,
      customerDisplayName: body.customerDisplayName,
      sourceGuildId: body.sourceGuildId,
      sourceChannelId: body.sourceChannelId,
      sourceMessageId: body.sourceMessageId,
      voiceRoomId: body.voiceRoomId,
      game: parsed.game,
      mode: parsed.mode,
      hours: parsed.hours,
      priceTier: parsed.priceTier,
      budgetAmount: parsed.budgetAmount,
      note: parsed.note
    });

    if (!draft.newlyCreated) return { draft, parsed, notifications: [] };

    await this.prisma.orderDraftEvent.create({
      data: {
        draftId: draft.id,
        actorUserId: adminId,
        actorType: OrderDraftActorType.BOT,
        platform: body.sourcePlatform ?? OrderSourcePlatform.WEB,
        platformUserId: body.customerPlatformUserId,
        eventType: OrderDraftEventType.NOTE_ADDED,
        content: "AI 派单助手已解析客户需求",
        metadata: parsed as unknown as Prisma.InputJsonValue
      }
    });

    return { draft, parsed, notifications: [], notificationStatus: "SERVICE_DESK" };
  }

  async publishFallback(adminId: string, draftId: string) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "order_drafts" WHERE "id" = ${draftId} FOR UPDATE`;
      const admin = await tx.user.findFirst({ where: { id: adminId, status: UserStatus.ACTIVE, role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] } } });
      if (!admin) throw new BadRequestException("Active admin required");
      const draft = await tx.orderDraft.findUnique({ where: { id: draftId } });
      if (!draft || !["OPEN", "TRIALING"].includes(draft.status) || draft.selectedCompanionId) throw new BadRequestException("Draft is not available for fallback recruitment");
      await enqueueJob(tx, "DRAFT_DISPATCH", `draft-dispatch:${draft.id}`, { draftId: draft.id });
      await this.writeAdminLog(tx, adminId, draft.customerId ?? undefined, "PUBLISH_DRAFT_FALLBACK", draft.id, { reason: "客服无合适人选，手动启用备用招募" });
      return { queued: true };
    });
  }

  async createDraftFromCompanion(companionId: string, body: CreateDraftFromCompanionBody) {
    if (!body.customerId) throw new BadRequestException("customerId is required");
    if (!body.mode?.trim()) throw new BadRequestException("mode is required");

    const companion = await this.prisma.user.findFirst({
      where: {
        id: companionId,
        status: UserStatus.ACTIVE,
        companionProfile: { is: { status: CompanionProfileStatus.LISTED } }
      },
      include: { companionProfile: true }
    });
    if (!companion?.companionProfile) throw new BadRequestException("Companion is not listed, active or does not exist");

    const game = body.game ?? companion.companionProfile.game;
    const hours = body.hours ? this.positiveDecimal(body.hours, "hours") : undefined;
    const priceTier = this.normalizePriceTier(undefined, body.mode);
    const budgetAmount = body.budgetAmount ? this.positiveDecimal(body.budgetAmount, "budgetAmount") : undefined;

    return this.prisma.$transaction(async (tx) => {
      await this.assertActiveCustomer(tx, body.customerId);
      await this.assertListedCompanion(tx, companionId, game);

      const draft = await tx.orderDraft.create({
        data: {
          draftNo: this.generateDraftNo(),
          customerId: body.customerId,
          serviceAdminId: companionId,
          selectedCompanionId: companionId,
          sourcePlatform: OrderSourcePlatform.WEB,
          game,
          mode: body.mode.trim(),
          hours,
          priceTier,
          budgetAmount,
          status: OrderDraftStatus.SELECTED,
          note: body.note?.trim() || "Companion created this draft after private customer request."
        }
      });

      await tx.orderDraftCandidate.create({
        data: {
          draftId: draft.id,
          companionId,
          recommendedById: companionId,
          status: OrderDraftCandidateStatus.SELECTED,
          note: body.note?.trim() || "Companion private request"
        }
      });

      await this.writeDraftEvent(tx, {
        draftId: draft.id,
        actorUserId: companionId,
        actorType: OrderDraftActorType.COMPANION,
        platform: OrderSourcePlatform.WEB,
        eventType: OrderDraftEventType.DRAFT_CREATED,
        content: body.note,
        metadata: { customerId: body.customerId, mode: body.mode, hours: body.hours, priceTier, budgetAmount: body.budgetAmount }
      });

      await this.writeDraftEvent(tx, {
        draftId: draft.id,
        actorUserId: companionId,
        actorType: OrderDraftActorType.COMPANION,
        platform: OrderSourcePlatform.WEB,
        eventType: OrderDraftEventType.CUSTOMER_SELECTED_COMPANION,
        content: "Companion was pre-selected because the customer contacted this companion directly.",
        metadata: { companionId }
      });

      return { draft };
    });
  }

  async listCompanionDrafts(companionId: string) {
    const companion = await this.prisma.user.findFirst({
      where: {
        id: companionId,
        status: UserStatus.ACTIVE,
        companionProfile: { is: { status: CompanionProfileStatus.LISTED } }
      },
      include: { companionProfile: true }
    });
    if (!companion?.companionProfile) throw new BadRequestException("Companion is not listed, active or does not exist");

    const companionGames = [...new Set([companion.companionProfile.game, ...companion.companionProfile.games])];
    const openStatuses = [OrderDraftStatus.OPEN, OrderDraftStatus.TRIALING];
    const activeStatuses = [OrderDraftStatus.OPEN, OrderDraftStatus.TRIALING, OrderDraftStatus.SELECTED, OrderDraftStatus.CUSTOMER_CONFIRMED];

    const drafts = await this.prisma.orderDraft.findMany({
      where: {
        status: { in: activeStatuses },
        OR: [
          { AND: [{ status: { in: openStatuses } }, { game: { in: companionGames } }] },
          { selectedCompanionId: companionId },
          { candidates: { some: { companionId } } }
        ]
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: {
        customer: { select: { id: true, email: true, displayName: true } },
        selectedCompanion: { select: { id: true, email: true, displayName: true } },
        convertedOrder: { select: { id: true, orderNo: true, status: true } },
        candidates: {
          orderBy: { createdAt: "asc" },
          include: {
            companion: {
              select: {
                id: true,
                email: true,
                displayName: true,
                companionProfile: {
                  select: {
                    nickname: true,
                    avatarUrl: true,
                    pricePerHour: true,
                    kookPricePerHour: true,
                    discordPricePerHour: true,
                    entertainmentPricePerHour: true,
                    rankedPricePerHour: true,
                    highRankedPricePerHour: true,
                    onlineStatus: true,
                    status: true
                  }
                }
              }
            }
          }
        }
      }
    });

    return drafts.map((draft) => {
      const currentCandidate = draft.candidates.find((candidate) => candidate.companionId === companionId) ?? null;
      const selectedForMe = draft.selectedCompanionId === companionId;
      const canApply =
        !currentCandidate &&
        !draft.convertedOrder &&
        !selectedForMe &&
        (draft.status === OrderDraftStatus.OPEN || draft.status === OrderDraftStatus.TRIALING);

      return {
        id: draft.id,
        draftNo: draft.draftNo,
        sourcePlatform: draft.sourcePlatform,
        customerDisplayName: "平台客户",
        customerContact: null,
        game: draft.game,
        mode: publicServiceLabel(draft.priceTier),
        hours: draft.hours?.toString() ?? null,
        priceTier: draft.priceTier,
        estimatedPricePerHour: this.pickCompanionPriceForTier(companion.companionProfile, draft.sourcePlatform, draft.priceTier).toString(),
        budgetAmount: draft.budgetAmount?.toString() ?? null,
        note: null,
        status: draft.status,
        candidatesCount: draft.candidates.length,
        selectedForMe,
        canApply,
        currentCandidate: currentCandidate
          ? { id: currentCandidate.id, status: currentCandidate.status, note: currentCandidate.note, createdAt: currentCandidate.createdAt }
          : null,
        selectedCompanion: draft.selectedCompanion,
        convertedOrder: draft.convertedOrder,
        updatedAt: draft.updatedAt
      };
    });
  }

  async companionApplyFromWeb(companionId: string, draftId: string, body: { note?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const draft = await this.assertEditableDraft(tx, draftId);
      await this.assertListedCompanion(tx, companionId, draft.game);
      const note = body.note?.trim() || "陪玩端报名，等待客服或老板确认。";

      const candidate = await tx.orderDraftCandidate.upsert({
        where: { draftId_companionId: { draftId, companionId } },
        create: {
          draftId,
          companionId,
          status: OrderDraftCandidateStatus.TRIALING,
          note
        },
        update: {
          status: OrderDraftCandidateStatus.TRIALING,
          note
        }
      });

      await tx.orderDraft.update({
        where: { id: draftId },
        data: { status: OrderDraftStatus.TRIALING }
      });

      await this.writeDraftEvent(tx, {
        draftId,
        actorUserId: companionId,
        actorType: OrderDraftActorType.COMPANION,
        platform: draft.sourcePlatform,
        platformUserId: draft.customerPlatformUserId,
        eventType: OrderDraftEventType.COMPANION_APPLIED,
        content: note,
        metadata: { companionId, source: "COMPANION_WEB" }
      });

      return candidate;
    });
  }
  async expireStaleDrafts() {
    const staleMinutes = Math.max(10, Number(process.env.ORDER_DRAFT_STALE_MINUTES ?? 60));
    const cutoff = new Date(Date.now() - staleMinutes * 60_000);
    const staleDrafts = await this.prisma.orderDraft.findMany({
      where: {
        status: { in: [OrderDraftStatus.OPEN, OrderDraftStatus.TRIALING, OrderDraftStatus.SELECTED] },
        updatedAt: { lt: cutoff }
      },
      select: { id: true, draftNo: true, sourcePlatform: true, customerPlatformUserId: true, note: true }
    });

    const expired: Array<{ id: string; draftNo: string }> = [];
    for (const draft of staleDrafts) {
      const note = `Flow expired: no companion accepted or customer did not choose within ${staleMinutes} minutes.`;
      const result = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.orderDraft.updateMany({
          where: {
            id: draft.id,
            status: { in: [OrderDraftStatus.OPEN, OrderDraftStatus.TRIALING, OrderDraftStatus.SELECTED] }
          },
          data: { status: OrderDraftStatus.CANCELLED, note: [draft.note, note].filter(Boolean).join("\n") }
        });
        if (updated.count !== 1) return false;
        await this.writeDraftEvent(tx, {
          draftId: draft.id,
          actorType: OrderDraftActorType.BOT,
          platform: draft.sourcePlatform,
          platformUserId: draft.customerPlatformUserId,
          eventType: OrderDraftEventType.DRAFT_CANCELLED,
          content: note,
          metadata: { reason: "STALE_TIMEOUT", staleMinutes }
        });
        return true;
      });

      if (result) {
        expired.push({ id: draft.id, draftNo: draft.draftNo });
        await this.botNotifications.sendOrderDraftFailedNotification(draft.id, note).catch(() => undefined);
      }
    }

    return { expiredCount: expired.length, expired, staleMinutes };
  }

  async addCandidate(adminId: string, draftId: string, body: { companionId: string; note?: string }) {
    if (!body.companionId) throw new BadRequestException("companionId is required");

    return this.prisma.$transaction(async (tx) => {
      const draft = await this.assertEditableDraft(tx, draftId);
      await this.assertListedCompanion(tx, body.companionId, draft.game);

      const candidate = await tx.orderDraftCandidate.upsert({
        where: { draftId_companionId: { draftId, companionId: body.companionId } },
        create: {
          draftId,
          companionId: body.companionId,
          recommendedById: adminId,
          status: OrderDraftCandidateStatus.RECOMMENDED,
          note: body.note
        },
        update: {
          recommendedById: adminId,
          status: OrderDraftCandidateStatus.RECOMMENDED,
          note: body.note
        }
      });

      await tx.orderDraft.update({
        where: { id: draftId },
        data: { status: OrderDraftStatus.TRIALING }
      });

      await this.writeDraftEvent(tx, {
        draftId,
        actorUserId: adminId,
        actorType: OrderDraftActorType.ADMIN,
        platform: draft.sourcePlatform,
        platformUserId: draft.customerPlatformUserId,
        eventType: OrderDraftEventType.COMPANION_RECOMMENDED,
        content: body.note,
        metadata: { companionId: body.companionId }
      });

      await this.writeAdminLog(tx, adminId, draft.customerId, "ADD_ORDER_DRAFT_CANDIDATE", draftId, { companionId: body.companionId });
      return candidate;
    });
  }

  async companionApplyFromPlatform(
    platform: OrderSourcePlatform,
    draftId: string,
    platformUserId: string,
    body: { note?: string; quoteAmount?: string; messageId?: string }
  ) {
    return this.companionApplyToDraft(platform, draftId, platformUserId, body);
  }

  async companionApplyFromPlatformByDraftNo(
    platform: OrderSourcePlatform,
    draftNo: string,
    platformUserId: string,
    body: { note?: string; quoteAmount?: string; messageId?: string }
  ) {
    const draft = await this.prisma.orderDraft.findUnique({
      where: { draftNo },
      select: { id: true }
    });
    if (!draft) throw new NotFoundException("Order draft not found");
    return this.companionApplyToDraft(platform, draft.id, platformUserId, body);
  }

  async getDraftApplyInstruction(draftId: string) {
    const draft = await this.prisma.orderDraft.findUnique({
      where: { id: draftId },
      select: { id: true, draftNo: true, status: true }
    });
    if (!draft) throw new NotFoundException("Order draft not found");
    if (draft.status === OrderDraftStatus.CONVERTED || draft.status === OrderDraftStatus.CANCELLED) {
      throw new BadRequestException("Order draft is closed");
    }

    return {
      draftNo: draft.draftNo,
      text: `发送：报名 ${draft.draftNo}。备注选填，可补充可服务时间或要求；无需重复填写已有资料。此按钮只显示说明，收到报名回执才算已记录；正式订单仍需另行确认和接单。`
    };
  }

  async companionApplyKookButton(draftId: string, platformUserId: string, messageId: string) {
    return this.prisma.$transaction(async tx => {
      const user = await requireKookActor(tx, platformUserId, undefined, UserRole.COMPANION);
      await tx.$queryRaw`SELECT "id" FROM "order_drafts" WHERE "id" = ${draftId} FOR UPDATE`;
      const draft = await tx.orderDraft.findUnique({ where: { id: draftId } });
      if (!draft || draft.sourcePlatform !== OrderSourcePlatform.KOOK) throw new BadRequestException("该需求不支持当前平台报名。");
      await this.assertListedCompanion(tx, user.id, draft.game);
      const candidate = await tx.orderDraftCandidate.findUnique({ where: { draftId_companionId: { draftId, companionId: user.id } } });
      // Replay never resets SELECTED/CUSTOMER_CONFIRMED to TRIALING or revives a rejected application.
      if (candidate && candidate.status !== OrderDraftCandidateStatus.REJECTED) return { draftNo: draft.draftNo, candidate, replayed: true };
      if (candidate || ![OrderDraftStatus.OPEN, OrderDraftStatus.TRIALING].includes(draft.status as "OPEN" | "TRIALING")) {
        throw new BadRequestException("该需求已停止报名，原选择不会因此改变。");
      }
      const configured = Number(process.env.ORDER_DRAFT_STALE_MINUTES ?? "60");
      const minutes = Number.isFinite(configured) ? Math.max(10, configured) : 60;
      if (draft.updatedAt.getTime() + minutes * 60_000 <= Date.now()) throw new BadRequestException("这张需求卡片已过期，请联系管理员核对最新需求。");
      const created = await tx.orderDraftCandidate.create({ data: { draftId, companionId: user.id, status: OrderDraftCandidateStatus.TRIALING } });
      await tx.orderDraft.update({ where: { id: draftId }, data: { status: OrderDraftStatus.TRIALING } });
      await this.writeDraftEvent(tx, { draftId, actorUserId: user.id, actorType: OrderDraftActorType.COMPANION,
        platform: OrderSourcePlatform.KOOK, platformUserId, eventType: OrderDraftEventType.COMPANION_APPLIED,
        metadata: { companionId: user.id, messageId, source: "KOOK_BUTTON" } });
      return { draftNo: draft.draftNo, candidate: created, replayed: false };
    });
  }

  private async companionApplyToDraft(
    platform: OrderSourcePlatform,
    draftId: string,
    platformUserId: string,
    body: { note?: string; quoteAmount?: string; messageId?: string }
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "order_drafts" WHERE "id" = ${draftId} FOR UPDATE`;
      const draft = await this.assertEditableDraft(tx, draftId);
      if (draft.sourcePlatform !== platform) throw new BadRequestException("该需求不支持当前平台报名");
      const externalAccount = await tx.userExternalAccount.findFirst({
        where: {
          platform: platform === OrderSourcePlatform.DISCORD ? "DISCORD" : "KOOK",
          externalUserId: platformUserId,
          user: {
            role: UserRole.COMPANION, status: UserStatus.ACTIVE,
            companionProfile: { is: { OR: [{ game: draft.game }, { games: { has: draft.game } }], status: CompanionProfileStatus.LISTED } }
          }
        },
        include: { user: { include: { companionProfile: true } } }
      });
      if (!externalAccount) {
        throw new BadRequestException("Platform account is not bound to an active listed companion");
      }

      const previous = await tx.orderDraftCandidate.findUnique({ where: { draftId_companionId: { draftId, companionId: externalAccount.userId } } });
      if (previous?.status === OrderDraftCandidateStatus.REJECTED) throw new BadRequestException("该报名已被拒绝，请联系管理员核对");
      if (![OrderDraftStatus.OPEN, OrderDraftStatus.TRIALING].includes(draft.status as "OPEN" | "TRIALING")) {
        if (previous) return { candidate: previous, companionName: externalAccount.user.companionProfile?.nickname ?? externalAccount.user.displayName, replayed: true };
        throw new BadRequestException("该需求已停止报名，客户选择不会因此改变");
      }

      const noteParts = [
        body.note?.trim(),
        body.quoteAmount ? `报价：${body.quoteAmount}` : undefined
      ].filter(Boolean);

      const candidate = await tx.orderDraftCandidate.upsert({
        where: { draftId_companionId: { draftId, companionId: externalAccount.userId } },
        create: {
          draftId,
          companionId: externalAccount.userId,
          status: OrderDraftCandidateStatus.TRIALING,
          note: noteParts.join("；") || null
        },
        update: {
          status: OrderDraftCandidateStatus.TRIALING,
          note: noteParts.join("；") || undefined
        }
      });

      await tx.orderDraft.update({
        where: { id: draftId },
        data: { status: OrderDraftStatus.TRIALING }
      });

      await this.writeDraftEvent(tx, {
        draftId,
        actorUserId: externalAccount.userId,
        actorType: OrderDraftActorType.COMPANION,
        platform,
        platformUserId,
        eventType: OrderDraftEventType.COMPANION_APPLIED,
        content: body.note,
        metadata: {
          companionId: externalAccount.userId,
          quoteAmount: body.quoteAmount,
          messageId: body.messageId
        }
      });

      return {
        candidate,
        companionName: externalAccount.user.companionProfile?.nickname ?? externalAccount.user.displayName
      };
    });
  }

  async recommendCandidates(adminId: string, draftId: string, limit = 3) {
    const draft = await this.prisma.orderDraft.findUnique({
      where: { id: draftId },
      include: {
        candidates: {
          include: {
            companion: {
              include: {
                companionProfile: true,
                wallet: true,
                companionOrders: {
                  where: { status: "COMPLETED" },
                  select: { id: true }
                }
              }
            }
          }
        }
      }
    });
    if (!draft) throw new NotFoundException("Order draft not found");
    if (!draft.candidates.length) throw new BadRequestException("No candidates to recommend");

    const ranked = draft.candidates
      .map((candidate) => {
        const profile = candidate.companion.companionProfile;
        const price = this.pickCompanionPriceForTier(profile, draft.sourcePlatform, draft.priceTier);
        const budgetScore = draft.budgetAmount && price.gt(0) ? (price.mul(draft.hours ?? 1).lte(draft.budgetAmount) ? 25 : -10) : 0;
        const onlineScore = profile?.onlineStatus === "ONLINE" ? 30 : profile?.onlineStatus === "BUSY" ? 10 : 0;
        const statusScore = candidate.status === OrderDraftCandidateStatus.TRIALING ? 15 : 5;
        const completionScore = Math.min(candidate.companion.companionOrders.length * 2, 20);
        const modeScore = profile?.skillModes.some((mode) => draft.mode.toLowerCase().includes(mode.toLowerCase())) ? 10 : 0;
        const score = onlineScore + statusScore + budgetScore + completionScore + modeScore;
        return {
          candidateId: candidate.id,
          companionId: candidate.companionId,
          nickname: profile?.nickname ?? candidate.companion.displayName,
          avatarUrl: profile?.avatarUrl ?? null,
          pricePerHour: price.toString(),
          onlineStatus: profile?.onlineStatus ?? "OFFLINE",
          note: candidate.note,
          score,
          reasons: [
            onlineScore >= 30 ? "当前在线" : onlineScore > 0 ? "当前忙碌但可沟通" : "当前离线",
            budgetScore > 0 ? "符合预算" : budgetScore < 0 ? "可能超预算" : "未填写预算",
            modeScore > 0 ? "擅长模式匹配" : "模式匹配度待人工确认",
            completionScore > 0 ? `历史完成 ${candidate.companion.companionOrders.length} 单` : "暂无完成单记录"
          ]
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(limit, 5)));

    await this.prisma.orderDraftEvent.create({
      data: {
        draftId,
        actorUserId: adminId,
        actorType: OrderDraftActorType.BOT,
        platform: draft.sourcePlatform,
        platformUserId: draft.customerPlatformUserId,
        eventType: OrderDraftEventType.NOTE_ADDED,
        content: "AI 派单助手生成候选推荐",
        metadata: ranked as unknown as Prisma.InputJsonValue
      }
    });

    return {
      draftId,
      draftNo: draft.draftNo,
      recommendations: ranked,
      customerMessage: this.buildCustomerRecommendationMessage(draft.draftNo, ranked)
    };
  }

  async selectCompanion(adminId: string, draftId: string, body: { companionId?: string; companionIds?: string[]; note?: string },
    customerContext?: { draftNo: string; sourcePlatform: OrderSourcePlatform; platformUserId: string;
      customerId?: string; guildId?: string; channelId?: string; candidateId: string }) {
    const companionIds = this.normalizeCompanionIds(body);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "order_drafts" WHERE "id" = ${draftId} FOR UPDATE`;
      const draft = await this.assertEditableDraft(tx, draftId);
      if (customerContext) {
        const ownsDraft = (customerContext.customerId && draft.customerId === customerContext.customerId) ||
          (customerContext.platformUserId && draft.customerPlatformUserId === customerContext.platformUserId);
        if (!ownsDraft || draft.draftNo !== customerContext.draftNo || draft.sourcePlatform !== customerContext.sourcePlatform ||
          !["OPEN", "TRIALING", "SELECTED"].includes(draft.status) ||
          (customerContext.guildId && draft.sourceGuildId !== customerContext.guildId) ||
          (customerContext.channelId && draft.sourceChannelId !== customerContext.channelId)) {
          throw new BadRequestException("该草稿不属于你或上下文已变化，请刷新后重新选择");
        }
        await tx.$queryRaw`SELECT "id" FROM "order_draft_candidates" WHERE "id" = ${customerContext.candidateId} FOR UPDATE`;
        const candidate = await tx.orderDraftCandidate.findUnique({ where: { id: customerContext.candidateId } });
        if (!candidate || candidate.draftId !== draftId || candidate.status === OrderDraftCandidateStatus.REJECTED ||
          companionIds.length !== 1 || candidate.companionId !== companionIds[0]) {
          throw new BadRequestException("该候选已失效，请刷新草稿后重新选择");
        }
      }
      for (const companionId of companionIds) {
        await this.assertListedCompanion(tx, companionId, draft.game);
      }

      const previousCompanionId = draft.selectedCompanionId;
      const previousSelected = await tx.orderDraftCandidate.findMany({
        where: { draftId, status: OrderDraftCandidateStatus.SELECTED },
        select: { companionId: true }
      });
      for (const companionId of companionIds) {
        await tx.orderDraftCandidate.upsert({
          where: { draftId_companionId: { draftId, companionId } },
          create: {
            draftId,
            companionId,
            recommendedById: adminId,
            status: OrderDraftCandidateStatus.SELECTED,
            note: body.note
          },
          update: { status: OrderDraftCandidateStatus.SELECTED, note: body.note }
        });
      }
      await tx.orderDraftCandidate.updateMany({
        where: { draftId, companionId: { notIn: companionIds }, status: OrderDraftCandidateStatus.SELECTED },
        data: { status: OrderDraftCandidateStatus.RECOMMENDED }
      });

      const updated = await tx.orderDraft.update({
        where: { id: draftId },
        data: {
          selectedCompanionId: companionIds[0],
          status: OrderDraftStatus.SELECTED
        }
      });

      await this.writeDraftEvent(tx, {
        draftId,
        actorUserId: customerContext ? customerContext.customerId : adminId,
        actorType: customerContext ? OrderDraftActorType.CUSTOMER : OrderDraftActorType.ADMIN,
        platform: draft.sourcePlatform,
        platformUserId: draft.customerPlatformUserId,
        eventType: previousCompanionId ? OrderDraftEventType.CUSTOMER_CHANGED_COMPANION : OrderDraftEventType.CUSTOMER_SELECTED_COMPANION,
        content: body.note,
        metadata: {
          previousCompanionId,
          previousCompanionIds: previousSelected.map((item) => item.companionId),
          companionId: companionIds[0],
          companionIds,
          companionCount: companionIds.length
        }
      });

      await this.writeAdminLog(tx, adminId, draft.customerId, "SELECT_ORDER_DRAFT_COMPANION", draftId, {
        previousCompanionId,
        companionId: companionIds[0],
        companionIds,
        companionCount: companionIds.length
      });
      return updated;
    });

    await Promise.all(companionIds.map((companionId) => this.botNotifications.sendOrderDraftSelectedCompanionNotification(draftId, companionId).catch(() => undefined)));
    return updated;
  }

  async confirmDraft(adminId: string, draftId: string, body: { note?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const draft = await this.assertEditableDraft(tx, draftId);
      const updated = await tx.orderDraft.update({
        where: { id: draftId },
        data: { status: OrderDraftStatus.CUSTOMER_CONFIRMED, note: body.note ?? draft.note }
      });

      await this.writeDraftEvent(tx, {
        draftId,
        actorUserId: adminId,
        actorType: OrderDraftActorType.ADMIN,
        platform: draft.sourcePlatform,
        platformUserId: draft.customerPlatformUserId,
        eventType: OrderDraftEventType.CUSTOMER_CONFIRMED,
        content: body.note
      });

      await this.writeAdminLog(tx, adminId, draft.customerId, "CONFIRM_ORDER_DRAFT", draftId, { note: body.note });
      return updated;
    });
  }

  async cancelDraft(adminId: string, draftId: string, body: { note?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const draft = await this.assertEditableDraft(tx, draftId);
      const updated = await tx.orderDraft.update({
        where: { id: draftId },
        data: { status: OrderDraftStatus.CANCELLED, note: body.note ?? draft.note }
      });
      await this.writeDraftEvent(tx, {
        draftId,
        actorUserId: adminId,
        actorType: OrderDraftActorType.ADMIN,
        platform: draft.sourcePlatform,
        platformUserId: draft.customerPlatformUserId,
        eventType: OrderDraftEventType.DRAFT_CANCELLED,
        content: body.note
      });
      await this.writeAdminLog(tx, adminId, draft.customerId, "CANCEL_ORDER_DRAFT", draftId, { note: body.note });
      return updated;
    });
  }

  async failDraft(adminId: string, draftId: string, body: { note?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const draft = await this.assertEditableDraft(tx, draftId);
      const note = `流单：${body.note?.trim() || "长时间无人报名或客户未继续确认"}`;
      const updated = await tx.orderDraft.update({
        where: { id: draftId },
        data: { status: OrderDraftStatus.CANCELLED, note }
      });
      await this.writeDraftEvent(tx, {
        draftId,
        actorUserId: adminId,
        actorType: OrderDraftActorType.ADMIN,
        platform: draft.sourcePlatform,
        platformUserId: draft.customerPlatformUserId,
        eventType: OrderDraftEventType.DRAFT_CANCELLED,
        content: note
      });
      await this.writeAdminLog(tx, adminId, draft.customerId, "FAIL_ORDER_DRAFT", draftId, { note });
      return updated;
    });
  }

  async convertDraftToOrder(
    adminId: string,
    draftId: string,
    body: { companionId?: string; companionIds?: string[]; note?: string; rankTierKey?: string; customUnitPrice?: string } = {}
  ) {
    // A committed order is the durable conversion receipt, even if dispatch or
    // draft finalization failed. Recover before trying to edit a closed draft.
    const recovered = await this.recoverDraftConversion(adminId, draftId);
    if (recovered) return recovered;
    const requestedCompanionIds = this.normalizeCompanionIds(body, false);
    if (requestedCompanionIds.length) {
      await this.selectCompanion(adminId, draftId, { companionIds: requestedCompanionIds, note: body.note });
    }
    const draft = await this.prisma.orderDraft.findUnique({
      where: { id: draftId },
      include: {
        convertedOrder: true,
        convertedOrderGroup: true,
        candidates: {
          where: { status: OrderDraftCandidateStatus.SELECTED },
          select: { companionId: true }
        }
      }
    });

    if (!draft) throw new NotFoundException("Order draft not found");
    if (draft.status === OrderDraftStatus.CONVERTED || draft.convertedOrder || draft.convertedOrderGroup) {
      throw new BadRequestException("Order draft was already converted");
    }
    if (draft.status === OrderDraftStatus.CANCELLED) {
      throw new BadRequestException("Cancelled order draft cannot be converted");
    }
    if (!draft.customerId) throw new BadRequestException("Order draft must be linked to a customer before conversion");
    if (!draft.hours) throw new BadRequestException("Order draft hours is required before conversion");

    const selectedCompanionIds = [...new Set(draft.candidates.map((candidate) => candidate.companionId))];
    if (!selectedCompanionIds.length && draft.selectedCompanionId) selectedCompanionIds.push(draft.selectedCompanionId);
    const rankTierKey = body.rankTierKey ?? draft.rankTierKey ?? undefined;
    if (selectedCompanionIds.length > 1) {
      const groupResult = await this.orders.createOrderGroup(draft.customerId, {
        game: draft.game,
        mode: draft.mode,
        hours: draft.hours.toString(),
        priceTier: draft.priceTier,
        rankTierKey,
        customUnitPrice: body.customUnitPrice,
        companionIds: selectedCompanionIds,
        notes: draft.note ? `客服试音单 ${draft.draftNo}：${draft.note}` : `客服试音单 ${draft.draftNo}`,
        voiceTrialRequested: true,
        sourcePlatform: draft.sourcePlatform,
        sourceDraftId: draft.id,
        sourceChannelId: draft.sourceChannelId ?? undefined,
        sourceMessageId: draft.sourceMessageId ?? undefined,
        assignedById: adminId
      });

      return { ...(await this.recoverDraftConversion(adminId, draftId))!, notifications: groupResult.notifications };
    }

    const selectedCompanionId = selectedCompanionIds[0];
    const order = await this.orders.createOrder(draft.customerId, {
      game: draft.game,
      mode: draft.mode,
      hours: draft.hours.toString(),
      priceTier: draft.priceTier,
      rankTierKey,
      customUnitPrice: body.customUnitPrice,
      companionId: selectedCompanionId,
      notes: draft.note ? `客服试音单 ${draft.draftNo}：${draft.note}` : `客服试音单 ${draft.draftNo}`,
      voiceTrialRequested: true,
      sourcePlatform: draft.sourcePlatform,
      sourceDraftId: draft.id,
      sourceChannelId: draft.sourceChannelId ?? undefined,
      sourceMessageId: draft.sourceMessageId ?? undefined
    });

    const assignment = selectedCompanionId ? await this.orders.assignOrder(order.id, selectedCompanionId, adminId, order.dispatchVersion) : null;

    return { ...(await this.recoverDraftConversion(adminId, draftId))!, assignment };
  }

  private async recoverDraftConversion(adminId: string, draftId: string) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "order_drafts" WHERE "id" = ${draftId} FOR UPDATE`;
      const draft = await tx.orderDraft.findUnique({ where: { id: draftId }, include: {
        convertedOrder: true, convertedOrderGroup: { include: { orders: true } }
      } });
      if (!draft) throw new NotFoundException("Order draft not found");
      const order = draft.convertedOrder;
      const group = draft.convertedOrderGroup;
      if (!order && !group) return null;
      if (order && group) throw new BadRequestException("Draft has conflicting conversion receipts; admin review required");
      if (draft.status === OrderDraftStatus.CANCELLED) throw new BadRequestException("Cancelled draft has a funded order; admin review required");
      const metadata = group ? {
        orderGroupId: group.id, groupNo: group.groupNo,
        companionIds: group.orders.map(item => item.companionId),
        orderIds: group.orders.map(item => item.id), orderNos: group.orders.map(item => item.orderNo)
      } : { orderId: order!.id, orderNo: order!.orderNo };
      const updated = draft.status === OrderDraftStatus.CONVERTED ? draft : await tx.orderDraft.update({
        where: { id: draftId }, data: { status: OrderDraftStatus.CONVERTED, convertedById: adminId }
      });
      if (draft.status !== OrderDraftStatus.CONVERTED) {
        await this.writeDraftEvent(tx, { draftId, actorUserId: adminId, actorType: OrderDraftActorType.ADMIN,
          platform: draft.sourcePlatform, platformUserId: draft.customerPlatformUserId,
          eventType: OrderDraftEventType.DRAFT_CONVERTED_TO_ORDER, metadata });
        await this.writeAdminLog(tx, adminId, draft.customerId,
          group ? "CONVERT_ORDER_DRAFT_GROUP" : "CONVERT_ORDER_DRAFT", draftId, metadata);
      }
      // Never re-dispatch on recovery: an earlier notification may have an unknown outcome.
      return group ? { draft: updated, orderGroup: group, orders: group.orders, notifications: [],
        requiresDispatch: group.orders.some(item => item.status === "PAID") }
        : { draft: updated, order: order!, assignment: null, requiresDispatch: order!.status === "PAID" };
    });
  }

  private normalizeCompanionIds(body: { companionId?: string; companionIds?: string[] }, required = true) {
    const ids = [...(body.companionIds ?? []), body.companionId]
      .map((id) => id?.trim())
      .filter((id): id is string => Boolean(id));
    const uniqueIds = [...new Set(ids)];
    if (required && !uniqueIds.length) throw new BadRequestException("companionId or companionIds is required");
    return uniqueIds;
  }

  private async assertActiveCustomer(tx: Prisma.TransactionClient, customerId: string) {
    const customer = await tx.user.findFirst({
      where: { id: customerId, role: UserRole.CUSTOMER, status: UserStatus.ACTIVE },
      select: { id: true }
    });
    if (!customer) throw new BadRequestException("Customer does not exist or is not active");
  }

  private async assertListedCompanion(tx: Prisma.TransactionClient, companionId: string, game: GameCode) {
    const companion = await tx.user.findFirst({
      where: {
        id: companionId,
        status: UserStatus.ACTIVE,
        companionProfile: { is: { OR: [{ game }, { games: { has: game } }], status: CompanionProfileStatus.LISTED } }
      },
      select: { id: true }
    });
    if (!companion) throw new BadRequestException("Companion is not listed for this game");
  }

  private async assertEditableDraft(tx: Prisma.TransactionClient, draftId: string) {
    const draft = await tx.orderDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundException("Order draft not found");
    if (draft.status === OrderDraftStatus.CONVERTED || draft.status === OrderDraftStatus.CANCELLED) {
      throw new BadRequestException("Order draft is closed");
    }
    return draft;
  }

  private async writeDraftEvent(
    tx: Prisma.TransactionClient,
    data: {
      draftId: string;
      actorType: OrderDraftActorType;
      actorUserId?: string;
      platform: OrderSourcePlatform;
      platformUserId?: string | null;
      eventType: OrderDraftEventType;
      content?: string;
      metadata?: Prisma.InputJsonValue;
    }
  ) {
    await tx.orderDraftEvent.create({ data });
  }

  private async writeAdminLog(
    tx: Prisma.TransactionClient,
    actorId: string,
    targetUserId: string | null | undefined,
    action: string,
    entityId: string,
    detail: Prisma.InputJsonValue
  ) {
    await tx.adminLog.create({
      data: {
        actorId,
        targetUserId,
        action,
        entityType: "ORDER_DRAFT",
        entityId,
        detail
      }
    });
  }

  private serializeDraft(draft: {
    id: string;
    draftNo: string;
    customerId: string | null;
    serviceAdminId: string;
    selectedCompanionId: string | null;
    sourcePlatform: OrderSourcePlatform;
    customerPlatformUserId: string | null;
    customerDisplayName: string | null;
    sourceGuildId: string | null;
    sourceChannelId: string | null;
    sourceMessageId: string | null;
    voiceRoomId: string | null;
    game: GameCode;
    mode: string;
    hours: Prisma.Decimal | null;
    priceTier: ServicePriceTier;
    rankTierKey?: string | null;
    rankTierNameSnapshot?: string | null;
    budgetAmount: Prisma.Decimal | null;
    status: OrderDraftStatus;
    note: string | null;
    createdAt: Date;
    updatedAt: Date;
    customer?: { id: string; email: string; displayName: string } | null;
    serviceAdmin?: { id: string; email: string; displayName: string };
    selectedCompanion?: { id: string; email: string; displayName: string } | null;
    convertedOrder?: { id: string; orderNo: string; status: string; totalAmount: Prisma.Decimal } | null;
    candidates?: Array<{
      id: string;
      status: OrderDraftCandidateStatus;
      note: string | null;
      createdAt: Date;
      companion: {
        id: string;
        email: string;
        displayName: string;
        companionProfile: {
          nickname: string;
          avatarUrl: string | null;
          pricePerHour: Prisma.Decimal;
          kookPricePerHour?: Prisma.Decimal | null;
          discordPricePerHour?: Prisma.Decimal | null;
          entertainmentPricePerHour?: Prisma.Decimal | null;
          rankedPricePerHour?: Prisma.Decimal | null;
          highRankedPricePerHour?: Prisma.Decimal | null;
          onlineStatus: string;
          status: string;
        } | null;
      };
      recommendedBy?: { id: string; email: string; displayName: string } | null;
    }>;
    events?: Array<{
      id: string;
      actorType: OrderDraftActorType;
      eventType: OrderDraftEventType;
      content: string | null;
      metadata: Prisma.JsonValue;
      createdAt: Date;
      actor?: { id: string; email: string; displayName: string } | null;
    }>;
  }, notificationEvents: Array<{
    platform: string;
    status: BotEventStatus;
    platformChannelId: string | null;
    platformMessageId: string | null;
    error: string | null;
    payload: Prisma.JsonValue;
    createdAt: Date;
  }> = []) {
    return {
      ...draft,
      hours: draft.hours?.toString() ?? null,
      priceTier: draft.priceTier,
      rankTierKey: draft.rankTierKey ?? null,
      rankTierNameSnapshot: draft.rankTierNameSnapshot ?? null,
      budgetAmount: draft.budgetAmount?.toString() ?? null,
      convertedOrder: draft.convertedOrder
        ? { ...draft.convertedOrder, totalAmount: draft.convertedOrder.totalAmount.toString() }
        : null,
      candidates: draft.candidates?.map((candidate) => ({
        ...candidate,
        companion: {
          ...candidate.companion,
          companionProfile: candidate.companion.companionProfile
            ? {
                ...candidate.companion.companionProfile,
                pricePerHour: this.pickCompanionPriceForTier(candidate.companion.companionProfile, draft.sourcePlatform, draft.priceTier).toString(),
                entertainmentPricePerHour: candidate.companion.companionProfile.entertainmentPricePerHour?.toString() ?? null,
                rankedPricePerHour: candidate.companion.companionProfile.rankedPricePerHour?.toString() ?? null,
                highRankedPricePerHour: candidate.companion.companionProfile.highRankedPricePerHour?.toString() ?? null
              }
            : null
        }
      })) ?? [],
      events: draft.events ?? [],
      publishedPlatforms: this.serializeDraftNotifications(notificationEvents)
    };
  }

  private serializeDraftNotifications(events: Array<{
    platform: string;
    status: BotEventStatus;
    platformChannelId: string | null;
    platformMessageId: string | null;
    error: string | null;
    createdAt: Date;
  }>) {
    const latestByPlatform = new Map<string, (typeof events)[number]>();
    for (const event of events) {
      if (!latestByPlatform.has(event.platform)) {
        latestByPlatform.set(event.platform, event);
      }
    }

    return [...latestByPlatform.values()].map((event) => ({
      platform: event.platform,
      status: event.status,
      channelId: event.platformChannelId,
      messageId: event.platformMessageId,
      error: event.error,
      createdAt: event.createdAt
    }));
  }

  private getPayloadDraftId(payload: Prisma.JsonValue) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const draftId = (payload as { draftId?: unknown }).draftId;
    return typeof draftId === "string" ? draftId : null;
  }

  private positiveDecimal(value: string, fieldName: string) {
    return fixedDecimal(value, fieldName, { max: fieldName === "hours" ? "9999.99" : undefined });
  }

  private pickCompanionPriceForPlatform(
    profile: { pricePerHour: Prisma.Decimal; kookPricePerHour?: Prisma.Decimal | null; discordPricePerHour?: Prisma.Decimal | null } | null | undefined,
    sourcePlatform: OrderSourcePlatform
  ) {
    if (!profile) return new Prisma.Decimal(0);
    if (sourcePlatform === OrderSourcePlatform.DISCORD) return profile.discordPricePerHour ?? profile.pricePerHour;
    if (sourcePlatform === OrderSourcePlatform.KOOK) return profile.kookPricePerHour ?? profile.pricePerHour;
    return profile.pricePerHour;
  }

  private pickCompanionPriceForTier(
    profile: {
      pricePerHour: Prisma.Decimal;
      kookPricePerHour?: Prisma.Decimal | null;
      discordPricePerHour?: Prisma.Decimal | null;
      entertainmentPricePerHour?: Prisma.Decimal | null;
      rankedPricePerHour?: Prisma.Decimal | null;
      highRankedPricePerHour?: Prisma.Decimal | null;
    } | null | undefined,
    sourcePlatform: OrderSourcePlatform,
    priceTier: ServicePriceTier
  ) {
    if (!profile) return new Prisma.Decimal(0);
    if (priceTier === ServicePriceTier.ENTERTAINMENT) return profile.entertainmentPricePerHour ?? this.pickCompanionPriceForPlatform(profile, sourcePlatform);
    if (priceTier === ServicePriceTier.RANKED) return profile.rankedPricePerHour ?? this.pickCompanionPriceForPlatform(profile, sourcePlatform);
    if (priceTier === ServicePriceTier.HIGH_RANKED) return profile.highRankedPricePerHour ?? profile.rankedPricePerHour ?? this.pickCompanionPriceForPlatform(profile, sourcePlatform);
    return this.pickCompanionPriceForPlatform(profile, sourcePlatform);
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

  private parseDemandText(demandText: string): ParsedDispatchDemand {
    const text = demandText.trim();
    if (!text) throw new BadRequestException("demandText is required");
    if (text.length > 1000) throw new BadRequestException("demandText is too long");

    const lower = text.toLowerCase();
    const game = this.detectGame(lower);
    const mode = this.detectMode(text, lower);
    const priceTier = this.normalizePriceTier(undefined, mode);
    const hoursMatch = text.match(/(\d+(?:\.\d+)?)\s*(小时|h|H|个小时)/);
    const budgetMatch = text.match(/(?:预算|价格|金额|价位|不超过|以内)[^\d]*(\d+(?:\.\d+)?)/);
    const preferences = [
      /女|女生|女声/.test(text) ? "偏好女陪玩/女声" : undefined,
      /男|男生|男声/.test(text) ? "偏好男陪玩/男声" : undefined,
      /不试音|不用试音|不要试音|免试音/.test(text) ? "不需要试音" : /试音|听声音|语音/.test(text) ? "需要试音" : undefined,
      /上分|排位|带飞/.test(text) ? "偏上分" : undefined,
      /娱乐|聊天|轻松/.test(text) ? "偏娱乐聊天" : undefined
    ].filter(Boolean) as string[];

    return {
      game,
      mode,
      priceTier,
      hours: hoursMatch?.[1],
      budgetAmount: budgetMatch?.[1],
      preferences,
      note: [`原始需求：${text}`, preferences.length ? `偏好：${preferences.join("、")}` : undefined].filter(Boolean).join("\n")
    };
  }

  private detectGame(lower: string) {
    if (lower.includes("lol") || lower.includes("英雄联盟")) return GameCode.LEAGUE_OF_LEGENDS;
    if (lower.includes("瓦") || lower.includes("无畏契约") || lower.includes("valorant")) return GameCode.VALORANT;
    if (lower.includes("cs2") || lower.includes("csgo")) return GameCode.COUNTER_STRIKE_2;
    if (lower.includes("pubg") || lower.includes("吃鸡") || lower.includes("绝地求生")) return GameCode.PUBG;
    if (lower.includes("apex")) return GameCode.APEX_LEGENDS;
    if (lower.includes("永劫") || lower.includes("naraka")) return GameCode.NARAKA_BLADEPOINT;
    if (lower.includes("塔科夫") || lower.includes("tarkov") || lower.includes("cod") || lower.includes("使命召唤")) return GameCode.CALL_OF_DUTY;
    return GameCode.DELTA_FORCE;
  }

  private detectMode(text: string, lower: string) {
    if (text.includes("烽火")) return "烽火地带";
    if (text.includes("随意") || text.includes("不限") || text.includes("都行") || text.includes("无所谓")) return "随意";
    if (lower.includes("排位") || lower.includes("rank")) return "排位";
    if (text.includes("上分")) return "上分";
    if (text.includes("娱乐")) return "娱乐";
    if (text.includes("试音")) return "试音派单";
    return "平台派单";
  }

  private buildCustomerRecommendationMessage(draftNo: string, recommendations: Array<{ candidateId: string; nickname: string; pricePerHour: string; onlineStatus: string; reasons: string[] }>) {
    return [
      `根据你的需求，May猫饼为你推荐以下陪玩（试音单 ${draftNo}）：`,
      ...recommendations.map((item, index) => `${index + 1}. ${item.nickname}，¥${item.pricePerHour}/小时，${item.onlineStatus}，${item.reasons.join(" / ")}；选择指令：选择 ${draftNo} #${item.candidateId}`),
      `请复制候选对应的完整选择指令；也可回复“选择 ${draftNo} 陪玩昵称”（昵称须唯一）。仅草稿本人可选，选择后仍需确认服务和价格。`
    ].join("\n");
  }

  private generateDraftNo() {
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const random = Math.random().toString(36).slice(2, 7).toUpperCase();
    return `TRY${stamp}${random}`;
  }
}
