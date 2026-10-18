import { buildOrderAcceptAction } from "@dfc/shared";
import { cardContainsAction } from "../kook/kook-flow-card";
import { publicServiceLabel } from "../orders/public-dispatch";
import { Injectable } from "@nestjs/common";
import { BotEventStatus, BotEventType, BotPlatform, OrderSourcePlatform, OrderStatus, ReviewStatus, UserRole, type Prisma } from "@prisma/client";
import { getConfiguredDiscordCustomerLevelRoles, getConfiguredKookCustomerLevelRoles, getCustomerMembershipLevel } from "../customer-membership";
import { PrismaService } from "../prisma/prisma.service";
import { IntegrationJobsService } from "./integration-jobs.service";
import { NotificationDeliveryService } from "./notification-delivery.service";

interface OrderNotificationData {
  orderId: string;
  dispatchVersion: number;
  acceptanceDeadline?: string;
  game: string;
  orderNo: string;
  mode: string;
  hours: string;
  totalAmount: string;
  companionId?: string;
  companionName?: string;
}

interface OrderDraftNotificationData {
  draftId: string;
  draftNo: string;
  game: string;
  mode: string;
  hours?: string | null;
  budgetAmount?: string | null;
  note?: string | null;
}

interface NotificationResult {
  platform: BotPlatform;
  status: BotEventStatus;
  messageId?: string;
  error?: string;
}

const dispatchRoleTags = [
  { game: "DELTA_FORCE", label: "三角洲行动组", discordEnv: "DISCORD_GAME_DELTA_FORCE_ROLE_ID", kookEnv: "KOOK_GAME_DELTA_FORCE_ROLE_ID" }, // gitleaks:allow env var names only
  { game: "LEAGUE_OF_LEGENDS", label: "英雄联盟组", discordEnv: "DISCORD_GAME_LEAGUE_OF_LEGENDS_ROLE_ID", kookEnv: "KOOK_GAME_LEAGUE_OF_LEGENDS_ROLE_ID" }, // gitleaks:allow env var names only
  { game: "VALORANT", label: "无畏契约组", discordEnv: "DISCORD_GAME_VALORANT_ROLE_ID", kookEnv: "KOOK_GAME_VALORANT_ROLE_ID" }, // gitleaks:allow env var names only
  { game: "COUNTER_STRIKE_2", label: "CS2组", discordEnv: "DISCORD_GAME_COUNTER_STRIKE_2_ROLE_ID", kookEnv: "KOOK_GAME_COUNTER_STRIKE_2_ROLE_ID" }, // gitleaks:allow env var names only
  { game: "PUBG", label: "PUBG组", discordEnv: "DISCORD_GAME_PUBG_ROLE_ID", kookEnv: "KOOK_GAME_PUBG_ROLE_ID" }, // gitleaks:allow env var names only
  { game: "APEX_LEGENDS", label: "Apex组", discordEnv: "DISCORD_GAME_APEX_LEGENDS_ROLE_ID", kookEnv: "KOOK_GAME_APEX_LEGENDS_ROLE_ID" }, // gitleaks:allow env var names only
  { game: "NARAKA_BLADEPOINT", label: "永劫无间组", discordEnv: "DISCORD_GAME_NARAKA_BLADEPOINT_ROLE_ID", kookEnv: "KOOK_GAME_NARAKA_BLADEPOINT_ROLE_ID" }, // gitleaks:allow env var names only
  { game: "CALL_OF_DUTY", label: "塔科夫/COD组", discordEnv: "DISCORD_GAME_CALL_OF_DUTY_ROLE_ID", kookEnv: "KOOK_GAME_CALL_OF_DUTY_ROLE_ID" } // gitleaks:allow env var names only
] as const;

const voiceRoleTags = [
  { label: "月影声线", discordEnv: "DISCORD_VOICE_MOON_ROLE_ID", kookEnv: "KOOK_VOICE_MOON_ROLE_ID", keywords: ["女", "女生", "女声", "柔和", "甜", "月影"] }, // gitleaks:allow env var names only
  { label: "曜刃声线", discordEnv: "DISCORD_VOICE_SOLAR_ROLE_ID", kookEnv: "KOOK_VOICE_SOLAR_ROLE_ID", keywords: ["男", "男生", "男声", "沉稳", "低音", "曜刃"] } // gitleaks:allow env var names only
] as const;

interface KookMessageResponse {
  msg_id: string;
}

@Injectable()
export class BotNotificationService {
  constructor(private readonly prisma: PrismaService, private readonly jobs: IntegrationJobsService, private readonly deliveries: NotificationDeliveryService) {}

  onModuleInit() {
    this.jobs.register("NOTIFICATION_RESEND", async payload => { await this.deliveries.retry((payload as { deliveryId: string }).deliveryId); });
    this.jobs.register("DRAFT_DISPATCH", async payload => {
      const results = await this.sendOrderDraftDispatchNotifications((payload as { draftId: string }).draftId);
      if (results.some(result => result.status === BotEventStatus.FAILED)) throw new Error("DraftDispatchFailed");
    });
    this.jobs.register("ORDER_CARD_REFRESH", async payload => {
      const task = payload as { orderId: string; staleBeforeVersion?: number };
      await this.refreshAcceptedOrderCards(task.orderId, task.staleBeforeVersion);
    });
    this.jobs.register("ORDER_DISPATCH", async payload => {
      const task = payload as { orderId: string; dispatchVersion: number };
      await this.refreshAcceptedOrderCards(task.orderId, task.dispatchVersion);
      const order = await this.prisma.order.findUnique({ where: { id: task.orderId } });
      if (!order || order.dispatchVersion !== task.dispatchVersion || order.status !== OrderStatus.ASSIGNED) return;
      const results = await this.sendOrderAssignedNotifications(order.id);
      if (results.some(result => result.status === BotEventStatus.FAILED)) throw new Error("OrderDispatchFailed");
    });
  }

