import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DiscordWebhookController } from "./discord-webhook.controller";
import { OrdersModule } from "../orders/orders.module";
import { SupportModule } from "../support/support.module";

@Module({
  imports: [AuthModule, OrdersModule, SupportModule],
  controllers: [DiscordWebhookController]
})
export class DiscordModule {}
