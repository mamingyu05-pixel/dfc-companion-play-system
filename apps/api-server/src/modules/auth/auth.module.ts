import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthController } from "./auth.controller";
import { AuthRateLimitGuard } from "./auth-rate-limit.guard";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { RolesGuard } from "./roles.guard";

@Module({
  imports: [PrismaModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard, AuthRateLimitGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard, JwtModule]
})
export class AuthModule {}
