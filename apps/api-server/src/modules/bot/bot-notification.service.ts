import { Injectable } from "@nestjs/common";
import { BotEventStatus, BotEventType, BotPlatform, OrderStatus, ReviewStatus, UserRole, type Prisma } from "@prisma/client";
import { getConfiguredDiscordCustomerLevelRoles, getConfiguredKookCustomerLevelRoles, getCustomerMembershipLevel } from "../customer-membership";
import { PrismaService } from "../prisma/prisma.service";

interface OrderNotificationData {
  orderId: string;
  orderNo: string;
  mode: string;
  hours: string;
  totalAmount: string;
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
  { game: "DELTA_FORCE", label: "三角洲行动组", discordEnv: "DISCORD_GAME_DELTA_FORCE_ROLE_ID", kookEnv: "KOOK_GAME_DELTA_FORCE_ROLE_ID" },
  { game: "LEAGUE_OF_LEGENDS", label: "英雄联盟组", discordEnv: "DISCORD_GAME_LEAGUE_OF_LEGENDS_ROLE_ID", kookEnv: "KOOK_GAME_LEAGUE_OF_LEGENDS_ROLE_ID" },
  { game: "VALORANT", label: "无畏契约组", discordEnv: "DISCORD_GAME_VALORANT_ROLE_ID", kookEnv: "KOOK_GAME_VALORANT_ROLE_ID" },
  { game: "COUNTER_STRIKE_2", label: "CS2组", discordEnv: "DISCORD_GAME_COUNTER_STRIKE_2_ROLE_ID", kookEnv: "KOOK_GAME_COUNTER_STRIKE_2_ROLE_ID" },
  { game: "PUBG", label: "PUBG组", discordEnv: "DISCORD_GAME_PUBG_ROLE_ID", kookEnv: "KOOK_GAME_PUBG_ROLE_ID" },
  { game: "APEX_LEGENDS", label: "Apex组", discordEnv: "DISCORD_GAME_APEX_LEGENDS_ROLE_ID", kookEnv: "KOOK_GAME_APEX_LEGENDS_ROLE_ID" },
  { game: "HONOR_OF_KINGS", label: "王者荣耀组", discordEnv: "DISCORD_GAME_HONOR_OF_KINGS_ROLE_ID", kookEnv: "KOOK_GAME_HONOR_OF_KINGS_ROLE_ID" },
  { game: "PEACEKEEPER_ELITE", label: "和平精英组", discordEnv: "DISCORD_GAME_PEACEKEEPER_ELITE_ROLE_ID", kookEnv: "KOOK_GAME_PEACEKEEPER_ELITE_ROLE_ID" }
] as const;

const voiceRoleTags = [
  { label: "月影声线", discordEnv: "DISCORD_VOICE_MOON_ROLE_ID", kookEnv: "KOOK_VOICE_MOON_ROLE_ID", keywords: ["女", "女生", "女声", "柔和", "甜", "月影"] },
  { label: "曜刃声线", discordEnv: "DISCORD_VOICE_SOLAR_ROLE_ID", kookEnv: "KOOK_VOICE_SOLAR_ROLE_ID", keywords: ["男", "男生", "男声", "沉稳", "低音", "曜刃"] }
] as const;

interface KookMessageResponse {
  msg_id: string;
}

