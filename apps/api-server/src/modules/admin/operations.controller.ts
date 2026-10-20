import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { PrismaService } from "../prisma/prisma.service";
import { OperationsQuery, OperationsService } from "./operations.service";
import { NotificationDeliveryService } from "../bot/notification-delivery.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";

@Controller("admin/operations")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class OperationsController {
  constructor(
    private readonly operations: OperationsService,
    private readonly prisma: PrismaService,
    private readonly deliveries: NotificationDeliveryService,
  ) {}
  @Get("deliveries")
  pendingDeliveries() {
    return this.prisma.notificationDelivery.findMany({
      where: { status: { in: ["UNKNOWN", "SENDING", "READY"] } },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: {
        id: true,
        key: true,
        businessKey: true,
        platform: true,
        target: true,
        status: true,
        attempts: true,
        lastError: true,
        startedAt: true,
        createdAt: true,
      },
    });
  }
  @Patch("deliveries/:id/reconcile")
  reconcileDelivery(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body()
    body: {
      decision: "SENT" | "NOT_SENT";
      evidence: string;
      messageId?: string;
    },
  ) {
    return this.deliveries.reconcile(id, user.id, body);
  }
  @Get()
  overview(@Query() query: OperationsQuery) {
    return this.operations.overview(query);
  }
  @Get("orders/:id")
  async orderEvidence(@Param("id") id: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id },
      include: {
        statusLogs: { orderBy: { createdAt: "asc" } },
        complaints: true,
      },
    });
    const transactions = await this.prisma.walletTransaction.findMany({
      where: {
        OR: [
          { referenceType: "ORDER", referenceId: id },
          { businessKey: { endsWith: `:${id}` } },
          ...(order.orderGroupId
            ? [
                {
                  referenceType: "ORDER_GROUP",
                  referenceId: order.orderGroupId,
                },
              ]
            : []),
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    return {
      order,
      transactions,
      groupLedgerIncludesSiblingOrders: Boolean(order.orderGroupId),
    };
  }
}
