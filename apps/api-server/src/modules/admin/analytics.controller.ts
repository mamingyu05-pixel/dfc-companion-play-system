import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsQuery } from "./business-analytics";

@Controller("admin/analytics")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("customers")
  customers(@Query() query: AnalyticsQuery) {
    return this.analytics.customers(query);
  }

  @Get("companions")
  companions(@Query() query: AnalyticsQuery) {
    return this.analytics.companions(query);
  }
}
