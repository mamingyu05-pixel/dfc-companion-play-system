import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminController } from "./admin.controller";
import { CompanionExternalAccountsService } from "./companion-external-accounts.service";
import { OrdersModule } from "../orders/orders.module";
import { PrismaModule } from "../prisma/prisma.module";
import { WalletModule } from "../wallet/wallet.module";
import { OperationsService } from "./operations.service";
import { OperationsController } from "./operations.controller";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsController } from "./analytics.controller";
import { KookMemberImportController } from "./kook-member-import.controller";
import { AdminBatchController } from "./batch.controller";
import { QuickOrderController } from "./quick-order.controller";
import { KookMemberImportService } from "./kook-member-import.service";

@Module({
  imports: [AuthModule, OrdersModule, PrismaModule, WalletModule],
  controllers: [AdminController, OperationsController, AnalyticsController, KookMemberImportController, AdminBatchController, QuickOrderController],
  providers: [CompanionExternalAccountsService, OperationsService, AnalyticsService, KookMemberImportService]
})
export class AdminModule {}
