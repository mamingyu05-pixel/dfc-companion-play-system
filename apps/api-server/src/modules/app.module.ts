import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { AdminModule } from "./admin/admin.module";
import { OrdersModule } from "./orders/orders.module";
import { WalletModule } from "./wallet/wallet.module";
import { DiscordModule } from "./discord/discord.module";
import { KookModule } from "./kook/kook.module";
import { PrismaModule } from "./prisma/prisma.module";
import { BotModule } from "./bot/bot.module";
import { ComplaintsModule } from "./complaints/complaints.module";
import { SupportModule } from "./support/support.module";
import { UploadsModule } from "./uploads/uploads.module";

@Module({
  imports: [PrismaModule, BotModule, AuthModule, AdminModule, OrdersModule, WalletModule, DiscordModule, KookModule, ComplaintsModule, SupportModule, UploadsModule]
})
export class AppModule {}
