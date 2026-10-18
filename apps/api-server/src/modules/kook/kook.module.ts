import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { KookWebhookController } from "./kook-webhook.controller";
import { OrdersModule } from "../orders/orders.module";
import { SupportModule } from "../support/support.module";
import { KookOrderFlowService } from "./kook-order-flow.service";
import { KOOK_FLOW_PORT, KookPrivateFlowPort } from "./kook-flow-port";

@Module({
  imports: [AuthModule, OrdersModule, SupportModule],
  controllers: [KookWebhookController],
  providers: [KookOrderFlowService, { provide: KOOK_FLOW_PORT, useClass: KookPrivateFlowPort }]
})
export class KookModule {}
