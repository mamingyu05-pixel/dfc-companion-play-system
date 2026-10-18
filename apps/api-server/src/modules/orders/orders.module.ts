import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { BotModule } from "../bot/bot.module";
import { PrismaModule } from "../prisma/prisma.module";
import { OrdersController } from "./orders.controller";
import { OrderDraftsService } from "./order-drafts.service";
import { OrdersService } from "./orders.service";
import { OrderReviewsService } from "./order-reviews.service";
import { OrderReviewsController } from "./order-reviews.controller";

@Module({
  imports: [AuthModule, BotModule, PrismaModule],
  controllers: [OrdersController, OrderReviewsController],
  providers: [OrdersService, OrderDraftsService, OrderReviewsService],
  exports: [OrdersService, OrderDraftsService]
})
export class OrdersModule {}
