import type { BotAdapter, OrderNotificationPayload, UserRole } from "@dfc/shared";

const KOOK_API_BASE_URL = "https://www.kookapp.cn";

interface KookApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

interface KookMessageResponse {
  msg_id: string;
  msg_timestamp: number;
  nonce: string;
}

interface KookChannelResponse {
  id: string;
  guild_id: string;
  name: string;
  type: number;
}

export class KookAdapter implements BotAdapter {
  constructor(
    private readonly token = process.env.KOOK_TOKEN,
    private readonly orderChannelId = process.env.KOOK_ORDER_CHANNEL_ID,
    private readonly adminChannelId = process.env.KOOK_ADMIN_CHANNEL_ID,
    private readonly guildId = process.env.KOOK_GUILD_ID,
    private readonly voiceCategoryId = process.env.KOOK_VOICE_CATEGORY_ID
  ) {
    if (!token) throw new Error("KOOK_TOKEN is required");
  }

  async sendOrderNotification(order: OrderNotificationPayload): Promise<void> {
    if (!this.orderChannelId) throw new Error("KOOK_ORDER_CHANNEL_ID is required");

    const content = [
      {
        type: "card",
        theme: "primary",
        size: "lg",
        modules: [
          {
            type: "header",
            text: {
              type: "plain-text",
              content: "DFC 新订单待接单"
            }
          },
          {
            type: "section",
            text: {
              type: "kmarkdown",
              content: [
                `**订单号**：${order.orderNo}`,
                `**模式**：${order.mode}`,
                `**时长**：${order.hours} 小时`,
                `**金额**：${order.totalAmount}`,
                order.companionName ? `**陪玩**：${order.companionName}` : undefined
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
                value: `order.accept.${order.orderId}`,
                click: "return-val",
                text: {
                  type: "plain-text",
                  content: "接单"
                }
              }
            ]
          }
        ]
      }
    ];

    await this.createChannelMessage(this.orderChannelId, JSON.stringify(content), 10);
  }

  async sendAdminAlert(message: string): Promise<void> {
    if (!this.adminChannelId) throw new Error("KOOK_ADMIN_CHANNEL_ID is required");
    await this.createChannelMessage(this.adminChannelId, message, 9);
  }

  async sendDirectMessage(userId: string, message: string): Promise<void> {
    await this.post<KookMessageResponse>("/api/v3/direct-message/create", {
      target_id: userId,
      type: 9,
      content: message
    });
  }

  async createVoiceRoom(orderId: string): Promise<string> {
    if (!this.guildId) throw new Error("KOOK_GUILD_ID is required");

    const channel = await this.post<KookChannelResponse>("/api/v3/channel/create", {
      guild_id: this.guildId,
      name: `DFC-${orderId}`,
      parent_id: this.voiceCategoryId,
      type: 2,
      limit_amount: 5,
      voice_quality: "2"
    });

    return channel.id;
  }

  async syncRole(userId: string, role: UserRole): Promise<void> {
    if (!this.guildId) throw new Error("KOOK_GUILD_ID is required");

    const roleId = this.resolveKookRoleId(role);
    if (!roleId) return;

    await this.post("/api/v3/guild-role/grant", {
      guild_id: this.guildId,
      user_id: userId,
      role_id: Number(roleId)
    });
  }

  private async createChannelMessage(targetId: string, content: string, type: 9 | 10): Promise<void> {
    await this.post<KookMessageResponse>("/api/v3/message/create", {
      target_id: targetId,
      type,
      content
    });
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${KOOK_API_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${this.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`KOOK API HTTP ${response.status}`);
    }

    const result = (await response.json()) as KookApiResponse<T>;

    if (result.code !== 0) {
      throw new Error(`KOOK API error ${result.code}: ${result.message}`);
    }

    return result.data;
  }

  private resolveKookRoleId(role: UserRole | string): string | undefined {
    switch (role) {
      case "CUSTOMER":
        return process.env.KOOK_CUSTOMER_ROLE_ID;
      case "COMPANION":
        return process.env.KOOK_COMPANION_ROLE_ID;
      case "ADMIN":
        return process.env.KOOK_ADMIN_ROLE_ID;
      case "SUPER_ADMIN":
        return process.env.KOOK_SUPER_ADMIN_ROLE_ID ?? process.env.KOOK_ADMIN_ROLE_ID;
      default:
        return undefined;
    }
  }
}
