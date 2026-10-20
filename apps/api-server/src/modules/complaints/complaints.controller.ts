import { BadRequestException, Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { PrismaService } from "../prisma/prisma.service";
import { lockOrder } from "../orders/order-lock";

@Controller("complaints")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ComplaintsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("my")
  @Roles(UserRole.CUSTOMER, UserRole.COMPANION)
  async listMyComplaints(@CurrentUser() user: AuthenticatedUser) {
    const complaints = await this.prisma.complaint.findMany({
      where: { reporterId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orderId: true,
        reason: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        order: { select: { id: true, orderNo: true, status: true } }
      }
    });
    // The shared resolution field contains internal adjudication notes.
    return complaints.map(complaint => ({ ...complaint, resolution: null }));
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

    return this.prisma.$transaction(async tx => {
    await lockOrder(tx, body.orderId);
    const order = await tx.order.findFirst({
      where: {
        id: body.orderId,
        OR: [{ customerId: user.id }, { companionId: user.id }]
      },
      select: { id: true, status: true, companionId: true }
    });
    if (!order) throw new BadRequestException("Order does not exist or cannot be complained by current user");
    if (order.companionId) await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${order.companionId} FOR UPDATE`;

    const complaint = await tx.complaint.create({
      data: {
        orderId: order.id,
        reporterId: user.id,
        reason: body.reason.trim().slice(0, 4000)
      }
    });
    if (["PAID", "ASSIGNED", "ACCEPTED", "IN_PROGRESS", "AWAITING_ACCEPTANCE"].includes(order.status)) {
      await tx.order.update({ where: { id: order.id }, data: { status: "DISPUTED", disputeFromStatus: order.status } });
      await tx.orderStatusLog.create({ data: { orderId: order.id, actorId: user.id, fromStatus: order.status, toStatus: "DISPUTED", reason: "COMPLAINT_OPENED_PENDING_MANUAL_REVIEW" } });
    }
    return complaint;
    });
  }
}
