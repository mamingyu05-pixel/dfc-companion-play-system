import { Module } from "@nestjs/common";
import { DiscordWebhookController } from "./discord-webhook.controller";
import { OrdersModule } from "../orders/orders.module";
import { SupportModule } from "../support/support.module";

@Module({
  imports: [OrdersModule, SupportModule],
  controllers: [DiscordWebhookController]
})
export class DiscordModule {}
