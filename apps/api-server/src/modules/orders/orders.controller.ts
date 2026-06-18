import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { GameCode, UserRole } from "@prisma/client";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AuthenticatedUser } from "../auth/auth.types";
import { OrderDraftsService } from "./order-drafts.service";
import { OrdersService } from "./orders.service";

@Controller("orders")
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly orderDrafts: OrderDraftsService
  ) {}

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

  @Get("companion/customers")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER, UserRole.COMPANION, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  searchCustomersForCompanion(@Query("query") query?: string) {
    return this.orders.searchCustomersForCompanion(query);
  }

  @Post("companion/customer-drafts")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER, UserRole.COMPANION, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  createCustomerDraftFromCompanion(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { customerId: string; game?: GameCode; mode: string; hours?: string; budgetAmount?: string; note?: string }
  ) {
    return this.orderDrafts.createDraftFromCompanion(user.id, {
      customerId: body.customerId,
      game: body.game,
      mode: body.mode,
      hours: body.hours,
      budgetAmount: body.budgetAmount,
      note: body.note
    });
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { game?: GameCode; mode: string; hours: string; companionId?: string; notes?: string; voiceTrialRequested?: boolean }
  ) {
    return this.orders.createOrder(user.id, {
      game: body.game,
      mode: body.mode,
      hours: body.hours,
      companionId: body.companionId,
      notes: body.notes,
      voiceTrialRequested: body.voiceTrialRequested
    });
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
