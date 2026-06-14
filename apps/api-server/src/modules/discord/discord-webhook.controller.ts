import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { BotPlatform, OrderSourcePlatform } from "@prisma/client";
import { BotInternalGuard } from "../bot/bot-internal.guard";
import { OrderDraftsService } from "../orders/order-drafts.service";
import { OrdersService } from "../orders/orders.service";
import { PlatformSupportService } from "../support/platform-support.service";

@Controller("discord")
export class DiscordWebhookController {
  constructor(
    private readonly orders: OrdersService,
    private readonly orderDrafts: OrderDraftsService,
    private readonly platformSupport: PlatformSupportService
  ) {}

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

  @Post("order-drafts/apply")
  @UseGuards(BotInternalGuard)
  applyOrderDraft(@Body() body: { draftId: string; companionDiscordId: string; note?: string; quoteAmount?: string; messageId?: string }) {
    return this.orderDrafts.companionApplyFromPlatform(OrderSourcePlatform.DISCORD, body.draftId, body.companionDiscordId, {
      note: body.note,
      quoteAmount: body.quoteAmount,
      messageId: body.messageId
    });
  }

  @Post("order-drafts/apply-by-draft-no")
  @UseGuards(BotInternalGuard)
  applyOrderDraftByDraftNo(@Body() body: { draftNo: string; companionDiscordId: string; note?: string; quoteAmount?: string; messageId?: string }) {
    return this.orderDrafts.companionApplyFromPlatformByDraftNo(OrderSourcePlatform.DISCORD, body.draftNo, body.companionDiscordId, {
      note: body.note,
      quoteAmount: body.quoteAmount,
      messageId: body.messageId
    });
  }

  @Post("support/messages")
  @UseGuards(BotInternalGuard)
  supportMessage(
    @Body()
    body: {
      discordUserId: string;
      displayName?: string;
      guildId?: string;
      channelId?: string;
      messageId?: string;
      content: string;
      isDirect?: boolean;
    }
  ) {
    return this.platformSupport.handlePlatformMessage({
      platform: BotPlatform.DISCORD,
      platformUserId: body.discordUserId,
      displayName: body.displayName,
      guildId: body.guildId,
      channelId: body.channelId,
      messageId: body.messageId,
      content: body.content,
      isDirect: body.isDirect
    });
  }
}
