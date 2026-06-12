import { BadRequestException, Body, Controller, HttpCode, Post, UnauthorizedException, UseGuards } from "@nestjs/common";
import { BotPlatform, OrderSourcePlatform } from "@prisma/client";
import { BotInternalGuard } from "../bot/bot-internal.guard";
import { BotNotificationService } from "../bot/bot-notification.service";
import { OrderDraftsService } from "../orders/order-drafts.service";
import { OrdersService } from "../orders/orders.service";
import { PlatformSupportService } from "../support/platform-support.service";

@Controller("kook")
export class KookWebhookController {
  constructor(
    private readonly orders: OrdersService,
    private readonly orderDrafts: OrderDraftsService,
    private readonly platformSupport: PlatformSupportService,
    private readonly botNotifications: BotNotificationService
  ) {}

  @Post("orders/accept")
  @UseGuards(BotInternalGuard)
  acceptOrder(@Body() body: { orderId: string; kookUserId: string; messageId?: string }) {
    return this.orders.acceptOrderFromPlatform(BotPlatform.KOOK, body.orderId, body.kookUserId, body.messageId);
  }

  @Post("order-drafts/apply")
  @UseGuards(BotInternalGuard)
  applyOrderDraft(@Body() body: { draftId: string; kookUserId: string; note?: string; quoteAmount?: string; messageId?: string }) {
    return this.orderDrafts.companionApplyFromPlatform(OrderSourcePlatform.KOOK, body.draftId, body.kookUserId, {
      note: body.note,
      quoteAmount: body.quoteAmount,
      messageId: body.messageId
    });
  }

  @Post("webhook")
  @HttpCode(200)
  async webhook(@Body() body: KookWebhookBody) {
    const challenge = this.extractChallenge(body);
    if (challenge) return { challenge };

    const expectedVerifyToken = process.env.KOOK_VERIFY_TOKEN;
    const actualVerifyToken = body.d?.verify_token;

    if (expectedVerifyToken && actualVerifyToken !== expectedVerifyToken) {
      throw new UnauthorizedException("Invalid KOOK verify token");
    }

    const actionValue = this.extractActionValue(body);
    if (actionValue?.startsWith("order-draft.apply.")) {
      const draftId = actionValue.replace("order-draft.apply.", "");
      const kookUserId = this.extractKookUserId(body);
      if (!draftId || !kookUserId) {
        throw new BadRequestException("Missing KOOK order draft apply payload");
      }
      return this.orderDrafts.companionApplyFromPlatform(OrderSourcePlatform.KOOK, draftId, kookUserId, {
        messageId: this.extractMessageId(body)
      });
    }

    if (!actionValue?.startsWith("order.accept.")) {
      return this.handleSupportMessage(body);
    }

    const orderId = actionValue.replace("order.accept.", "");
    const kookUserId = this.extractKookUserId(body);

    if (!orderId || !kookUserId) {
      throw new BadRequestException("Missing KOOK order accept payload");
    }

    return this.orders.acceptOrderFromPlatform(BotPlatform.KOOK, orderId, kookUserId, this.extractMessageId(body));
  }

  @Post("support/messages")
  @UseGuards(BotInternalGuard)
  async supportMessage(
    @Body()
    body: {
      kookUserId: string;
      displayName?: string;
      guildId?: string;
      channelId?: string;
      messageId?: string;
      content: string;
      isDirect?: boolean;
    }
  ) {
    return this.platformSupport.handlePlatformMessage({
      platform: BotPlatform.KOOK,
      platformUserId: body.kookUserId,
      displayName: body.displayName,
      guildId: body.guildId,
      channelId: body.channelId,
      messageId: body.messageId,
      content: body.content,
      isDirect: body.isDirect
    });
  }

  private async handleSupportMessage(body: KookWebhookBody) {
    const content = this.extractContent(body);
    const kookUserId = this.extractKookUserId(body);
    const channelId = this.extractChannelId(body);
    const supportChannelId = process.env.KOOK_SUPPORT_CHANNEL_ID;
    const isDirect = body.d?.channel_type === "PERSON";

    if (!content || !kookUserId) return { ignored: true };
    if (body.d?.extra?.author?.bot) return { ignored: true };
    if (!isDirect && supportChannelId && channelId !== supportChannelId) return { ignored: true };
    if (!isDirect && !supportChannelId) return { ignored: true, reason: "KOOK_SUPPORT_CHANNEL_ID is not configured" };

    const result = await this.platformSupport.handlePlatformMessage({
      platform: BotPlatform.KOOK,
      platformUserId: kookUserId,
      displayName: this.extractAuthorName(body),
      guildId: body.d?.extra?.guild_id ?? process.env.KOOK_GUILD_ID,
      channelId,
      messageId: this.extractMessageId(body),
      content,
      isDirect
    });

    const reply = result.reply;
    const notification = isDirect
      ? await this.botNotifications.sendKookDirectMessage(kookUserId, reply)
      : channelId
        ? await this.botNotifications.sendKookChannelText(channelId, reply)
        : null;

    return { ...result, notification };
  }

  private extractActionValue(body: KookWebhookBody): string | undefined {
    return (
      body.d?.extra?.body?.value ??
      body.d?.extra?.body?.data?.value ??
      body.d?.extra?.value ??
      body.d?.content
    );
  }

  private extractChallenge(body: KookWebhookBody): string | undefined {
    return body.challenge ?? body.d?.challenge ?? body.d?.extra?.challenge;
  }

  private extractKookUserId(body: KookWebhookBody): string | undefined {
    return body.d?.author_id ?? body.d?.extra?.user_id ?? body.d?.extra?.body?.user_id;
  }

  private extractMessageId(body: KookWebhookBody): string | undefined {
    return body.d?.msg_id ?? body.d?.extra?.body?.msg_id;
  }

  private extractChannelId(body: KookWebhookBody): string | undefined {
    return body.d?.target_id ?? body.d?.channel_id ?? body.d?.extra?.channel_id ?? body.d?.extra?.body?.channel_id;
  }

  private extractContent(body: KookWebhookBody): string | undefined {
    return body.d?.content?.trim();
  }

  private extractAuthorName(body: KookWebhookBody): string | undefined {
    return body.d?.extra?.author?.nickname ?? body.d?.extra?.author?.username;
  }
}

interface KookWebhookBody {
  s?: number;
  challenge?: string;
  d?: {
    type?: number;
    channel_type?: string;
    challenge?: string;
    verify_token?: string;
    author_id?: string;
    msg_id?: string;
    target_id?: string;
    channel_id?: string;
    content?: string;
    extra?: {
      challenge?: string;
      value?: string;
      user_id?: string;
      guild_id?: string;
      channel_id?: string;
      author?: {
        username?: string;
        nickname?: string;
        bot?: boolean;
      };
      body?: {
        value?: string;
        user_id?: string;
        msg_id?: string;
        channel_id?: string;
        data?: {
          value?: string;
        };
      };
    };
  };
}
