import { Module } from "@nestjs/common";
import { DiscordWebhookController } from "./discord-webhook.controller";
import { OrdersModule } from "../orders/orders.module";

@Module({
  imports: [OrdersModule],
  controllers: [DiscordWebhookController]
})
export class DiscordModule {}
