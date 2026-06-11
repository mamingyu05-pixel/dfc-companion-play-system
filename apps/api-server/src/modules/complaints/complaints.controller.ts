import { BadRequestException, Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { PrismaService } from "../prisma/prisma.service";

@Controller("complaints")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ComplaintsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("my")
  @Roles(UserRole.CUSTOMER, UserRole.COMPANION)
  listMyComplaints(@CurrentUser() user: AuthenticatedUser) {
    return this.prisma.complaint.findMany({
      where: { reporterId: user.id },
      orderBy: { createdAt: "desc" },
      include: { order: { select: { id: true, orderNo: true, status: true } } }
    });
  }

  @Post()
  @Roles(UserRole.CUSTOMER, UserRole.COMPANION)
  async createComplaint(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { orderId: string; reason: string }
  ) {
    if (!body.orderId || !body.reason?.trim()) {
      throw new BadRequestException("orderId and reason are required");
    }

    const order = await this.prisma.order.findFirst({
      where: {
        id: body.orderId,
        OR: [{ customerId: user.id }, { companionId: user.id }]
      },
      select: { id: true }
    });
    if (!order) throw new BadRequestException("Order does not exist or cannot be complained by current user");

    return this.prisma.complaint.create({
      data: {
        orderId: order.id,
        reporterId: user.id,
        reason: body.reason.trim()
      }
    });
  }
}
