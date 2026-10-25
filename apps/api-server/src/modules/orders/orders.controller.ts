import { CompanionListQuery } from "./companion-directory";
import { customerOrderAction, validateCustomerOrderInput, validateGuaranteeInput } from "./customer-order-input";
import { parseEvidenceInput } from "./guarantee";
import { requireOrderRequestId } from "./order-request";
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
  listPublicCompanions(@Query("game") game?: GameCode, @Query() query: CompanionListQuery = {}) {
    return this.orders.listOrderableCompanions(game, query);
  }

  @Get("companions")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  listOrderableCompanions(@Query("game") game?: GameCode, @Query() query: CompanionListQuery = {}) {
    return this.orders.listOrderableCompanions(game, query);
  }

  @Get("public/companions/leaderboard")
  companionLeaderboard(@Query("game") game?: GameCode) {
    return this.orders.listCompanionLeaderboard(game);
  }

  @Get("companions/options")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  companionOptions(@Query("game") game?: GameCode) {
    return this.orders.listOrderableCompanionOptions(game);
  }

  @Get("requests/:requestId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  findRequest(@CurrentUser() user: AuthenticatedUser, @Param("requestId") requestId: string) {
    return this.orders.findCustomerOrderRequest(user.id, requireOrderRequestId(requestId));
  }

  @Get("environment")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  orderEnvironment() {
    return this.orders.getOrderEnvironment();
  }

  @Get("my")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  listMyOrders(@CurrentUser() user: AuthenticatedUser) {
    return this.orders.listCustomerOrders(user.id);
  }

  @Get(":id/record")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER, UserRole.COMPANION, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  orderRecord(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.orders.getOrderRecord(id, user);
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
  @Roles(UserRole.COMPANION, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  searchCustomersForCompanion(@Query("query") query?: string) {
    return this.orders.searchCustomersForCompanion(query);
  }

  @Get("companion/drafts")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER, UserRole.COMPANION, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  listCompanionDrafts(@CurrentUser() user: AuthenticatedUser) {
    return this.orderDrafts.listCompanionDrafts(user.id);
  }

  @Post("companion/drafts/:draftId/apply")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER, UserRole.COMPANION, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  companionApplyToDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param("draftId") draftId: string,
    @Body() body: { note?: string }
  ) {
    return this.orderDrafts.companionApplyFromWeb(user.id, draftId, body);
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

  @Post("preview")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  previewOrder(@CurrentUser() user: AuthenticatedUser, @Body() body: { game?: GameCode; mode: string; hours: string; companionId: string; testEnvironment?: string }) {
    return customerOrderAction(() => {
      validateCustomerOrderInput(body, true);
      return this.orders.previewCustomerOrder(user.id, body);
    });
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { requestId?: string; game?: GameCode; mode: string; hours: string; companionId?: string; notes?: string; voiceTrialRequested?: boolean; expectedTotalAmount?: string; testEnvironment?: string }
  ) {
    return customerOrderAction(() => {
      validateCustomerOrderInput(body, false);
      return this.orders.createOrder(user.id, {
        requestId: requireOrderRequestId(body.requestId),
        expectedTotalAmount: body.expectedTotalAmount,
        testEnvironment: body.testEnvironment,
        game: body.game,
        mode: body.mode,
        hours: body.hours,
        companionId: body.companionId,
        notes: body.notes,
        voiceTrialRequested: body.voiceTrialRequested
      });
    });
  }

  @Get("guarantee-packages")
  listGuaranteePackages() {
    return this.orders.listGuaranteePackages();
  }

  @Post("guarantee/preview")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  previewGuaranteeOrder(@CurrentUser() user: AuthenticatedUser, @Body() body: { packageId: string; companionId?: string; testEnvironment?: string }) {
    return customerOrderAction(() => {
      validateGuaranteeInput(body);
      return this.orders.previewGuaranteeOrder(user.id, body);
    });
  }

  @Post("guarantee")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  createGuaranteeOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { requestId?: string; packageId: string; companionId?: string; expectedTotalAmount?: string; notes?: string; testEnvironment?: string }
  ) {
    return customerOrderAction(() => {
      validateGuaranteeInput(body);
      return this.orders.createGuaranteeOrder(user.id, { ...body, requestId: requireOrderRequestId(body.requestId) });
    });
  }

  @Get("service-packages")
  listServicePackages() {
    return this.orders.listServicePackages();
  }

  @Post("package/preview")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  previewPackageOrder(@CurrentUser() user: AuthenticatedUser, @Body() body: { packageId: string; companionId?: string; testEnvironment?: string }) {
    return customerOrderAction(() => {
      validateGuaranteeInput(body, "请选择套餐");
      return this.orders.previewPackageOrder(user.id, body);
    });
  }

  @Post("package")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  createPackageOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { requestId?: string; packageId: string; companionId?: string; expectedTotalAmount?: string; notes?: string; testEnvironment?: string }
  ) {
    return customerOrderAction(() => {
      validateGuaranteeInput(body, "请选择套餐");
      return this.orders.createPackageOrder(user.id, { ...body, requestId: requireOrderRequestId(body.requestId) });
    });
  }

  @Get(":id/evidence")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER, UserRole.COMPANION, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  listEvidence(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.orders.listOrderEvidence(id, user);
  }

  @Get(":id/evidence/:evidenceId/image")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER, UserRole.COMPANION, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  evidenceImage(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Param("evidenceId") evidenceId: string) {
    return this.orders.orderEvidenceImage(id, evidenceId, user);
  }

  @Post(":id/evidence")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER, UserRole.COMPANION, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  addEvidence(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.orders.addOrderEvidence(id, user, parseEvidenceInput(body));
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
  acceptOrder(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: { dispatchVersion?: number } = {}) {
    return this.orders.acceptOrderFromWeb(id, user.id, body.dispatchVersion);
  }

  @Patch(":id/decline")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.COMPANION, UserRole.CUSTOMER)
  declineOrder(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: { reason: string; dispatchVersion?: number }) {
    return this.orders.declineOrder(id, user.id, body.reason, body.dispatchVersion);
  }

  @Patch(":id/complete")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER, UserRole.COMPANION, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  completeOrder(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.orders.completeOrder(id, user.id);
  }

  @Patch(":id/confirm-completion")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  confirmCompletion(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: { note?: string } = {}) {
    return this.orders.acceptCompletion(id, user.id, body.note);
  }

  @Post(":id/tip")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  tip(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: { amount?: unknown; requestId?: unknown } = {}) {
    return this.orders.tipCompanion(id, user.id, body);
  }
}