@Injectable()
export class BotNotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async sendOrderAssignedNotifications(orderId: string): Promise<NotificationResult[]> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { companion: { include: { companionProfile: true } } }
    });
    if (!order) throw new Error("Order not found");

    const payload: OrderNotificationData = {
      orderId: order.id,
      orderNo: order.orderNo,
      mode: order.mode,
      hours: order.hours.toString(),
      totalAmount: order.totalAmount.toString(),
      companionName: order.companion?.companionProfile?.nickname ?? order.companion?.displayName
    };

    const results = await Promise.allSettled([this.sendDiscordOrderNotification(payload), this.sendKookOrderNotification(payload)]);
    return this.toNotificationResults(results);
  }

  async sendOrderDraftDispatchNotifications(draftId: string): Promise<NotificationResult[]> {
    const draft = await this.prisma.orderDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new Error("Order draft not found");

    const payload: OrderDraftNotificationData = {
      draftId: draft.id,
      draftNo: draft.draftNo,
      game: draft.game,
      mode: draft.mode,
      hours: draft.hours?.toString() ?? null,
      budgetAmount: draft.budgetAmount?.toString() ?? null,
      note: draft.note
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
      const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "May猫饼新订单待接单",
          embeds: [
            {
              title: `订单 ${payload.orderNo}`,
              fields: [
                { name: "模式", value: payload.mode, inline: true },
                { name: "时长", value: `${payload.hours} 小时`, inline: true },
                { name: "金额", value: payload.totalAmount, inline: true },
                { name: "陪玩", value: payload.companionName ?? "待确认", inline: true }
              ]
            }
          ],
          components: [
            {
              type: 1,
              components: [{ type: 2, style: 1, label: "接单", custom_id: `order.accept.${payload.orderId}` }]
            }
          ]
        })
      });
      if (!response.ok) throw new Error(`Discord API HTTP ${response.status}`);
      const body = (await response.json()) as { id: string; guild_id?: string; channel_id?: string };
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
    const token = process.env.DISCORD_TOKEN;
    const channelId = process.env.DISCORD_AI_DISPATCH_CHANNEL_ID || process.env.DISCORD_DISPATCH_CHANNEL_ID || process.env.DISCORD_ORDER_CHANNEL_ID;
    if (!token || !channelId) return this.recordDraftNotificationFailure(BotPlatform.DISCORD, payload, "Discord dispatch notification is not configured");

    const roleMentions = this.buildDiscordDraftRoleMentions(payload);
    try {
      const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          content: [roleMentions.content, "May猫饼 AI 派单，有空的陪玩可以报名"].filter(Boolean).join("\n"),
          allowed_mentions: { parse: [], roles: roleMentions.roleIds },
          embeds: [
            {
              title: `AI 派单 ${payload.draftNo}`,
              fields: [
                { name: "游戏", value: payload.game, inline: true },
                { name: "模式", value: payload.mode, inline: true },
                { name: "时长", value: payload.hours ? `${payload.hours} 小时` : "待确认", inline: true },
                { name: "预算", value: payload.budgetAmount ? `¥${payload.budgetAmount}` : "待确认", inline: true },
                { name: "需求", value: payload.note?.slice(0, 900) || "无", inline: false },
                { name: "陪玩报名", value: `点击按钮填写，或发送：报名 ${payload.draftNo} 段位/水平/报价/可服务时间/性格优势/是否可试音`, inline: false }
              ]
            }
          ],
          components: [
            {
              type: 1,
              components: [{ type: 2, style: 1, label: "我要报名", custom_id: `order-draft.apply.${payload.draftId}` }]
            }
          ]
        })
      });
      if (!response.ok) throw new Error(`Discord API HTTP ${response.status}`);
      const body = (await response.json()) as { id: string; guild_id?: string; channel_id?: string };
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
          { type: "header", text: { type: "plain-text", content: "May猫饼新订单待接单" } },
          {
            type: "section",
            text: {
              type: "kmarkdown",
              content: [
                `**订单号**：${payload.orderNo}`,
                `**模式**：${payload.mode}`,
                `**时长**：${payload.hours} 小时`,
                `**金额**：${payload.totalAmount}`,
                payload.companionName ? `**陪玩**：${payload.companionName}` : undefined
              ]
                .filter(Boolean)
                .join("\n")
            }
          },
          {
            type: "action-group",
            elements: [{ type: "button", theme: "primary", value: `order.accept.${payload.orderId}`, click: "return-val", text: { type: "plain-text", content: "接单" } }]
          }
        ]
      }
    ];

    try {
      const body = await this.postKookMessage("/api/v3/message/create", {
        target_id: channelId,
        type: 10,
        content: JSON.stringify(content)
      });
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
    const channelId = process.env.KOOK_AI_DISPATCH_CHANNEL_ID || process.env.KOOK_DISPATCH_CHANNEL_ID || process.env.KOOK_ORDER_CHANNEL_ID;
    if (!process.env.KOOK_TOKEN || !channelId) return this.recordDraftNotificationFailure(BotPlatform.KOOK, payload, "KOOK dispatch notification is not configured");

    const roleMentions = this.buildKookDraftRoleMentions(payload);
    const content = [
      {
        type: "card",
        theme: "primary",
        size: "lg",
        modules: [
          { type: "header", text: { type: "plain-text", content: `May猫饼 AI 派单 ${payload.draftNo}` } },
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
                `**需求**：${payload.note || "无"}`,
                `**陪玩报名**：点击按钮后，建议继续发送：报名 ${payload.draftNo} 段位/水平/报价/可服务时间/性格优势/是否可试音`
              ].filter(Boolean).join("\n")
            }
          },
          {
            type: "action-group",
            elements: [{ type: "button", theme: "primary", value: `order-draft.apply.${payload.draftId}`, click: "return-val", text: { type: "plain-text", content: "我要报名" } }]
          }
        ]
      }
    ];

    try {
      const body = await this.postKookMessage("/api/v3/message/create", {
        target_id: channelId,
        type: 10,
        content: JSON.stringify(content)
      });
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

  private async postKookMessage(path: string, body: Record<string, unknown>) {
    return this.postKookAction<KookMessageResponse>(path, body);
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
    await this.recordBotEvent(platform, BotEventStatus.FAILED, payload, { error });
    return { platform, status: BotEventStatus.FAILED, error };
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
    await this.recordDraftBotEvent(platform, BotEventStatus.FAILED, payload, { error });
    return { platform, status: BotEventStatus.FAILED, error };
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
    await this.recordGenericBotEvent(platform, BotEventStatus.FAILED, payload, { error });
    return { platform, status: BotEventStatus.FAILED, error };
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
