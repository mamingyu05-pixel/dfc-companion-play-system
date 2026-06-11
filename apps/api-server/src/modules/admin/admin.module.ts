import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AdminController } from "./admin.controller";
import { CompanionExternalAccountsService } from "./companion-external-accounts.service";
import { OrdersModule } from "../orders/orders.module";
import { PrismaModule } from "../prisma/prisma.module";
import { WalletModule } from "../wallet/wallet.module";

@Module({
  imports: [AuthModule, OrdersModule, PrismaModule, WalletModule],
  controllers: [AdminController],
  providers: [CompanionExternalAccountsService]
})
export class AdminModule {}
