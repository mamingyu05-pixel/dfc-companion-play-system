import { Module } from "@nestjs/common";
import { KookWebhookController } from "./kook-webhook.controller";
import { OrdersModule } from "../orders/orders.module";

@Module({
  imports: [OrdersModule],
  controllers: [KookWebhookController]
})
export class KookModule {}