  async refreshAcceptedOrderCards(orderId: string, staleBeforeVersion?: number) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    if (staleBeforeVersion === undefined && (order.status === OrderStatus.ASSIGNED || order.status === OrderStatus.PAID)) return;
    const events = await this.prisma.botEvent.findMany({ where: { orderId, type: BotEventType.ORDER_NOTIFICATION_SENT, status: BotEventStatus.SENT } });
    const receipts = await this.prisma.notificationDelivery.findMany({ where: { businessKey: { startsWith: `order-notice:${orderId}:` }, status: "SENT" } });
    // A decline, timeout or replacement refresh keeps its own wording even if the order is cancelled before it runs.
    const wasCancelled = staleBeforeVersion === undefined
      && (order.status === OrderStatus.CANCELLED || (order.status === OrderStatus.REFUNDED && Boolean(order.cancelledAt)));
    const wasAccepted = staleBeforeVersion === undefined
      && (order.status === OrderStatus.ACCEPTED || Boolean(order.acceptedAt))
      && order.status !== OrderStatus.CANCELLED
      && order.status !== OrderStatus.REFUND_REQUESTED
      && order.status !== OrderStatus.REFUNDED;
    // Acceptance and cancellation only close cards from this dispatch; older or unversioned cards
    // retain the wording from the event that invalidated them.
    const matchesVersion = (version: number | undefined) => wasAccepted || wasCancelled
      ? version !== undefined && version === order.dispatchVersion
      : staleBeforeVersion === undefined || (version ?? 0) < staleBeforeVersion;
    const staleEvents = events.filter(event => matchesVersion((event.payload as { dispatchVersion?: number } | null)?.dispatchVersion));
    const staleReceipts = receipts.filter(receipt => matchesVersion(receipt.businessKey.includes(":v") ? Number(receipt.businessKey.split(":v")[1]) : undefined));
    const messages = [...new Map([...staleEvents, ...staleReceipts.map(d => ({ platform: d.platform, platformMessageId: d.messageId, platformChannelId: d.target }))].map(m => [`${m.platform}:${m.platformMessageId}`, m])).values()];
    for (const message of messages) {
      if (!message.platformMessageId) continue;
      if (message.platform === BotPlatform.DISCORD && message.platformChannelId) {
        // An accepted order's card already reads "已被接单"; cancellation must not rewrite it.
        if (wasCancelled && order.acceptedAt) continue;
        if (!process.env.DISCORD_TOKEN) throw new Error("DiscordNotConfigured");
        const response = await fetch(`https://discord.com/api/v10/channels/${message.platformChannelId}/messages/${message.platformMessageId}`, {
          method: "PATCH", headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ content: wasAccepted ? `订单 ${order.orderNo} 已被接单，此卡片已关闭` : `订单 ${order.orderNo} 状态已更新，此卡片已失效，请到订单页查看。`, components: [], allowed_mentions: { parse: [] } })
        });
        if (!response.ok) throw new Error("DiscordCardRefreshFailed");
      } else if (message.platform === BotPlatform.KOOK) {
        // Read the actual card so closures made before this fix are preserved too.
        if (wasCancelled && !await this.kookCardStillAccepts(message.platformMessageId, order.id, order.dispatchVersion)) continue;
        await this.postKookMessage("/api/v3/message/update", { msg_id: message.platformMessageId, content: JSON.stringify([{ type: "card", theme: "success", size: "lg", modules: [{ type: "section", text: { type: "plain-text", content: wasCancelled ? `订单 ${order.orderNo} 已取消，此卡片已关闭` : wasAccepted ? `订单 ${order.orderNo} 已被接单，此卡片已关闭` : `订单 ${order.orderNo} 状态已更新，此卡片已失效，请到订单页查看。` } }] }]) });
      }
    }
  }

  private async kookCardStillAccepts(messageId: string, orderId: string, dispatchVersion: number) {
    const response = await fetch(`https://www.kookapp.cn/api/v3/message/view?msg_id=${encodeURIComponent(messageId)}`, {
      method: "GET", headers: { Authorization: `Bot ${process.env.KOOK_TOKEN}` }
    });
    if (!response.ok) throw new Error(`KOOK card lookup HTTP ${response.status}`);
    const result = await response.json() as { code: number; data?: { content?: string } };
    if (result.code !== 0) throw new Error(`KOOK card lookup error ${result.code}`);
    // Missing or malformed content is retryable, not evidence of successful closure.
    if (typeof result.data?.content !== "string") throw new Error("KookCardContentMissing");
    return cardContainsAction(JSON.parse(result.data.content), buildOrderAcceptAction(orderId, dispatchVersion));
  }

  async sendOrderAssignedNotifications(orderId: string): Promise<NotificationResult[]> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { companion: { include: { companionProfile: true } } }
    });
    if (!order) throw new Error("Order not found");
    if (order.status !== OrderStatus.ASSIGNED || (order.acceptanceDeadline && order.acceptanceDeadline.getTime() <= Date.now())) return [];

    const payload: OrderNotificationData = {
      orderId: order.id,
      dispatchVersion: order.dispatchVersion,
      acceptanceDeadline: order.acceptanceDeadline?.toISOString(),
      game: order.game,
      orderNo: order.orderNo,
      mode: publicServiceLabel(order.priceTier),
      hours: order.hours.toString(),
      totalAmount: order.totalAmount.toString(),
      companionId: order.companionId ?? undefined,
      companionName: order.companion?.companionProfile?.nickname ?? order.companion?.displayName
    };

    const results = await Promise.allSettled([this.sendDiscordOrderNotification(payload), this.sendKookOrderNotification(payload)]);
    return this.toNotificationResults(results);
  }

  async sendOrderDraftDispatchNotifications(draftId: string): Promise<NotificationResult[]> {
    const draft = await this.prisma.orderDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new Error("Order draft not found");
    if (draft.selectedCompanionId) {
      return this.sendOrderDraftSelectedCompanionNotification(draft.id, draft.selectedCompanionId);
    }

    const payload: OrderDraftNotificationData = {
      draftId: draft.id,
      draftNo: draft.draftNo,
      game: draft.game,
      mode: publicServiceLabel(draft.priceTier),
      hours: draft.hours?.toString() ?? null,
      budgetAmount: draft.budgetAmount?.toString() ?? null,
      note: null
    };

    const results = await Promise.allSettled([this.sendDiscordOrderDraftNotification(payload), this.sendKookOrderDraftNotification(payload)]);
    return this.toNotificationResults(results);
  }

  async sendKookChannelText(channelId: string, content: string): Promise<NotificationResult> {
    if (!process.env.KOOK_TOKEN) return this.recordGenericNotificationFailure(BotPlatform.KOOK, { channelId, content }, "KOOK_TOKEN is not configured");

    try {
      const body = await this.postKookMessage("/api/v3/message/create", {
        target_id: channelId,
        type: 9,
        content
      });
      await this.recordGenericBotEvent(BotPlatform.KOOK, BotEventStatus.SENT, { channelId, content }, {
        platformGuildId: process.env.KOOK_GUILD_ID,
        platformChannelId: channelId,
        platformMessageId: body.msg_id
      });
      return { platform: BotPlatform.KOOK, status: BotEventStatus.SENT, messageId: body.msg_id };
    } catch (error) {
      return this.recordGenericNotificationFailure(BotPlatform.KOOK, { channelId, content }, this.errorMessage(error));
    }
  }

  async sendKookDirectMessage(userId: string, content: string): Promise<NotificationResult> {
    if (!process.env.KOOK_TOKEN) return this.recordGenericNotificationFailure(BotPlatform.KOOK, { userId, content }, "KOOK_TOKEN is not configured");

    try {
      const body = await this.postKookMessage("/api/v3/direct-message/create", {
        target_id: userId,
        type: 9,
        content
      });
      await this.recordGenericBotEvent(BotPlatform.KOOK, BotEventStatus.SENT, { userId, content }, {
        platformGuildId: process.env.KOOK_GUILD_ID,
        platformUserId: userId,
        platformMessageId: body.msg_id
      });
      return { platform: BotPlatform.KOOK, status: BotEventStatus.SENT, messageId: body.msg_id };
    } catch (error) {
      return this.recordGenericNotificationFailure(BotPlatform.KOOK, { userId, content }, this.errorMessage(error));
    }
  }

  async sendDiscordChannelText(channelId: string, content: string): Promise<NotificationResult> {
    if (!process.env.DISCORD_TOKEN) {
      return this.recordGenericNotificationFailure(BotPlatform.DISCORD, { channelId, content }, "DISCORD_TOKEN is not configured");
    }

    try {
      const body = await this.postDiscordMessage(channelId, { content });
      await this.recordGenericBotEvent(BotPlatform.DISCORD, BotEventStatus.SENT, { channelId, content }, {
        platformGuildId: body.guild_id,
        platformChannelId: body.channel_id ?? channelId,
        platformMessageId: body.id
      });
      return { platform: BotPlatform.DISCORD, status: BotEventStatus.SENT, messageId: body.id };
    } catch (error) {
      return this.recordGenericNotificationFailure(BotPlatform.DISCORD, { channelId, content }, this.errorMessage(error));
    }
  }

  async sendOrderDraftFailedNotification(draftId: string, _note: string): Promise<NotificationResult[]> {
    const draft = await this.prisma.orderDraft.findUnique({
      where: { id: draftId },
      select: { draftNo: true, sourcePlatform: true, sourceChannelId: true, game: true, priceTier: true }
    });
    if (!draft) return [];

    const content = [
      `May猫饼派单 ${draft.draftNo} 已流单`,
      `游戏：${draft.game}`,
      `模式：${publicServiceLabel(draft.priceTier)}`,
      "具体原因请联系授权客服核对。",
      "后台已取消该派单草稿，客服可重新确认需求后再次发布。"
    ].join("\n");

    const tasks: Array<Promise<NotificationResult>> = [];
    const discordChannelId =
      draft.sourcePlatform === OrderSourcePlatform.DISCORD
        ? draft.sourceChannelId || process.env.DISCORD_AI_DISPATCH_CHANNEL_ID || process.env.DISCORD_DISPATCH_CHANNEL_ID
        : process.env.DISCORD_AI_DISPATCH_CHANNEL_ID || process.env.DISCORD_DISPATCH_CHANNEL_ID;
    const kookChannelId =
      draft.sourcePlatform === OrderSourcePlatform.KOOK
        ? draft.sourceChannelId || process.env.KOOK_AI_DISPATCH_CHANNEL_ID || process.env.KOOK_DISPATCH_CHANNEL_ID
        : process.env.KOOK_AI_DISPATCH_CHANNEL_ID || process.env.KOOK_DISPATCH_CHANNEL_ID;

    if ((draft.sourcePlatform === OrderSourcePlatform.DISCORD || draft.sourcePlatform === OrderSourcePlatform.WEB) && discordChannelId) {
      tasks.push(this.sendDiscordChannelText(discordChannelId, content));
    }
    if ((draft.sourcePlatform === OrderSourcePlatform.KOOK || draft.sourcePlatform === OrderSourcePlatform.WEB) && kookChannelId) {
      tasks.push(this.sendKookChannelText(kookChannelId, content));
    }

    const results = await Promise.allSettled(tasks);
    return results.map((result, index) =>
      result.status === "fulfilled"
        ? result.value
        : {
            platform: index === 0 ? BotPlatform.DISCORD : BotPlatform.KOOK,
            status: BotEventStatus.FAILED,
            error: this.errorMessage(result.reason)
          }
    );
  }

  async sendOrderDraftSelectedCompanionNotification(draftId: string, companionId: string): Promise<NotificationResult[]> {
    const draft = await this.prisma.orderDraft.findUnique({
      where: { id: draftId },
      select: {
        draftNo: true,
        sourcePlatform: true,
        sourceChannelId: true,
        game: true,
        priceTier: true,
        selectedCompanion: {
          select: {
            id: true,
            displayName: true,
            email: true,
            externalAccounts: {
              where: { platform: { in: [BotPlatform.DISCORD, BotPlatform.KOOK] } },
              select: { platform: true, externalUserId: true, displayName: true }
            }
          }
        }
      }
    });
    if (!draft?.selectedCompanion) return [];

    const discordAccount = draft.selectedCompanion.externalAccounts.find((account) => account.platform === BotPlatform.DISCORD);
    const kookAccount = draft.selectedCompanion.externalAccounts.find((account) => account.platform === BotPlatform.KOOK);
    const companionName = draft.selectedCompanion.displayName || draft.selectedCompanion.email;
    const results: NotificationResult[] = [];

    if (draft.sourcePlatform === OrderSourcePlatform.DISCORD || draft.sourcePlatform === OrderSourcePlatform.WEB) {
      const channelId = draft.sourceChannelId || process.env.DISCORD_AI_DISPATCH_CHANNEL_ID || process.env.DISCORD_DISPATCH_CHANNEL_ID;
      if (channelId) {
        const mention = discordAccount?.externalUserId ? `<@${discordAccount.externalUserId}>` : companionName;
        results.push(await this.sendDiscordChannelText(channelId, [
          `May猫饼派单 ${draft.draftNo} 已指定陪玩`,
          `陪玩：${mention}`,
          `游戏：${draft.game}`,
          `模式：${publicServiceLabel(draft.priceTier)}`,
          "请陪玩尽快联系客户确认时间、语音和服务细节。"
        ].join("\n")));
      }
    }

    if (draft.sourcePlatform === OrderSourcePlatform.KOOK || draft.sourcePlatform === OrderSourcePlatform.WEB) {
      const channelId = draft.sourceChannelId || process.env.KOOK_AI_DISPATCH_CHANNEL_ID || process.env.KOOK_DISPATCH_CHANNEL_ID;
      if (channelId) {
        const mention = kookAccount?.externalUserId ? `(met)${kookAccount.externalUserId}(met)` : companionName;
        results.push(await this.sendKookChannelText(channelId, [
          `May猫饼派单 ${draft.draftNo} 已指定陪玩`,
          `陪玩：${mention}`,
          `游戏：${draft.game}`,
          `模式：${publicServiceLabel(draft.priceTier)}`,
          "请陪玩尽快联系客户确认时间、语音和服务细节。"
        ].join("\n")));
      }
    }

    return results;
  }

  async syncCustomerMembershipLevels(userId: string): Promise<NotificationResult[]> {
    const results = await Promise.allSettled([
      this.syncKookCustomerMembershipLevel(userId),
      this.syncDiscordCustomerMembershipLevel(userId)
    ]);

    return results.flatMap((result, index) => {
      if (result.status === "fulfilled") return result.value ? [result.value] : [];
      return [
        {
          platform: index === 0 ? BotPlatform.KOOK : BotPlatform.DISCORD,
          status: BotEventStatus.FAILED,
          error: this.errorMessage(result.reason)
        }
      ];
    });
  }

  async syncKookCustomerMembershipLevel(userId: string): Promise<NotificationResult | null> {
    const token = process.env.KOOK_TOKEN;
    const guildId = process.env.KOOK_GUILD_ID;
    if (!token || !guildId) return null;

    const configuredRoles = getConfiguredKookCustomerLevelRoles();
    if (configuredRoles.length === 0) return null;

    const externalAccount = await this.prisma.userExternalAccount.findFirst({
      where: {
        userId,
        platform: BotPlatform.KOOK,
        user: { role: UserRole.CUSTOMER }
      },
      select: { externalUserId: true }
    });
    if (!externalAccount) return null;

    const totalRecharge = await this.prisma.rechargeRequest.aggregate({
      where: { customerId: userId, status: ReviewStatus.APPROVED },
      _sum: { amount: true }
    });
    const completedOrderCount = await this.prisma.order.count({
      where: { customerId: userId, status: OrderStatus.COMPLETED }
    });
    const membership = getCustomerMembershipLevel(totalRecharge._sum.amount ?? 0);
    const targetRoleId = configuredRoles.find((item) => item.level === membership.level)?.roleId;
    const customerRoleId = process.env.KOOK_CUSTOMER_ROLE_ID?.trim();
    const noOrderRoleId = process.env.KOOK_CUSTOMER_NO_ORDER_ROLE_ID?.trim();
    if (!targetRoleId && !customerRoleId && !noOrderRoleId) return null;

    for (const role of configuredRoles) {
      if (role.roleId === targetRoleId) continue;
      await this.postKookAction("/api/v3/guild-role/revoke", {
        guild_id: guildId,
        user_id: externalAccount.externalUserId,
        role_id: Number(role.roleId)
      }).catch(() => undefined);
    }

    try {
      if (customerRoleId) {
        await this.postKookAction("/api/v3/guild-role/grant", {
          guild_id: guildId,
          user_id: externalAccount.externalUserId,
          role_id: Number(customerRoleId)
        });
      }

      if (targetRoleId) {
        await this.postKookAction("/api/v3/guild-role/grant", {
          guild_id: guildId,
          user_id: externalAccount.externalUserId,
          role_id: Number(targetRoleId)
        });
      }

      if (noOrderRoleId) {
        await this.postKookAction(completedOrderCount > 0 ? "/api/v3/guild-role/revoke" : "/api/v3/guild-role/grant", {
          guild_id: guildId,
          user_id: externalAccount.externalUserId,
          role_id: Number(noOrderRoleId)
        });
      }

      await this.recordGenericBotEvent(BotPlatform.KOOK, BotEventStatus.SENT, {
        action: "SYNC_CUSTOMER_MEMBERSHIP_LEVEL",
        userId,
        kookUserId: externalAccount.externalUserId,
        level: membership.level,
        roleId: targetRoleId,
        customerRoleId,
        noOrderRoleId,
        completedOrderCount
      } as unknown as Prisma.InputJsonValue, {
        platformGuildId: guildId,
        platformUserId: externalAccount.externalUserId
      });
      return { platform: BotPlatform.KOOK, status: BotEventStatus.SENT };
    } catch (error) {
      return this.recordGenericNotificationFailure(BotPlatform.KOOK, {
        action: "SYNC_CUSTOMER_MEMBERSHIP_LEVEL",
        userId,
        kookUserId: externalAccount.externalUserId,
        level: membership.level,
        roleId: targetRoleId
      } as unknown as Prisma.InputJsonValue, this.errorMessage(error));
    }
  }

  async syncDiscordCustomerMembershipLevel(userId: string): Promise<NotificationResult | null> {
    const token = process.env.DISCORD_TOKEN;
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!token || !guildId) return null;

    const configuredRoles = getConfiguredDiscordCustomerLevelRoles();
    if (configuredRoles.length === 0) return null;

    const externalAccount = await this.prisma.userExternalAccount.findFirst({
      where: {
        userId,
        platform: BotPlatform.DISCORD,
        user: { role: UserRole.CUSTOMER }
      },
      select: { externalUserId: true }
    });
    if (!externalAccount) return null;

    const totalRecharge = await this.prisma.rechargeRequest.aggregate({
      where: { customerId: userId, status: ReviewStatus.APPROVED },
      _sum: { amount: true }
    });
    const completedOrderCount = await this.prisma.order.count({
      where: { customerId: userId, status: OrderStatus.COMPLETED }
    });
    const membership = getCustomerMembershipLevel(totalRecharge._sum.amount ?? 0);
    const targetRoleId = configuredRoles.find((item) => item.level === membership.level)?.roleId;
    const customerRoleId = process.env.DISCORD_CUSTOMER_ROLE_ID?.trim();
    const noOrderRoleId = process.env.DISCORD_CUSTOMER_NO_ORDER_ROLE_ID?.trim();
    if (!targetRoleId && !customerRoleId && !noOrderRoleId) return null;

    for (const role of configuredRoles) {
      if (role.roleId === targetRoleId) continue;
      await this.putOrDeleteDiscordRole("DELETE", guildId, externalAccount.externalUserId, role.roleId).catch(() => undefined);
    }

    try {
      if (customerRoleId) {
        await this.putOrDeleteDiscordRole("PUT", guildId, externalAccount.externalUserId, customerRoleId);
      }

      if (targetRoleId) {
        await this.putOrDeleteDiscordRole("PUT", guildId, externalAccount.externalUserId, targetRoleId);
      }

      if (noOrderRoleId) {
        await this.putOrDeleteDiscordRole(completedOrderCount > 0 ? "DELETE" : "PUT", guildId, externalAccount.externalUserId, noOrderRoleId);
      }

      await this.recordGenericBotEvent(BotPlatform.DISCORD, BotEventStatus.SENT, {
        action: "SYNC_CUSTOMER_MEMBERSHIP_LEVEL",
        userId,
        discordUserId: externalAccount.externalUserId,
        level: membership.level,
        roleId: targetRoleId,
        customerRoleId,
        noOrderRoleId,
        completedOrderCount
      } as unknown as Prisma.InputJsonValue, {
        platformGuildId: guildId,
        platformUserId: externalAccount.externalUserId
      });
      return { platform: BotPlatform.DISCORD, status: BotEventStatus.SENT };
    } catch (error) {
      return this.recordGenericNotificationFailure(BotPlatform.DISCORD, {
        action: "SYNC_CUSTOMER_MEMBERSHIP_LEVEL",
        userId,
        discordUserId: externalAccount.externalUserId,
        level: membership.level,
        roleId: targetRoleId
      } as unknown as Prisma.InputJsonValue, this.errorMessage(error));
    }
  }

  private async sendDiscordOrderNotification(payload: OrderNotificationData): Promise<NotificationResult> {
    const token = process.env.DISCORD_TOKEN;
    const channelId = process.env.DISCORD_ORDER_CHANNEL_ID;
    if (!token || !channelId) return this.recordNotificationFailure(BotPlatform.DISCORD, payload, "Discord order notification is not configured");

    try {
      const body = await this.postDiscordMessage(channelId, {
          content: payload.companionId ? "May\u732b\u997c\u8ba2\u5355\u5df2\u6307\u5b9a\u966a\u73a9" : "May\u732b\u997c\u65b0\u8ba2\u5355\u5f85\u63a5\u5355",
          embeds: [
            {
              title: `订单 ${payload.orderNo}`,
              fields: [
                { name: "游戏", value: payload.game, inline: true },
                { name: "模式", value: payload.mode, inline: true },
                { name: "时长", value: `${payload.hours} 小时`, inline: true },
                { name: "金额", value: payload.totalAmount, inline: true },
                { name: "陪玩", value: payload.companionName ?? "开放抢单", inline: true },
                { name: "接单期限", value: payload.acceptanceDeadline ?? "未设置", inline: false },
                { name: "拒接", value: "指定陪玩可到陪玩端填写拒接原因，退回客服待办。", inline: false }
              ]
            }
          ],
          allowed_mentions: { parse: [] },
          components: [
                {
                  type: 1,
                  components: [{ type: 2, style: 1, label: "\u63a5\u5355", custom_id: buildOrderAcceptAction(payload.orderId, payload.dispatchVersion) }]
                }
              ]
        }, `order-notice:${payload.orderId}:${payload.companionId || "unassigned"}${payload.dispatchVersion ? `:v${payload.dispatchVersion}` : ""}`);
      await this.recordBotEvent(BotPlatform.DISCORD, BotEventStatus.SENT, payload, {
        platformGuildId: body.guild_id,
        platformChannelId: body.channel_id ?? channelId,
        platformMessageId: body.id
      });
      return { platform: BotPlatform.DISCORD, status: BotEventStatus.SENT, messageId: body.id };
    } catch (error) {
      return this.recordNotificationFailure(BotPlatform.DISCORD, payload, this.errorMessage(error));
    }
  }

  private async sendDiscordOrderDraftNotification(payload: OrderDraftNotificationData): Promise<NotificationResult> {
    const sent = await this.prisma.botEvent.findFirst({ where: { platform: BotPlatform.DISCORD, status: BotEventStatus.SENT, type: BotEventType.ADMIN_ALERT_SENT, payload: { path: ["draftId"], equals: payload.draftId } } });
    if (sent) return { platform: BotPlatform.DISCORD, status: BotEventStatus.SENT, messageId: sent.platformMessageId ?? undefined };
    const token = process.env.DISCORD_TOKEN;
    const channelId = process.env.DISCORD_AI_DISPATCH_CHANNEL_ID || process.env.DISCORD_DISPATCH_CHANNEL_ID || process.env.DISCORD_ORDER_CHANNEL_ID;
    if (!token || !channelId) return this.recordDraftNotificationFailure(BotPlatform.DISCORD, payload, "Discord dispatch notification is not configured");

    const roleMentions = this.buildDiscordDraftRoleMentions(payload);
    try {
      const body = await this.postDiscordMessage(channelId, {
          content: [roleMentions.content, "May猫饼平台招募：符合标签的陪玩可报名，客户会从报名里选择"].filter(Boolean).join("\n"),
          allowed_mentions: { parse: [], roles: roleMentions.roleIds },
          embeds: [
            {
              title: `平台招募 ${payload.draftNo}`,
              fields: [
                { name: "游戏", value: payload.game, inline: true },
                { name: "模式", value: payload.mode, inline: true },
                { name: "时长", value: payload.hours ? `${payload.hours} 小时` : "待确认", inline: true },
                { name: "预算", value: payload.budgetAmount ? `¥${payload.budgetAmount}` : "待确认", inline: true },
                { name: "陪玩报名", value: `直接发送：报名 ${payload.draftNo}。备注选填；也可在陪玩端报名。按钮仅查看报名方式。报名不等于正式接单。`, inline: false }
              ]
            }
          ],
          components: [
            {
              type: 1,
              components: [{ type: 2, style: 1, label: "查看报名方式", custom_id: `order-draft.apply.${payload.draftId}` }]
            }
          ]
        }, `draft-dispatch:${payload.draftId}`);
      await this.recordDraftBotEvent(BotPlatform.DISCORD, BotEventStatus.SENT, payload, {
        platformGuildId: body.guild_id,
        platformChannelId: body.channel_id ?? channelId,
        platformMessageId: body.id
      });
      return { platform: BotPlatform.DISCORD, status: BotEventStatus.SENT, messageId: body.id };
    } catch (error) {
      return this.recordDraftNotificationFailure(BotPlatform.DISCORD, payload, this.errorMessage(error));
    }
  }

  private async sendKookOrderNotification(payload: OrderNotificationData): Promise<NotificationResult> {
    const channelId = process.env.KOOK_ORDER_CHANNEL_ID;
    if (!process.env.KOOK_TOKEN || !channelId) return this.recordNotificationFailure(BotPlatform.KOOK, payload, "KOOK order notification is not configured");

    const content = [
      {
        type: "card",
        theme: "primary",
        size: "lg",
        modules: [
          { type: "header", text: { type: "plain-text", content: payload.companionId ? "May\u732b\u997c\u8ba2\u5355\u5df2\u6307\u5b9a\u966a\u73a9" : "May\u732b\u997c\u65b0\u8ba2\u5355\u5f85\u63a5\u5355" } },
          {
            type: "section",
            text: {
              type: "kmarkdown",
              content: [
                `**订单号**：${payload.orderNo}`,
                `**游戏**：${payload.game}`,
                `**模式**：${payload.mode}`,
                `**时长**：${payload.hours} 小时`,
                `**金额**：${payload.totalAmount}`,
                `**接单期限**：${payload.acceptanceDeadline ?? "未设置"}`,
                "**拒接**：指定陪玩可到陪玩端填写原因，退回客服待办。",
                payload.companionName ? `**陪玩**：${payload.companionName}` : undefined
              ]
                .filter(Boolean)
                .join("\n")
            }
          },
          {
            type: "action-group",
            elements: [
              { type: "button", theme: "primary", value: buildOrderAcceptAction(payload.orderId, payload.dispatchVersion), click: "return-val", text: { type: "plain-text", content: "\u63a5\u5355" } }
            ]
          }
        ]
      }
    ];

    try {
      const body = await this.postKookMessage("/api/v3/message/create", {
        target_id: channelId,
        type: 10,
        content: JSON.stringify(content)
      }, `order-notice:${payload.orderId}:${payload.companionId || "unassigned"}${payload.dispatchVersion ? `:v${payload.dispatchVersion}` : ""}`);
      await this.recordBotEvent(BotPlatform.KOOK, BotEventStatus.SENT, payload, {
        platformGuildId: process.env.KOOK_GUILD_ID,
        platformChannelId: channelId,
        platformMessageId: body.msg_id
      });
      return { platform: BotPlatform.KOOK, status: BotEventStatus.SENT, messageId: body.msg_id };
    } catch (error) {
      return this.recordNotificationFailure(BotPlatform.KOOK, payload, this.errorMessage(error));
    }
  }

  private async sendKookOrderDraftNotification(payload: OrderDraftNotificationData): Promise<NotificationResult> {
    const sent = await this.prisma.botEvent.findFirst({ where: { platform: BotPlatform.KOOK, status: BotEventStatus.SENT, type: BotEventType.ADMIN_ALERT_SENT, payload: { path: ["draftId"], equals: payload.draftId } } });
    if (sent) return { platform: BotPlatform.KOOK, status: BotEventStatus.SENT, messageId: sent.platformMessageId ?? undefined };
    const channelId = process.env.KOOK_AI_DISPATCH_CHANNEL_ID || process.env.KOOK_DISPATCH_CHANNEL_ID || process.env.KOOK_ORDER_CHANNEL_ID;
    if (!process.env.KOOK_TOKEN || !channelId) return this.recordDraftNotificationFailure(BotPlatform.KOOK, payload, "KOOK dispatch notification is not configured");

    const roleMentions = this.buildKookDraftRoleMentions(payload);
    const content = [
      {
        type: "card",
        theme: "primary",
        size: "lg",
        modules: [
          { type: "header", text: { type: "plain-text", content: `May猫饼平台招募 ${payload.draftNo}` } },
          {
            type: "section",
            text: {
              type: "kmarkdown",
              content: [
                roleMentions ? `**提醒标签**：${roleMentions}` : undefined,
                `**游戏**：${payload.game}`,
                `**模式**：${payload.mode}`,
                `**时长**：${payload.hours ? `${payload.hours} 小时` : "待确认"}`,
                `**预算**：${payload.budgetAmount ? `¥${payload.budgetAmount}` : "待确认"}`,
                `**陪玩报名**：点击“报名试音”，私聊收到报名回执才算已记录。备注选填；也可发送：报名 ${payload.draftNo}。报名不等于正式接单。`
              ].filter(Boolean).join("\n")
            }
          },
          {
            type: "action-group",
              elements: [{ type: "button", theme: "primary", value: `order-draft.apply.${payload.draftId}`, click: "return-val", text: { type: "plain-text", content: "报名试音" } }]
          }
        ]
      }
    ];

    try {
      const body = await this.postKookMessage("/api/v3/message/create", {
        target_id: channelId,
        type: 10,
        content: JSON.stringify(content)
      }, `draft-dispatch:${payload.draftId}`);
      await this.recordDraftBotEvent(BotPlatform.KOOK, BotEventStatus.SENT, payload, {
        platformGuildId: process.env.KOOK_GUILD_ID,
        platformChannelId: channelId,
        platformMessageId: body.msg_id
      });
      return { platform: BotPlatform.KOOK, status: BotEventStatus.SENT, messageId: body.msg_id };
    } catch (error) {
      return this.recordDraftNotificationFailure(BotPlatform.KOOK, payload, this.errorMessage(error));
    }
  }

  private async postKookMessage(path: string, body: Record<string, unknown>, businessKey?: string) {
    if (path === "/api/v3/message/create" || path === "/api/v3/direct-message/create") {
      const response = await this.deliveries.send(BotPlatform.KOOK, String(body.target_id), path, body as Prisma.InputJsonObject, businessKey);
      return { msg_id: response.msg_id! };
    }
    return this.postKookAction<KookMessageResponse>(path, body);
  }

  private async postDiscordMessage(channelId: string, body: Prisma.InputJsonObject, businessKey?: string) {
    const response = await this.deliveries.send(BotPlatform.DISCORD, channelId, `/channels/${channelId}/messages`, body, businessKey);
    return { ...response, id: response.id! };
  }

  private buildDiscordDraftRoleMentions(payload: OrderDraftNotificationData) {
    const roleIds = [
      this.getGameRoleId(BotPlatform.DISCORD, payload.game),
      ...this.getVoiceRoleIds(BotPlatform.DISCORD, payload.note ?? "")
    ].filter((roleId): roleId is string => Boolean(roleId));

    return {
      roleIds: [...new Set(roleIds)],
      content: [...new Set(roleIds)].map((roleId) => `<@&${roleId}>`).join(" ")
    };
  }

  private buildKookDraftRoleMentions(payload: OrderDraftNotificationData) {
    const roleIds = [
      this.getGameRoleId(BotPlatform.KOOK, payload.game),
      ...this.getVoiceRoleIds(BotPlatform.KOOK, payload.note ?? "")
    ].filter((roleId): roleId is string => Boolean(roleId));

    return [...new Set(roleIds)].map((roleId) => `(rol)${roleId}(rol)`).join(" ");
  }

  private getGameRoleId(platform: BotPlatform, game: string) {
    const tag = dispatchRoleTags.find((item) => item.game === game);
    if (!tag) return undefined;
    const envVar = platform === BotPlatform.DISCORD ? tag.discordEnv : tag.kookEnv;
    return process.env[envVar]?.trim();
  }

  private getVoiceRoleIds(platform: BotPlatform, note: string) {
    const normalized = note.toLowerCase();
    return voiceRoleTags
      .filter((tag) => tag.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())))
      .map((tag) => process.env[platform === BotPlatform.DISCORD ? tag.discordEnv : tag.kookEnv]?.trim())
      .filter((roleId): roleId is string => Boolean(roleId));
  }

  private async postKookAction<T = unknown>(path: string, body: Record<string, unknown>) {
    const response = await fetch(`https://www.kookapp.cn${path}`, {
      method: "POST",
      headers: { Authorization: `Bot ${process.env.KOOK_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`KOOK API HTTP ${response.status}`);
    const result = (await response.json()) as { code: number; message: string; data?: T };
    if (result.code !== 0) throw new Error(`KOOK API error ${result.code}: ${result.message}`);
    return result.data as T;
  }

  private async putOrDeleteDiscordRole(method: "PUT" | "DELETE", guildId: string, discordUserId: string, roleId: string) {
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`, {
      method,
      headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Discord role API HTTP ${response.status}${text ? `: ${text}` : ""}`);
    }
  }

  private toNotificationResults(results: PromiseSettledResult<NotificationResult>[]) {
    return results.map((result, index) => {
      const platform = index === 0 ? BotPlatform.DISCORD : BotPlatform.KOOK;
      if (result.status === "fulfilled") return result.value;
      return {
        platform,
        status: BotEventStatus.FAILED,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason)
      };
    });
  }

  private async recordNotificationFailure(platform: BotPlatform, payload: OrderNotificationData, error: string): Promise<NotificationResult> {
    const status = error.startsWith("NotificationOutcomeUnknown:") ? BotEventStatus.UNKNOWN : BotEventStatus.FAILED;
    await this.recordBotEvent(platform, status, payload, { error });
    return { platform, status, error };
  }

  private async recordBotEvent(platform: BotPlatform, status: BotEventStatus, payload: OrderNotificationData, extra: Partial<Prisma.BotEventCreateInput> = {}) {
    await this.prisma.botEvent.create({
      data: {
        platform,
        status,
        type: BotEventType.ORDER_NOTIFICATION_SENT,
        orderId: payload.orderId,
        payload: payload as unknown as Prisma.InputJsonValue,
        ...extra
      }
    });
  }

  private async recordDraftNotificationFailure(platform: BotPlatform, payload: OrderDraftNotificationData, error: string): Promise<NotificationResult> {
    const status = error.startsWith("NotificationOutcomeUnknown:") ? BotEventStatus.UNKNOWN : BotEventStatus.FAILED;
    await this.recordDraftBotEvent(platform, status, payload, { error });
    return { platform, status, error };
  }

  private async recordDraftBotEvent(platform: BotPlatform, status: BotEventStatus, payload: OrderDraftNotificationData, extra: Partial<Prisma.BotEventCreateInput> = {}) {
    await this.prisma.botEvent.create({
      data: {
        platform,
        status,
        type: BotEventType.ADMIN_ALERT_SENT,
        payload: payload as unknown as Prisma.InputJsonValue,
        ...extra
      }
    });
  }

  private async recordGenericNotificationFailure(platform: BotPlatform, payload: Prisma.InputJsonValue, error: string): Promise<NotificationResult> {
    const status = error.startsWith("NotificationOutcomeUnknown:") ? BotEventStatus.UNKNOWN : BotEventStatus.FAILED;
    await this.recordGenericBotEvent(platform, status, payload, { error });
    return { platform, status, error };
  }

  private async recordGenericBotEvent(platform: BotPlatform, status: BotEventStatus, payload: Prisma.InputJsonValue, extra: Partial<Prisma.BotEventCreateInput> = {}) {
    await this.prisma.botEvent.create({
      data: {
        platform,
        status,
        type: BotEventType.ADMIN_ALERT_SENT,
        payload,
        ...extra
      }
    });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
