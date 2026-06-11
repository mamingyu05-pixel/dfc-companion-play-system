import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { BotPlatform } from "@prisma/client";
import { BotInternalGuard } from "../bot/bot-internal.guard";
import { OrdersService } from "../orders/orders.service";

@Controller("discord")
export class DiscordWebhookController {
  constructor(private readonly orders: OrdersService) {}

  @Post("orders/accept")
  @UseGuards(BotInternalGuard)
  acceptOrder(@Body() body: { orderId: string; companionDiscordId: string; messageId?: string }) {
    return this.orders.acceptOrderFromPlatform(
      BotPlatform.DISCORD,
      body.orderId,
      body.companionDiscordId,
      body.messageId
    );
  }
}
