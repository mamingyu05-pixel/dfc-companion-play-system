import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { KookWebhookController } from "./kook-webhook.controller";
import { OrdersModule } from "../orders/orders.module";
import { SupportModule } from "../support/support.module";

@Module({
  imports: [AuthModule, OrdersModule, SupportModule],
  controllers: [KookWebhookController]
})
export class KookModule {}
