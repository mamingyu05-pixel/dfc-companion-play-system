import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ComplaintsController } from "./complaints.controller";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ComplaintsController]
})
export class ComplaintsModule {}
