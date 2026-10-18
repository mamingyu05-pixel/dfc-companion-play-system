import { Global, Module } from "@nestjs/common";
import { BotInternalGuard } from "./bot-internal.guard";
import { BotNotificationService } from "./bot-notification.service";
import { PrismaModule } from "../prisma/prisma.module";
import { IntegrationJobsService } from "./integration-jobs.service";
import { NotificationDeliveryService } from "./notification-delivery.service";

@Global()
@Module({
  imports: [PrismaModule],
  providers: [BotInternalGuard, BotNotificationService, IntegrationJobsService, NotificationDeliveryService],
  exports: [BotInternalGuard, BotNotificationService, IntegrationJobsService, NotificationDeliveryService]
})
export class BotModule {}
