import { Injectable } from "@nestjs/common";
import { BotPlatform } from "@prisma/client";
import { NotificationDeliveryService } from "../bot/notification-delivery.service";
import { PrismaService } from "../prisma/prisma.service";
import { cardContainsAction, FlowCard } from "./kook-flow-card";

// Fixtures replace this port. Business services never invoke fetch or the adapter.
export const KOOK_FLOW_PORT = Symbol("KOOK_FLOW_PORT");
export interface KookFlowPort {
  send(userId: string, card: FlowCard, key: string): Promise<{ messageId?: string }>;
  wasIssuedTo(userId: string, messageId: string, value: string): Promise<boolean>;
  wasIssuedInChannel(channelId: string, messageId: string, value: string): Promise<boolean>;
}

@Injectable()
export class KookPrivateFlowPort implements KookFlowPort {
  constructor(private readonly prisma: PrismaService, private readonly deliveries: NotificationDeliveryService) {}
  async send(userId: string, card: FlowCard, key: string) {
    // Existing durable delivery preserves SENT/UNKNOWN and does not blindly resend.
    const result = await this.deliveries.send(BotPlatform.KOOK, userId, "/api/v3/direct-message/create",
      { target_id: userId, type: 10, content: JSON.stringify(card) }, key);
    return { messageId: result.msg_id };
  }
  async wasIssuedTo(userId: string, messageId: string, value: string) {
    return this.wasIssued(userId, messageId, value, "/api/v3/direct-message/create");
  }
  async wasIssuedInChannel(channelId: string, messageId: string, value: string) {
    return this.wasIssued(channelId, messageId, value, "/api/v3/message/create");
  }
  private async wasIssued(target: string, messageId: string, value: string, path: string) {
    const records = await this.prisma.notificationDelivery.findMany({ where: {
      platform: BotPlatform.KOOK, target, messageId, status: "SENT", path
    }, take: 2, select: { requestBody: true } });
    return records.some(record => {
      const body = record.requestBody as { type?: number; content?: string };
      try { return body.type === 10 && cardContainsAction(JSON.parse(body.content ?? ""), value); } catch { return false; }
    });
  }
}
