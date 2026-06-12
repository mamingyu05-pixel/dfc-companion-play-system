import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { BotModule } from "../bot/bot.module";
import { PrismaModule } from "../prisma/prisma.module";
import { OrdersController } from "./orders.controller";
import { OrderDraftsService } from "./order-drafts.service";
import { OrdersService } from "./orders.service";

@Module({
  imports: [AuthModule, BotModule, PrismaModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderDraftsService],
  exports: [OrdersService, OrderDraftsService]
})
export class OrdersModule {}
