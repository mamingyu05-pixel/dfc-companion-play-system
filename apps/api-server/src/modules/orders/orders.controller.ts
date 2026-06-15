import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { GameCode, UserRole } from "@prisma/client";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AuthenticatedUser } from "../auth/auth.types";
import { OrdersService } from "./orders.service";

@Controller("orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get("public/companions")
  listPublicCompanions(@Query("game") game?: GameCode) {
    return this.orders.listOrderableCompanions(game);
  }

  @Get("companions")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  listOrderableCompanions(@Query("game") game?: GameCode) {
    return this.orders.listOrderableCompanions(game);
  }

  @Get("my")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  listMyOrders(@CurrentUser() user: AuthenticatedUser) {
    return this.orders.listCustomerOrders(user.id);
  }

  @Get("companion/available")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER, UserRole.COMPANION, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  listAvailableOrders(@CurrentUser() user: AuthenticatedUser) {
    return this.orders.listAvailableOrdersForCompanion(user.id);
  }

  @Get("companion/my")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER, UserRole.COMPANION, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  listCompanionOrders(@CurrentUser() user: AuthenticatedUser) {
    return this.orders.listCompanionOrders(user.id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { game?: GameCode; mode: string; hours: string; companionId?: string; notes?: string; voiceTrialRequested?: boolean }
  ) {
    return this.orders.createOrder(user.id, body);
  }

  @Patch(":id/start")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER, UserRole.COMPANION, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  startOrder(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.orders.startOrder(id, user.id);
  }

  @Patch(":id/accept")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER, UserRole.COMPANION, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  acceptOrder(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.orders.acceptOrderFromWeb(id, user.id);
  }

  @Patch(":id/complete")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER, UserRole.COMPANION, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  completeOrder(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.orders.completeOrder(id, user.id);
  }
}
