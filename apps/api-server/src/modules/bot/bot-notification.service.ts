import { Injectable } from "@nestjs/common";
import { BotEventStatus, BotEventType, BotPlatform, type Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

interface OrderNotificationData {
  orderId: string;
  orderNo: string;
  mode: string;
  hours: string;
  totalAmount: string;
  companionName?: string;
}

interface NotificationResult {
  platform: BotPlatform;
  status: BotEventStatus;
  messageId?: string;
  error?: string;
}

@Injectable()
export class BotNotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async sendOrderAssignedNotifications(orderId: string): Promise<NotificationResult[]> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        companion: {
          include: { companionProfile: true }
        }
      }
    });

    if (!order) {
      throw new Error("Order not found");
    }

    const payload: OrderNotificationData = {
      orderId: order.id,
      orderNo: order.orderNo,
      mode: order.mode,
      hours: order.hours.toString(),
      totalAmount: order.totalAmount.toString(),
      companionName: order.companion?.companionProfile?.nickname ?? order.companion?.displayName
    };

    const results = await Promise.allSettled([
      this.sendDiscordOrderNotification(payload),
      this.sendKookOrderNotification(payload)
    ]);

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

  private async sendDiscordOrderNotification(payload: OrderNotificationData): Promise<NotificationResult> {
    const token = process.env.DISCORD_TOKEN;
    const channelId = process.env.DISCORD_ORDER_CHANNEL_ID;

    if (!token || !channelId) {
      return this.recordNotificationFailure(BotPlatform.DISCORD, payload, "Discord order notification is not configured");
    }

    try {
      const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json"
        },
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
              components: [
                {
                  type: 2,
                  style: 1,
                  label: "接单",
                  custom_id: `order.accept.${payload.orderId}`
                }
              ]
            }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`Discord API HTTP ${response.status}`);
      }

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

  private async sendKookOrderNotification(payload: OrderNotificationData): Promise<NotificationResult> {
    const token = process.env.KOOK_TOKEN;
    const channelId = process.env.KOOK_ORDER_CHANNEL_ID;

    if (!token || !channelId) {
      return this.recordNotificationFailure(BotPlatform.KOOK, payload, "KOOK order notification is not configured");
    }

    const content = [
      {
        type: "card",
        theme: "primary",
        size: "lg",
        modules: [
          {
            type: "header",
            text: { type: "plain-text", content: "May猫饼新订单待接单" }
          },
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
            elements: [
              {
                type: "button",
                theme: "primary",
                value: `order.accept.${payload.orderId}`,
                click: "return-val",
                text: { type: "plain-text", content: "接单" }
              }
            ]
          }
        ]
      }
    ];

    try {
      const response = await fetch("https://www.kookapp.cn/api/v3/message/create", {
        method: "POST",
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          target_id: channelId,
          type: 10,
          content: JSON.stringify(content)
        })
      });

      if (!response.ok) {
        throw new Error(`KOOK API HTTP ${response.status}`);
      }

      const body = (await response.json()) as { code: number; message: string; data?: { msg_id: string } };
      if (body.code !== 0 || !body.data) {
        throw new Error(`KOOK API error ${body.code}: ${body.message}`);
      }

      await this.recordBotEvent(BotPlatform.KOOK, BotEventStatus.SENT, payload, {
        platformGuildId: process.env.KOOK_GUILD_ID,
        platformChannelId: channelId,
        platformMessageId: body.data.msg_id
      });

      return { platform: BotPlatform.KOOK, status: BotEventStatus.SENT, messageId: body.data.msg_id };
    } catch (error) {
      return this.recordNotificationFailure(BotPlatform.KOOK, payload, this.errorMessage(error));
    }
  }

  private async recordNotificationFailure(
    platform: BotPlatform,
    payload: OrderNotificationData,
    error: string
  ): Promise<NotificationResult> {
    await this.recordBotEvent(platform, BotEventStatus.FAILED, payload, { error });
    return { platform, status: BotEventStatus.FAILED, error };
  }

  private async recordBotEvent(
    platform: BotPlatform,
    status: BotEventStatus,
    payload: OrderNotificationData,
    extra: Partial<Prisma.BotEventCreateInput> = {}
  ) {
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

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
