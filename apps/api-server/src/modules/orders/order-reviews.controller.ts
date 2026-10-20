import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { OrderReviewsService } from "./order-reviews.service";

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrderReviewsController {
  constructor(private readonly reviews: OrderReviewsService) {}

  @Post("orders/:id/review")
  @Roles(UserRole.CUSTOMER)
  create(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: { stars?: unknown; comment?: unknown }) {
    return this.reviews.create(id, user.id, body);
  }

  @Get("admin/order-reviews")
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  list() { return this.reviews.list(); }

  @Patch("admin/order-reviews/:id/hide")
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  hide(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) { return this.reviews.hide(id, user.id); }
}
