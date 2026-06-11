import { Body, Controller, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AuthenticatedUser } from "../auth/auth.types";
import { OrdersService } from "./orders.service";

@Controller("orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { mode: string; hours: string; companionId?: string; notes?: string; voiceTrialRequested?: boolean }
  ) {
    return this.orders.createOrder(user.id, body);
  }

  @Patch(":id/start")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.COMPANION, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  startOrder(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.orders.startOrder(id, user.id);
  }

  @Patch(":id/complete")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  completeOrder(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.orders.completeOrder(id, user.id);
  }
}
