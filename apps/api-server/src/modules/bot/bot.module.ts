import { Global, Module } from "@nestjs/common";
import { BotInternalGuard } from "./bot-internal.guard";
import { BotNotificationService } from "./bot-notification.service";
import { PrismaModule } from "../prisma/prisma.module";

@Global()
@Module({
  imports: [PrismaModule],
  providers: [BotInternalGuard, BotNotificationService],
  exports: [BotInternalGuard, BotNotificationService]
})
export class BotModule {}
