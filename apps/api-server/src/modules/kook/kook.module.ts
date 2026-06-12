import { Module } from "@nestjs/common";
import { KookWebhookController } from "./kook-webhook.controller";
import { OrdersModule } from "../orders/orders.module";
import { SupportModule } from "../support/support.module";

@Module({
  imports: [OrdersModule, SupportModule],
  controllers: [KookWebhookController]
})
export class KookModule {}
