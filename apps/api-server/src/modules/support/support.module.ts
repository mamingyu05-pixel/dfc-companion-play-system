import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { OrdersModule } from "../orders/orders.module";
import { PrismaModule } from "../prisma/prisma.module";
import { PlatformSupportService } from "./platform-support.service";
import { SupportController } from "./support.controller";

@Module({
  imports: [PrismaModule, JwtModule.register({}), OrdersModule],
  controllers: [SupportController],
  providers: [PlatformSupportService],
  exports: [PlatformSupportService]
})
export class SupportModule {}
