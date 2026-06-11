import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { CompanionExternalAccountsService } from "./companion-external-accounts.service";
import { OrdersModule } from "../orders/orders.module";

@Module({
  imports: [OrdersModule],
  controllers: [AdminController],
  providers: [CompanionExternalAccountsService]
})
export class AdminModule {}
