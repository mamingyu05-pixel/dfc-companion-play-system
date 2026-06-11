import { BadRequestException, Body, Controller, Post, UnauthorizedException, UseGuards } from "@nestjs/common";
import { BotPlatform } from "@prisma/client";
import { BotInternalGuard } from "../bot/bot-internal.guard";
import { OrdersService } from "../orders/orders.service";

@Controller("kook")
export class KookWebhookController {
  constructor(private readonly orders: OrdersService) {}

  @Post("orders/accept")
  @UseGuards(BotInternalGuard)
  acceptOrder(@Body() body: { orderId: string; kookUserId: string; messageId?: string }) {
    return this.orders.acceptOrderFromPlatform(BotPlatform.KOOK, body.orderId, body.kookUserId, body.messageId);
  }

  @Post("webhook")
  async webhook(@Body() body: KookWebhookBody) {
    const challenge = body.d?.challenge;
    if (challenge) return { challenge };

    const expectedVerifyToken = process.env.KOOK_VERIFY_TOKEN;
    const actualVerifyToken = body.d?.verify_token;

    if (expectedVerifyToken && actualVerifyToken !== expectedVerifyToken) {
      throw new UnauthorizedException("Invalid KOOK verify token");
    }

    const actionValue = this.extractActionValue(body);
    if (!actionValue?.startsWith("order.accept.")) {
      return { ignored: true };
    }

    const orderId = actionValue.replace("order.accept.", "");
    const kookUserId = this.extractKookUserId(body);

    if (!orderId || !kookUserId) {
      throw new BadRequestException("Missing KOOK order accept payload");
    }

    return this.orders.acceptOrderFromPlatform(BotPlatform.KOOK, orderId, kookUserId, this.extractMessageId(body));
  }

  private extractActionValue(body: KookWebhookBody): string | undefined {
    return (
      body.d?.extra?.body?.value ??
      body.d?.extra?.body?.data?.value ??
      body.d?.extra?.value ??
      body.d?.content
    );
  }

  private extractKookUserId(body: KookWebhookBody): string | undefined {
    return body.d?.author_id ?? body.d?.extra?.user_id ?? body.d?.extra?.body?.user_id;
  }

  private extractMessageId(body: KookWebhookBody): string | undefined {
    return body.d?.msg_id ?? body.d?.extra?.body?.msg_id;
  }
}

interface KookWebhookBody {
  s?: number;
  d?: {
    type?: number;
    channel_type?: string;
    challenge?: string;
    verify_token?: string;
    author_id?: string;
    msg_id?: string;
    content?: string;
    extra?: {
      value?: string;
      user_id?: string;
      body?: {
        value?: string;
        user_id?: string;
        msg_id?: string;
        data?: {
          value?: string;
        };
      };
    };
  };
}
