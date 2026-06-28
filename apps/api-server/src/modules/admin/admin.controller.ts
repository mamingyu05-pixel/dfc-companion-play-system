import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  BotPlatform,
  ComplaintStatus,
  CompanionProfileStatus,
  DeltaForceRank,
  GameCode,
  OnlineStatus,
  OrderStatus,
  OrderSourcePlatform,
  Prisma,
  ReviewStatus,
  ServicePriceTier,
  UserRole,
  UserStatus,
  VoicePreference,
  WithdrawalStatus
} from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { normalizeDisplayNameKey } from "../auth/display-name.util";
import { isValidEmail, normalizeEmail } from "../auth/email.util";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { createPasswordHash } from "../auth/password.util";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { OrdersService } from "../orders/orders.service";
import { OrderDraftsService } from "../orders/order-drafts.service";
import { PrismaService } from "../prisma/prisma.service";
import { WalletService } from "../wallet/wallet.service";

const SUPPORTED_GAME_CODES = new Set<GameCode>([
  GameCode.DELTA_FORCE,
  GameCode.LEAGUE_OF_LEGENDS,
  GameCode.VALORANT,
  GameCode.COUNTER_STRIKE_2,
  GameCode.PUBG,
  GameCode.APEX_LEGENDS,
  GameCode.NARAKA_BLADEPOINT,
  GameCode.CALL_OF_DUTY
]);
import { CompanionExternalAccountsService } from "./companion-external-accounts.service";

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly orderDrafts: OrderDraftsService,
    private readonly wallet: WalletService,
    private readonly externalAccounts: CompanionExternalAccountsService
  ) {}

  @Get("dashboard")
  async getDashboard() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      todayOrderCount,
      dispatchPendingCount,
      pendingRechargeCount,
      pendingWithdrawalCount,
      activeComplaintCount,
      pendingOrders,
      pendingRecharges,
      pendingWithdrawals,
      recentLogs
    ] = await this.prisma.$transaction([
      this.prisma.order.count({ where: { createdAt: { gte: today } } }),
      this.prisma.order.count({ where: { status: { in: [OrderStatus.PAID, OrderStatus.ASSIGNED] } } }),
      this.prisma.rechargeRequest.count({ where: { status: ReviewStatus.PENDING } }),
      this.prisma.withdrawalRequest.count({ where: { status: { in: [WithdrawalStatus.PENDING, WithdrawalStatus.APPROVED] } } }),
      this.prisma.complaint.count({ where: { status: { in: [ComplaintStatus.OPEN, ComplaintStatus.IN_REVIEW] } } }),
      this.prisma.order.findMany({
        where: { status: { in: [OrderStatus.PAID, OrderStatus.ASSIGNED, OrderStatus.ACCEPTED, OrderStatus.IN_PROGRESS] } },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          customer: { select: { email: true, displayName: true } },
          companion: { select: { email: true, displayName: true } }
        }
      }),
      this.prisma.rechargeRequest.findMany({
        where: { status: ReviewStatus.PENDING },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { customer: { select: { email: true, displayName: true } } }
      }),
      this.prisma.withdrawalRequest.findMany({
        where: { status: { in: [WithdrawalStatus.PENDING, WithdrawalStatus.APPROVED] } },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { companion: { select: { email: true, displayName: true } } }
      }),
      this.prisma.adminLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { actor: { select: { email: true, displayName: true } } }
      })
    ]);

    return {
      metrics: [
        { label: "今日订单", value: String(todayOrderCount), hint: `${dispatchPendingCount} 个待派单` },
        { label: "待充值审核", value: String(pendingRechargeCount), hint: "需要核对截图" },
        { label: "待提现审核", value: String(pendingWithdrawalCount), hint: "待审核或待打款" },
        { label: "投诉处理中", value: String(activeComplaintCount), hint: "需要管理员介入" }
      ],
      pendingOrders: pendingOrders.map((order) => ({
        id: order.id,
        orderNo: order.orderNo,
        customer: displayUser(order.customer),
        companion: order.companion ? displayUser(order.companion) : "待派单",
        status: order.status,
        amount: order.totalAmount.toString(),
        createdAt: order.createdAt
      })),
      pendingReviews: [
        ...pendingRecharges.map((request) => ({
          type: "充值",
          id: request.id,
          subject: displayUser(request.customer),
          amount: request.amount.toString(),
          status: request.status,
          createdAt: request.createdAt
        })),
        ...pendingWithdrawals.map((request) => ({
          type: "提现",
          id: request.id,
          subject: displayUser(request.companion),
          amount: request.amount.toString(),
          status: request.status,
          createdAt: request.createdAt
        }))
      ]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 8),
      recentLogs: recentLogs.map((log) => ({
        id: log.id,
        actor: displayUser(log.actor),
        action: log.action,
        target: log.entityId ?? log.targetUserId ?? "-",
        entityType: log.entityType,
        createdAt: log.createdAt
      }))
    };
  }

  @Get("logs")
  listAdminLogs() {
    return this.prisma.adminLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        actor: { select: { email: true, displayName: true } },
        targetUser: { select: { email: true, displayName: true } }
      }
    }).then((logs) =>
      logs.map((log) => ({
        id: log.id,
        actor: displayUser(log.actor),
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        target: log.targetUser ? displayUser(log.targetUser) : (log.entityId ?? "-"),
        createdAt: log.createdAt
      }))
    );
  }

  @Get("users")
  listUsers() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        displayName: true,
        createdAt: true,
        wallet: {
          select: {
            availableBalance: true,
            frozenBalance: true,
            availableIncome: true,
            pendingIncome: true
          }
        },
        companionProfile: {
          select: {
            nickname: true,
            game: true,
            status: true,
            onlineStatus: true,
            pricePerHour: true,
            kookPricePerHour: true,
            discordPricePerHour: true,
            entertainmentPricePerHour: true,
            rankedPricePerHour: true,
            highRankedPricePerHour: true
          }
        },
        externalAccounts: {
          select: {
            platform: true,
            externalUserId: true,
            displayName: true
          }
        }
      }
    }).then((users) =>
      users.map((item) => ({
        id: item.id,
        email: item.email,
        role: item.role,
        status: item.status,
        displayName: item.displayName,
        createdAt: item.createdAt,
        wallet: item.wallet
          ? {
              availableBalance: item.wallet.availableBalance.toString(),
              frozenBalance: item.wallet.frozenBalance.toString(),
              availableIncome: item.wallet.availableIncome.toString(),
              pendingIncome: item.wallet.pendingIncome.toString()
            }
          : null,
        companionProfile: item.companionProfile
          ? {
              nickname: item.companionProfile.nickname,
              game: item.companionProfile.game,
              status: item.companionProfile.status,
              onlineStatus: item.companionProfile.onlineStatus,
              pricePerHour: item.companionProfile.pricePerHour.toString(),
              kookPricePerHour: item.companionProfile.kookPricePerHour?.toString() ?? null,
              discordPricePerHour: item.companionProfile.discordPricePerHour?.toString() ?? null,
              entertainmentPricePerHour: item.companionProfile.entertainmentPricePerHour?.toString() ?? null,
              rankedPricePerHour: item.companionProfile.rankedPricePerHour?.toString() ?? null,
              highRankedPricePerHour: item.companionProfile.highRankedPricePerHour?.toString() ?? null
            }
          : null,
        externalAccounts: item.externalAccounts
      }))
    );
  }

  @Patch("users/:id/status")
  async updateUserStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { status: "ACTIVE" | "BANNED"; note?: string }
  ) {
    if (!["ACTIVE", "BANNED"].includes(body.status)) {
      throw new BadRequestException("Invalid user status");
    }
    if (user.id === id && body.status === "BANNED") {
      throw new BadRequestException("Admin cannot ban self");
    }

    const target = await this.prisma.user.update({
      where: { id },
      data: { status: body.status === "ACTIVE" ? UserStatus.ACTIVE : UserStatus.BANNED },
      select: { id: true, email: true, role: true, status: true, displayName: true }
    });

    await this.prisma.adminLog.create({
      data: {
        actorId: user.id,
        targetUserId: id,
        action: body.status === "ACTIVE" ? "ACTIVATE_USER" : "BAN_USER",
        entityType: "USER",
        entityId: id,
        detail: { email: target.email, role: target.role, note: body.note }
      }
    });

    return target;
  }

  @Post("users/:id/balance-adjustments")
  adjustCustomerBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { amount: string; note?: string; direction?: "CREDIT" | "DEBIT" }
  ) {
    return this.wallet.adminCreditCustomerBalance(id, user.id, body);
  }

  @Post("users/:id/password")
  async resetUserPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { password: string; note?: string }
  ) {
    if (!body.password || body.password.length < 8) {
      throw new BadRequestException("Password must be at least 8 characters");
    }

    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, displayName: true }
    });
    if (!target) {
      throw new BadRequestException("User does not exist");
    }
    if ((target.role === UserRole.ADMIN || target.role === UserRole.SUPER_ADMIN) && user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException("Only SUPER_ADMIN can reset admin passwords");
    }

    const passwordHash = await createPasswordHash(body.password);
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id },
        data: { passwordHash },
        select: { id: true, email: true, role: true, status: true, displayName: true }
      });

      await tx.adminLog.create({
        data: {
          actorId: user.id,
          targetUserId: id,
          action: "RESET_USER_PASSWORD",
          entityType: "USER",
          entityId: id,
          detail: { email: target.email, role: target.role, note: body.note }
        }
      });

      return result;
    });

    return updated;
  }

  @Post("admins")
  async createAdmin(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { email: string; password: string; displayName: string; role?: "ADMIN" | "SUPER_ADMIN" }
  ) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException("Only SUPER_ADMIN can create admin accounts");
    }
    if (!body.email || !body.password || !body.displayName) {
      throw new BadRequestException("email, password and displayName are required");
    }
    const email = normalizeEmail(body.email);
    const displayName = body.displayName.trim();
    const displayNameKey = normalizeDisplayNameKey(displayName);
    if (!isValidEmail(email) || !displayName || !displayNameKey) {
      throw new BadRequestException("email, password and displayName are required");
    }
    if (body.password.length < 8) {
      throw new BadRequestException("Password must be at least 8 characters");
    }

    const passwordHash = await createPasswordHash(body.password);
    const role = body.role === "SUPER_ADMIN" ? UserRole.SUPER_ADMIN : UserRole.ADMIN;

    try {
      const created = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          role,
          displayName,
          displayNameKey,
          referralCode: await generateUniqueReferralCode(this.prisma, role === UserRole.SUPER_ADMIN ? "S" : "A")
        },
        select: { id: true, email: true, role: true, status: true, displayName: true }
      });

      await this.prisma.adminLog.create({
        data: {
          actorId: user.id,
          targetUserId: created.id,
          action: "CREATE_ADMIN",
          entityType: "USER",
          entityId: created.id,
          detail: { email: created.email, role: created.role }
        }
      });

      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException(isDisplayNameUniqueError(error) ? "Display name is already taken" : "Email is already registered");
      }
      throw error;
    }
  }

  @Patch("users/:id/role")
  async updateUserRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { role: "CUSTOMER" | "ADMIN" | "SUPER_ADMIN"; note?: string }
  ) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException("Only SUPER_ADMIN can update admin roles");
    }
    const nextRole =
      body.role === "SUPER_ADMIN"
        ? UserRole.SUPER_ADMIN
        : body.role === "ADMIN"
          ? UserRole.ADMIN
          : body.role === "CUSTOMER"
            ? UserRole.CUSTOMER
            : null;
    if (!nextRole) {
      throw new BadRequestException("Invalid role");
    }
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, status: true, displayName: true }
    });
    if (!target) {
      throw new BadRequestException("User does not exist");
    }
    if (target.status !== UserStatus.ACTIVE) {
      throw new BadRequestException("User must be active before role changes");
    }
    if (target.id === user.id && nextRole !== UserRole.SUPER_ADMIN) {
      throw new BadRequestException("You cannot downgrade your own SUPER_ADMIN role");
    }
    if (target.role === UserRole.SUPER_ADMIN && nextRole !== UserRole.SUPER_ADMIN) {
      const otherSuperAdmins = await this.prisma.user.count({
        where: {
          id: { not: target.id },
          role: UserRole.SUPER_ADMIN,
          status: UserStatus.ACTIVE
        }
      });
      if (!otherSuperAdmins) {
        throw new BadRequestException("At least one active SUPER_ADMIN is required");
      }
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const displayNameKey =
          target.role === nextRole ? undefined : await generateAvailableDisplayNameKey(tx, nextRole, target.displayName, target.id);
        const updated = await tx.user.update({
          where: { id },
          data: {
            role: nextRole,
            ...(displayNameKey ? { displayNameKey } : {})
          },
          select: { id: true, email: true, role: true, status: true, displayName: true }
        });

        await tx.adminLog.create({
          data: {
            actorId: user.id,
            targetUserId: id,
            action: "UPDATE_USER_ROLE",
            entityType: "USER",
            entityId: id,
            detail: { email: target.email, fromRole: target.role, toRole: updated.role, note: body.note }
          }
        });

        return updated;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException(isDisplayNameUniqueError(error) ? "Display name is already taken" : "User role update conflicts with existing data");
      }
      throw error;
    }
  }

  @Get("recharges")
  listRechargeRequests() {
    return this.prisma.rechargeRequest.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        customer: {
          select: {
            id: true,
            email: true,
            displayName: true,
            wallet: { select: { availableBalance: true } }
          }
        },
        reviewedBy: { select: { id: true, email: true, displayName: true } }
      }
    }).then((requests) =>
      requests.map((request) => ({
        id: request.id,
        amount: request.amount.toString(),
        screenshotUrl: request.screenshotUrl,
        note: request.note,
        status: request.status,
        reviewNote: request.reviewNote,
        reviewedAt: request.reviewedAt,
        createdAt: request.createdAt,
        customer: {
          id: request.customer.id,
          email: request.customer.email,
          displayName: request.customer.displayName,
          availableBalance: request.customer.wallet?.availableBalance.toString() ?? "0"
        },
        reviewedBy: request.reviewedBy
          ? {
              id: request.reviewedBy.id,
              email: request.reviewedBy.email,
              displayName: request.reviewedBy.displayName
            }
          : null
      }))
    );
  }

  @Get("wallet-transactions")
  listWalletTransactions() {
    return this.prisma.walletTransaction.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        user: { select: { id: true, email: true, displayName: true, role: true } },
        operator: { select: { id: true, email: true, displayName: true } }
      }
    }).then((transactions) =>
      transactions.map((transaction) => ({
        id: transaction.id,
        type: transaction.type,
        direction: transaction.direction,
        amount: transaction.amount.toString(),
        balanceAfter: transaction.balanceAfter.toString(),
        referenceType: transaction.referenceType,
        referenceId: transaction.referenceId,
        note: transaction.note,
        createdAt: transaction.createdAt,
        user: transaction.user,
        operator: transaction.operator
      }))
    );
  }

  @Get("withdrawals")
  listWithdrawalRequests() {
    return this.prisma.withdrawalRequest.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        companion: {
          select: {
            id: true,
            email: true,
            displayName: true,
            wallet: { select: { availableIncome: true, frozenIncome: true } }
          }
        },
        reviewedBy: { select: { id: true, email: true, displayName: true } }
      }
    }).then((requests) =>
      requests.map((request) => ({
        id: request.id,
        amount: request.amount.toString(),
        payoutAccount: request.payoutAccount,
        status: request.status,
        note: request.note,
        reviewNote: request.reviewNote,
        payoutReference: request.payoutReference,
        reviewedAt: request.reviewedAt,
        paidAt: request.paidAt,
        createdAt: request.createdAt,
        companion: {
          id: request.companion.id,
          email: request.companion.email,
          displayName: request.companion.displayName,
          availableIncome: request.companion.wallet?.availableIncome.toString() ?? "0",
          frozenIncome: request.companion.wallet?.frozenIncome.toString() ?? "0"
        },
        reviewedBy: request.reviewedBy
          ? {
              id: request.reviewedBy.id,
              email: request.reviewedBy.email,
              displayName: request.reviewedBy.displayName
            }
          : null
      }))
    );
  }

  @Get("complaints")
  listComplaints() {
    return this.prisma.complaint.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        order: { select: { id: true, orderNo: true, status: true, totalAmount: true } },
        reporter: { select: { id: true, email: true, displayName: true, role: true } },
        resolvedBy: { select: { id: true, email: true, displayName: true } }
      }
    }).then((complaints) =>
      complaints.map((complaint) => ({
        id: complaint.id,
        reason: complaint.reason,
        status: complaint.status,
        resolution: complaint.resolution,
        createdAt: complaint.createdAt,
        updatedAt: complaint.updatedAt,
        order: {
          id: complaint.order.id,
          orderNo: complaint.order.orderNo,
          status: complaint.order.status,
          totalAmount: complaint.order.totalAmount.toString()
        },
        reporter: complaint.reporter,
        resolvedBy: complaint.resolvedBy
      }))
    );
  }

  @Patch("complaints/:id/review")
  async reviewComplaint(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { status: "IN_REVIEW" | "RESOLVED" | "REJECTED"; resolution?: string }
  ) {
    if (!["IN_REVIEW", "RESOLVED", "REJECTED"].includes(body.status)) {
      throw new BadRequestException("Invalid complaint status");
    }

    const complaint = await this.prisma.complaint.update({
      where: { id },
      data: {
        status: body.status,
        resolution: body.resolution,
        resolvedById: body.status === "RESOLVED" || body.status === "REJECTED" ? user.id : undefined
      },
      include: { order: true, reporter: true }
    });

    await this.prisma.adminLog.create({
      data: {
        actorId: user.id,
        targetUserId: complaint.reporterId,
        action: "REVIEW_COMPLAINT",
        entityType: "COMPLAINT",
        entityId: id,
        detail: { status: body.status, resolution: body.resolution, orderNo: complaint.order.orderNo }
      }
    });

    return complaint;
  }

  @Get("orders")
  listOrders() {
    return this.orders.listAdminOrders();
  }

  @Post("orders/direct")
  createDirectOrderFromGroupSelection(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      customerId?: string;
      companionId?: string;
      companionIds?: string[];
      sourcePlatform?: OrderSourcePlatform;
      sourceChannelId?: string;
      sourceMessageId?: string;
      game?: GameCode;
      mode?: string;
      hours?: string;
      priceTier?: ServicePriceTier;
      notes?: string;
      voiceTrialRequested?: boolean;
    }
  ) {
    const customerId = body.customerId?.trim();
    if (!customerId) throw new BadRequestException("customerId is required");

    const companionIds = [...new Set([...(body.companionIds ?? []), body.companionId].map((id) => id?.trim()).filter((id): id is string => Boolean(id)))];
    if (!companionIds.length) throw new BadRequestException("companionId or companionIds is required");

    const game = body.game ?? GameCode.DELTA_FORCE;
    if (!SUPPORTED_GAME_CODES.has(game)) throw new BadRequestException("Unsupported game");
    if (!body.mode?.trim()) throw new BadRequestException("mode is required");
    if (!body.hours?.trim()) throw new BadRequestException("hours is required");
    const priceTier = body.priceTier ?? ServicePriceTier.CUSTOM;
    if (!Object.values(ServicePriceTier).includes(priceTier)) throw new BadRequestException("Unsupported price tier");
    const sourcePlatform = body.sourcePlatform ?? OrderSourcePlatform.WEB;
    if (!Object.values(OrderSourcePlatform).includes(sourcePlatform)) throw new BadRequestException("Unsupported source platform");

    return this.orders.createOrderGroup(customerId, {
      game,
      mode: body.mode.trim(),
      hours: body.hours.trim(),
      priceTier,
      companionIds,
      notes: body.notes?.trim() || undefined,
      voiceTrialRequested: body.voiceTrialRequested ?? false,
      sourcePlatform,
      sourceChannelId: body.sourceChannelId?.trim() || undefined,
      sourceMessageId: body.sourceMessageId?.trim() || undefined,
      assignedById: user.id
    });
  }

  @Patch("orders/:id/cancel")
  cancelOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { note?: string }
  ) {
    return this.orders.cancelOrderByAdmin(user.id, id, body);
  }

  @Get("order-drafts")
  listOrderDrafts() {
    return this.orderDrafts.listAdminDrafts();
  }

  @Post("order-drafts")
  createOrderDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      customerId?: string;
      sourcePlatform?: OrderSourcePlatform;
      customerPlatformUserId?: string;
      customerDisplayName?: string;
      sourceGuildId?: string;
      sourceChannelId?: string;
      sourceMessageId?: string;
      voiceRoomId?: string;
      game?: GameCode;
      mode: string;
      hours?: string;
      priceTier?: ServicePriceTier;
      budgetAmount?: string;
      note?: string;
    }
  ) {
    return this.orderDrafts.createDraft(user.id, body);
  }

  @Post("order-drafts/from-demand")
  createOrderDraftFromDemand(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      customerId?: string;
      sourcePlatform?: OrderSourcePlatform;
      customerPlatformUserId?: string;
      customerDisplayName?: string;
      sourceGuildId?: string;
      sourceChannelId?: string;
      sourceMessageId?: string;
      voiceRoomId?: string;
      demandText: string;
    }
  ) {
    return this.orderDrafts.createDraftFromDemand(user.id, body);
  }

  @Post("order-drafts/:id/recommend-candidates")
  recommendOrderDraftCandidates(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { limit?: number }
  ) {
    return this.orderDrafts.recommendCandidates(user.id, id, body.limit);
  }

  @Post("order-drafts/:id/candidates")
  addOrderDraftCandidate(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { companionId: string; note?: string }
  ) {
    return this.orderDrafts.addCandidate(user.id, id, body);
  }

  @Patch("order-drafts/:id/select-companion")
  selectOrderDraftCompanion(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { companionId?: string; companionIds?: string[]; note?: string }
  ) {
    return this.orderDrafts.selectCompanion(user.id, id, body);
  }

  @Patch("order-drafts/:id/confirm")
  confirmOrderDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { note?: string }
  ) {
    return this.orderDrafts.confirmDraft(user.id, id, body);
  }

  @Patch("order-drafts/:id/cancel")
  cancelOrderDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { note?: string }
  ) {
    return this.orderDrafts.cancelDraft(user.id, id, body);
  }

  @Patch("order-drafts/:id/fail")
  failOrderDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { note?: string }
  ) {
    return this.orderDrafts.failDraft(user.id, id, body);
  }

  @Post("order-drafts/expire-stale")
  expireStaleOrderDrafts() {
    return this.orderDrafts.expireStaleDrafts();
  }

  @Post("order-drafts/:id/convert")
  convertOrderDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { companionId?: string; companionIds?: string[]; note?: string }
  ) {
    return this.orderDrafts.convertDraftToOrder(user.id, id, body);
  }

  @Get("companions")
  listCompanions() {
    return this.prisma.companionProfile.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            status: true,
            externalAccounts: {
              select: {
                platform: true,
                externalUserId: true,
                displayName: true
              }
            },
            wallet: { select: { availableIncome: true, pendingIncome: true } }
          }
        }
      }
    }).then((profiles) =>
      profiles.map((profile) => ({
        userId: profile.userId,
        email: profile.user.email,
        displayName: profile.user.displayName,
        userStatus: profile.user.status,
        nickname: profile.nickname,
        avatarUrl: profile.avatarUrl,
        photoUrls: profile.photoUrls,
        voiceIntroUrl: profile.voiceIntroUrl,
        game: profile.game,
        games: profile.games.length ? profile.games : [profile.game],
        status: profile.status,
        onlineStatus: profile.onlineStatus,
        deltaForceRank: profile.deltaForceRank,
        skillModes: profile.skillModes,
        pricePerHour: profile.pricePerHour.toString(),
        kookPricePerHour: profile.kookPricePerHour?.toString() ?? null,
        discordPricePerHour: profile.discordPricePerHour?.toString() ?? null,
        entertainmentPricePerHour: profile.entertainmentPricePerHour?.toString() ?? null,
        rankedPricePerHour: profile.rankedPricePerHour?.toString() ?? null,
        highRankedPricePerHour: profile.highRankedPricePerHour?.toString() ?? null,
        commissionRate: profile.commissionRate.toString(),
        externalAccounts: profile.user.externalAccounts,
        availableIncome: profile.user.wallet?.availableIncome.toString() ?? "0",
        pendingIncome: profile.user.wallet?.pendingIncome.toString() ?? "0"
      }))
    );
  }

  @Get("promotion-settings")
  async getPromotionSettings() {
    await this.ensureDefaultPromotionSettings();
    const settings = await this.prisma.platformSetting.findMany({ orderBy: { key: "asc" } });
    return settings.map((setting) => ({
      key: setting.key,
      value: setting.value,
      description: setting.description
    }));
  }

  @Patch("promotion-settings")
  async updatePromotionSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: Record<string, string>
  ) {
    const allowed = promotionSettingDefaults();
    const entries = Object.entries(body).filter(([key]) => key in allowed);
    if (!entries.length) throw new BadRequestException("No valid promotion setting provided");

    for (const [key, value] of entries) {
      const decimal = parseNonNegativeDecimal(value, key);
      if (key.endsWith("_RATE") && decimal.gt(1)) {
        throw new BadRequestException(`${key} cannot be greater than 1`);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      for (const [key, value] of entries) {
        await tx.platformSetting.upsert({
          where: { key },
          create: {
            key,
            value,
            description: allowed[key],
            updatedById: user.id
          },
          update: {
            value,
            description: allowed[key],
            updatedById: user.id
          }
        });
      }

      await tx.adminLog.create({
        data: {
          actorId: user.id,
          action: "UPDATE_PROMOTION_SETTINGS",
          entityType: "PLATFORM_SETTING",
          detail: Object.fromEntries(entries)
        }
      });
    });

    return this.getPromotionSettings();
  }

  @Get("promotion-codes")
  async listPromotionCodes() {
    const codes = await this.prisma.promotionCode.findMany({ orderBy: { createdAt: "desc" } });
    return codes.map((code) => ({
      id: code.id,
      code: code.code,
      title: code.title,
      minRecharge: code.minRecharge.toString(),
      bonusAmount: code.bonusAmount.toString(),
      bonusRate: code.bonusRate.toString(),
      maxBonusAmount: code.maxBonusAmount?.toString() ?? null,
      usageLimit: code.usageLimit,
      usedCount: code.usedCount,
      startsAt: code.startsAt,
      endsAt: code.endsAt,
      isActive: code.isActive
    }));
  }

  @Post("promotion-codes")
  async createPromotionCode(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      code: string;
      title: string;
      minRecharge?: string;
      bonusAmount?: string;
      bonusRate?: string;
      maxBonusAmount?: string;
      usageLimit?: number;
      startsAt?: string;
      endsAt?: string;
    }
  ) {
    const code = normalizePromotionCode(body.code);
    const title = body.title?.trim().slice(0, 80);
    if (!code || !title) throw new BadRequestException("code and title are required");

    const minRecharge = parseNonNegativeDecimal(body.minRecharge ?? "0", "minRecharge");
    const bonusAmount = parseNonNegativeDecimal(body.bonusAmount ?? "0", "bonusAmount");
    const bonusRate = parseNonNegativeDecimal(body.bonusRate ?? "0", "bonusRate");
    const maxBonusAmount = body.maxBonusAmount ? parseNonNegativeDecimal(body.maxBonusAmount, "maxBonusAmount") : null;
    if (bonusRate.gt(1)) throw new BadRequestException("bonusRate cannot be greater than 1");
    if (bonusAmount.add(bonusRate).lte(0)) throw new BadRequestException("bonus must be greater than 0");
    if (body.usageLimit !== undefined && (!Number.isInteger(body.usageLimit) || body.usageLimit <= 0)) {
      throw new BadRequestException("usageLimit must be a positive integer");
    }

    const startsAt = parseOptionalDate(body.startsAt, "startsAt");
    const endsAt = parseOptionalDate(body.endsAt, "endsAt");
    if (startsAt && endsAt && startsAt >= endsAt) throw new BadRequestException("endsAt must be after startsAt");

    try {
      const created = await this.prisma.promotionCode.create({
        data: {
          code,
          title,
          minRecharge,
          bonusAmount,
          bonusRate,
          maxBonusAmount,
          usageLimit: body.usageLimit,
          startsAt,
          endsAt,
          createdById: user.id
        }
      });

      await this.prisma.adminLog.create({
        data: {
          actorId: user.id,
          action: "CREATE_PROMOTION_CODE",
          entityType: "PROMOTION_CODE",
          entityId: created.id,
          detail: { code, title, minRecharge: minRecharge.toString(), bonusAmount: bonusAmount.toString(), bonusRate: bonusRate.toString() }
        }
      });

      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("Promotion code already exists");
      }
      throw error;
    }
  }

  @Patch("promotion-codes/:id/status")
  async updatePromotionCodeStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { isActive: boolean }
  ) {
    const updated = await this.prisma.promotionCode.update({
      where: { id },
      data: { isActive: Boolean(body.isActive) }
    });

    await this.prisma.adminLog.create({
      data: {
        actorId: user.id,
        action: updated.isActive ? "ACTIVATE_PROMOTION_CODE" : "DISABLE_PROMOTION_CODE",
        entityType: "PROMOTION_CODE",
        entityId: id,
        detail: { code: updated.code }
      }
    });

    return updated;
  }

  @Post("companions")
  async createCompanion(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      email: string;
      password: string;
      nickname: string;
      pricePerHour: string;
      kookPricePerHour?: string;
      discordPricePerHour?: string;
      entertainmentPricePerHour?: string;
      rankedPricePerHour?: string;
      highRankedPricePerHour?: string;
      commissionRate?: string;
      avatarUrl?: string;
      photoUrls?: string[];
      voiceIntroUrl?: string;
      gender?: string;
      game?: GameCode;
      games?: GameCode[];
      deltaForceRank?: DeltaForceRank;
      skillModes?: string[];
      bio?: string;
      voicePreference?: VoicePreference;
    }
  ) {
    if (!body.email || !body.password || !body.nickname) {
      throw new BadRequestException("email, password and nickname are required");
    }
    const email = normalizeEmail(body.email);
    const nickname = body.nickname.trim();
    const displayNameKey = normalizeDisplayNameKey(nickname);
    if (!isValidEmail(email) || !nickname || !displayNameKey) {
      throw new BadRequestException("email, password and nickname are required");
    }
    if (body.password.length < 8) {
      throw new BadRequestException("Password must be at least 8 characters");
    }

    const passwordHash = await createPasswordHash(body.password);
    let pricePerHour: Prisma.Decimal;
    try {
      pricePerHour = new Prisma.Decimal(body.pricePerHour);
    } catch {
      throw new BadRequestException("pricePerHour must be a valid amount");
    }
    if (pricePerHour.lte(0)) throw new BadRequestException("pricePerHour must be greater than 0");
    const kookPricePerHour = parseOptionalPositiveDecimal(body.kookPricePerHour, "kookPricePerHour");
    const discordPricePerHour = parseOptionalPositiveDecimal(body.discordPricePerHour, "discordPricePerHour");
    const entertainmentPricePerHour = parseOptionalPositiveDecimal(body.entertainmentPricePerHour, "entertainmentPricePerHour");
    const rankedPricePerHour = parseOptionalPositiveDecimal(body.rankedPricePerHour, "rankedPricePerHour");
    const highRankedPricePerHour = parseOptionalPositiveDecimal(body.highRankedPricePerHour, "highRankedPricePerHour");
    const primaryGame = normalizeGameCode(body.game) ?? normalizeGameCode(body.games?.[0]) ?? GameCode.DELTA_FORCE;
    const games = normalizeGameList(body.games, primaryGame);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const companion = await tx.user.create({
          data: {
            email,
            passwordHash,
            role: UserRole.COMPANION,
            displayName: nickname,
            displayNameKey,
            referralCode: await generateUniqueReferralCode(tx, "P"),
            wallet: { create: {} },
            companionProfile: {
              create: {
                nickname,
                avatarUrl: body.avatarUrl,
                photoUrls: normalizeMediaUrls(body.photoUrls),
                voiceIntroUrl: normalizeOptionalString(body.voiceIntroUrl),
                gender: body.gender,
                game: primaryGame,
                games,
                deltaForceRank: body.deltaForceRank ?? DeltaForceRank.UNRANKED,
                skillModes: body.skillModes ?? [],
                pricePerHour,
                kookPricePerHour,
                discordPricePerHour,
                entertainmentPricePerHour,
                rankedPricePerHour,
                highRankedPricePerHour,
                commissionRate: parseCommissionRate((body as { commissionRate?: string }).commissionRate ?? "0.2"),
                onlineStatus: OnlineStatus.OFFLINE,
                bio: body.bio,
                voicePreference: body.voicePreference ?? VoicePreference.OPTIONAL,
                status: CompanionProfileStatus.PENDING_REVIEW
              }
            }
          },
          select: {
            id: true,
            email: true,
            role: true,
            displayName: true,
            companionProfile: true
          }
        });

        await tx.adminLog.create({
          data: {
            actorId: user.id,
            targetUserId: companion.id,
            action: "CREATE_COMPANION",
            entityType: "USER",
            entityId: companion.id,
            detail: {
              nickname,
              pricePerHour: body.pricePerHour,
              entertainmentPricePerHour: body.entertainmentPricePerHour,
              rankedPricePerHour: body.rankedPricePerHour,
              highRankedPricePerHour: body.highRankedPricePerHour
            }
          }
        });

        return companion;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException(isDisplayNameUniqueError(error) ? "Display name is already taken" : "Email is already registered");
      }
      throw error;
    }
  }

  @Patch("users/:id/become-companion")
  async convertCustomerToCompanion(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body()
    body: {
      nickname: string;
      pricePerHour: string;
      kookPricePerHour?: string;
      discordPricePerHour?: string;
      entertainmentPricePerHour?: string;
      rankedPricePerHour?: string;
      highRankedPricePerHour?: string;
      commissionRate?: string;
      avatarUrl?: string;
      photoUrls?: string[];
      voiceIntroUrl?: string;
      gender?: string;
      game?: GameCode;
      games?: GameCode[];
      deltaForceRank?: DeltaForceRank;
      skillModes?: string[];
      bio?: string;
      voicePreference?: VoicePreference;
      note?: string;
    }
  ) {
    if (!body.nickname || !body.pricePerHour) {
      throw new BadRequestException("nickname and pricePerHour are required");
    }

    const nickname = body.nickname.trim();
    if (!nickname) {
      throw new BadRequestException("nickname and pricePerHour are required");
    }

    let pricePerHour: Prisma.Decimal;
    try {
      pricePerHour = new Prisma.Decimal(body.pricePerHour);
    } catch {
      throw new BadRequestException("pricePerHour must be a valid amount");
    }
    if (pricePerHour.lte(0)) throw new BadRequestException("pricePerHour must be greater than 0");
    const kookPricePerHour = parseOptionalPositiveDecimal(body.kookPricePerHour, "kookPricePerHour");
    const discordPricePerHour = parseOptionalPositiveDecimal(body.discordPricePerHour, "discordPricePerHour");
    const entertainmentPricePerHour = parseOptionalPositiveDecimal(body.entertainmentPricePerHour, "entertainmentPricePerHour");
    const rankedPricePerHour = parseOptionalPositiveDecimal(body.rankedPricePerHour, "rankedPricePerHour");
    const highRankedPricePerHour = parseOptionalPositiveDecimal(body.highRankedPricePerHour, "highRankedPricePerHour");
    const primaryGame = normalizeGameCode(body.game) ?? normalizeGameCode(body.games?.[0]) ?? GameCode.DELTA_FORCE;
    const games = normalizeGameList(body.games, primaryGame);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const nicknameOwner = await tx.companionProfile.findFirst({
          where: {
            nickname: { equals: nickname, mode: "insensitive" },
            userId: { not: id }
          },
          select: { id: true }
        });
        if (nicknameOwner) {
          throw new BadRequestException("Companion nickname is already taken");
        }

        const target = await tx.user.findUnique({
          where: { id },
          include: { wallet: true, companionProfile: true }
        });
        if (!target) throw new BadRequestException("User does not exist");
        if (target.status !== UserStatus.ACTIVE) throw new BadRequestException("User must be active before enabling companion access");
        if (target.companionProfile) throw new BadRequestException("Companion profile already exists");

        await tx.wallet.upsert({
          where: { userId: id },
          update: {},
          create: { userId: id }
        });

        await tx.companionProfile.create({
          data: {
            userId: id,
            nickname,
            avatarUrl: body.avatarUrl,
            photoUrls: normalizeMediaUrls(body.photoUrls),
            voiceIntroUrl: normalizeOptionalString(body.voiceIntroUrl),
            gender: body.gender,
            game: primaryGame,
            games,
            deltaForceRank: body.deltaForceRank ?? DeltaForceRank.UNRANKED,
            skillModes: body.skillModes ?? [],
            pricePerHour,
            kookPricePerHour,
            discordPricePerHour,
            entertainmentPricePerHour,
            rankedPricePerHour,
            highRankedPricePerHour,
            commissionRate: parseCommissionRate(body.commissionRate ?? "0.2"),
            onlineStatus: OnlineStatus.OFFLINE,
            bio: body.bio,
            voicePreference: body.voicePreference ?? VoicePreference.OPTIONAL,
            status: CompanionProfileStatus.PENDING_REVIEW
          }
        });

        const updated = await tx.user.findUnique({
          where: { id },
          select: {
            id: true,
            email: true,
            role: true,
            displayName: true,
            referralCode: true,
            companionProfile: true
          }
        });
        if (!updated) throw new BadRequestException("User does not exist");

        await tx.adminLog.create({
          data: {
            actorId: user.id,
            targetUserId: id,
            action: "ENABLE_COMPANION_ACCESS",
            entityType: "USER",
            entityId: id,
            detail: {
              nickname,
              pricePerHour: body.pricePerHour,
              entertainmentPricePerHour: body.entertainmentPricePerHour,
              rankedPricePerHour: body.rankedPricePerHour,
              highRankedPricePerHour: body.highRankedPricePerHour,
              note: body.note
            }
          }
        });

        return updated;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        if (isUniqueErrorTarget(error, "userId")) {
          throw new BadRequestException("Companion profile already exists");
        }
        if (isDisplayNameUniqueError(error)) {
          throw new BadRequestException("Existing account display name conflicts");
        }
        if (isUniqueErrorTarget(error, "referralCode")) {
          throw new BadRequestException("Referral code conflicts, please retry");
        }
        throw new BadRequestException("Companion account data conflicts");
      }
      throw error;
    }
  }

  @Patch("companions/:id/status")
  async updateCompanionProfileStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { status: "PENDING_REVIEW" | "LISTED" | "UNLISTED" | "BANNED"; note?: string }
  ) {
    if (!["PENDING_REVIEW", "LISTED", "UNLISTED", "BANNED"].includes(body.status)) {
      throw new BadRequestException("Invalid companion profile status");
    }

    const updated = await this.prisma.companionProfile.update({
      where: { userId: id },
      data: { status: body.status as CompanionProfileStatus },
      include: { user: { select: { id: true, email: true, displayName: true } } }
    });

    await this.prisma.adminLog.create({
      data: {
        actorId: user.id,
        targetUserId: id,
        action: "UPDATE_COMPANION_STATUS",
        entityType: "COMPANION_PROFILE",
        entityId: updated.id,
        detail: { status: body.status, note: body.note }
      }
    });

    return {
      userId: updated.userId,
      email: updated.user.email,
      nickname: updated.nickname,
      status: updated.status
    };
  }

  @Patch("companions/:id/commission")
  async updateCompanionCommission(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { commissionRate: string; note?: string }
  ) {
    const commissionRate = parseCommissionRate(body.commissionRate);
    const updated = await this.prisma.companionProfile.update({
      where: { userId: id },
      data: { commissionRate },
      include: { user: { select: { id: true, email: true, displayName: true } } }
    });

    await this.prisma.adminLog.create({
      data: {
        actorId: user.id,
        targetUserId: id,
        action: "UPDATE_COMPANION_COMMISSION",
        entityType: "COMPANION_PROFILE",
        entityId: updated.id,
        detail: { commissionRate: commissionRate.toString(), note: body.note }
      }
    });

    return {
      userId: updated.userId,
      email: updated.user.email,
      nickname: updated.nickname,
      commissionRate: updated.commissionRate.toString()
    };
  }

  @Patch("companions/:id/pricing")
  async updateCompanionPricing(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body()
    body: {
      pricePerHour: string;
      kookPricePerHour?: string | null;
      discordPricePerHour?: string | null;
      entertainmentPricePerHour?: string | null;
      rankedPricePerHour?: string | null;
      highRankedPricePerHour?: string | null;
      note?: string;
    }
  ) {
    const pricePerHour = parsePositiveDecimal(body.pricePerHour, "pricePerHour");
    const kookPricePerHour = parseOptionalPositiveDecimal(body.kookPricePerHour, "kookPricePerHour");
    const discordPricePerHour = parseOptionalPositiveDecimal(body.discordPricePerHour, "discordPricePerHour");
    const entertainmentPricePerHour = parseOptionalPositiveDecimal(body.entertainmentPricePerHour, "entertainmentPricePerHour");
    const rankedPricePerHour = parseOptionalPositiveDecimal(body.rankedPricePerHour, "rankedPricePerHour");
    const highRankedPricePerHour = parseOptionalPositiveDecimal(body.highRankedPricePerHour, "highRankedPricePerHour");
    const updated = await this.prisma.companionProfile.update({
      where: { userId: id },
      data: {
        pricePerHour,
        kookPricePerHour,
        discordPricePerHour,
        entertainmentPricePerHour,
        rankedPricePerHour,
        highRankedPricePerHour
      },
      include: { user: { select: { id: true, email: true, displayName: true } } }
    });

    await this.prisma.adminLog.create({
      data: {
        actorId: user.id,
        targetUserId: id,
        action: "UPDATE_COMPANION_PRICING",
        entityType: "COMPANION_PROFILE",
        entityId: updated.id,
        detail: {
          pricePerHour: updated.pricePerHour.toString(),
          kookPricePerHour: updated.kookPricePerHour?.toString() ?? null,
          discordPricePerHour: updated.discordPricePerHour?.toString() ?? null,
          entertainmentPricePerHour: updated.entertainmentPricePerHour?.toString() ?? null,
          rankedPricePerHour: updated.rankedPricePerHour?.toString() ?? null,
          highRankedPricePerHour: updated.highRankedPricePerHour?.toString() ?? null,
          note: body.note
        }
      }
    });

    return {
      userId: updated.userId,
      email: updated.user.email,
      nickname: updated.nickname,
      pricePerHour: updated.pricePerHour.toString(),
      kookPricePerHour: updated.kookPricePerHour?.toString() ?? null,
      discordPricePerHour: updated.discordPricePerHour?.toString() ?? null,
      entertainmentPricePerHour: updated.entertainmentPricePerHour?.toString() ?? null,
      rankedPricePerHour: updated.rankedPricePerHour?.toString() ?? null,
      highRankedPricePerHour: updated.highRankedPricePerHour?.toString() ?? null
    };
  }

  @Patch("companions/:id/games")
  async updateCompanionGames(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { game?: GameCode | string; games?: Array<GameCode | string>; note?: string }
  ) {
    const primaryGame = normalizeGameCode(body.game) ?? normalizeGameCode(body.games?.[0]);
    if (!primaryGame) throw new BadRequestException("game is required");
    const games = normalizeGameList(body.games, primaryGame);

    const updated = await this.prisma.companionProfile.update({
      where: { userId: id },
      data: {
        game: games[0],
        games
      },
      include: { user: { select: { id: true, email: true, displayName: true } } }
    });

    await this.prisma.adminLog.create({
      data: {
        actorId: user.id,
        targetUserId: id,
        action: "UPDATE_COMPANION_GAMES",
        entityType: "COMPANION_PROFILE",
        entityId: updated.id,
        detail: {
          game: updated.game,
          games: updated.games,
          note: body.note
        }
      }
    });

    return {
      userId: updated.userId,
      email: updated.user.email,
      nickname: updated.nickname,
      game: updated.game,
      games: updated.games
    };
  }

  @Patch("recharges/:id/review")
  reviewRecharge(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { status: "APPROVED" | "REJECTED"; note?: string }
  ) {
    return this.wallet.reviewRecharge(id, user.id, body);
  }

  @Patch("withdrawals/:id/review")
  reviewWithdrawal(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { status: "APPROVED" | "REJECTED" | "PAID"; note?: string; payoutReference?: string }
  ) {
    return this.wallet.reviewWithdrawal(id, user.id, body);
  }

  @Patch("orders/:id/assign")
  async assignOrder(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: { companionId: string; autoStart?: boolean }) {
    const assignment = await this.orders.assignOrder(id, body.companionId, user.id);
    if (!body.autoStart) return assignment;
    const startedOrder = await this.orders.startAssignedOrderByAdmin(id, user.id);
    return { ...assignment, order: startedOrder, autoStarted: true };
  }

  @Post("companions/:id/external-accounts")
  bindCompanionExternalAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body()
    body: {
      platform: "DISCORD" | "KOOK";
      externalUserId: string;
      displayName?: string;
    }
  ) {
    return this.externalAccounts.bindCompanionAccount(
      id,
      body.platform === "DISCORD" ? BotPlatform.DISCORD : BotPlatform.KOOK,
      body.externalUserId,
      body.displayName,
      user.id
    );
  }

  private async ensureDefaultPromotionSettings() {
    const defaults = promotionSettingDefaults();
    await this.prisma.$transaction(
      Object.entries(defaults).map(([key, description]) =>
        this.prisma.platformSetting.upsert({
          where: { key },
          create: { key, value: defaultPromotionSettingValue(key), description },
          update: { description }
        })
      )
    );
  }
}

function isDisplayNameUniqueError(error: Prisma.PrismaClientKnownRequestError) {
  return isUniqueErrorTarget(error, "displayNameKey");
}

function isUniqueErrorTarget(error: Prisma.PrismaClientKnownRequestError, field: string) {
  const target = error.meta?.target;
  return Array.isArray(target) && target.includes(field);
}

function displayUser(user: { email: string; displayName: string }) {
  return user.displayName || user.email;
}

function promotionSettingDefaults(): Record<string, string> {
  return {
    NEW_CUSTOMER_FIRST_RECHARGE_BONUS_RATE: "新客户首笔审核通过充值赠送比例，0.1 表示送 10%。",
    NEW_CUSTOMER_FIRST_RECHARGE_BONUS_AMOUNT: "新客户首笔审核通过充值固定赠送金额。",
    CUSTOMER_REFERRER_REWARD_AMOUNT: "老客户邀请新客户奖励金额，需要邀请码/邀请绑定后自动发放。",
    CUSTOMER_INVITEE_BONUS_AMOUNT: "被邀请新客户奖励金额，需要邀请码/邀请绑定后自动发放。",
    COMPANION_REFERRAL_REWARD_AMOUNT: "陪玩带来新客户的首单固定奖励金额，需要邀请绑定后自动发放。",
    COMPANION_REFERRAL_COMMISSION_RATE: "陪玩邀请码客户每次完成订单的持续推广分成比例，0.01 表示订单金额 1%。",
    MULTI_COMPANION_DISCOUNT_ENABLED: "多陪玩折扣开关，1 表示开启，0 表示关闭。",
    MULTI_COMPANION_DISCOUNT_MIN_COUNT: "同一客户点多少个陪玩起享受多陪玩折扣，默认 2。",
    MULTI_COMPANION_DISCOUNT_AMOUNT: "同一客户点 2 个及以上陪玩时，每个陪玩每小时减免金额，默认 10。",
    MULTI_COMPANION_DISCOUNT_FLOOR_PRICE: "多陪玩折扣后的单价地板价，默认 68。"
  };
}

function defaultPromotionSettingValue(key: string) {
  const defaults: Record<string, string> = {
    NEW_CUSTOMER_FIRST_RECHARGE_BONUS_RATE: "0.1",
    NEW_CUSTOMER_FIRST_RECHARGE_BONUS_AMOUNT: "0",
    CUSTOMER_REFERRER_REWARD_AMOUNT: "10",
    CUSTOMER_INVITEE_BONUS_AMOUNT: "10",
    COMPANION_REFERRAL_REWARD_AMOUNT: "20",
    COMPANION_REFERRAL_COMMISSION_RATE: "0.01",
    MULTI_COMPANION_DISCOUNT_ENABLED: "1",
    MULTI_COMPANION_DISCOUNT_MIN_COUNT: "2",
    MULTI_COMPANION_DISCOUNT_AMOUNT: "10",
    MULTI_COMPANION_DISCOUNT_FLOOR_PRICE: "68"
  };
  return defaults[key] ?? "0";
}

function parseNonNegativeDecimal(value: string, fieldName: string) {
  let decimal: Prisma.Decimal;
  try {
    decimal = new Prisma.Decimal(value);
  } catch {
    throw new BadRequestException(`${fieldName} must be a valid amount`);
  }
  if (decimal.lt(0)) throw new BadRequestException(`${fieldName} cannot be negative`);
  return decimal;
}

function parsePositiveDecimal(value: string, fieldName: string) {
  const decimal = parseNonNegativeDecimal(value, fieldName);
  if (decimal.lte(0)) throw new BadRequestException(`${fieldName} must be greater than 0`);
  return decimal;
}

function parseOptionalPositiveDecimal(value: string | null | undefined, fieldName: string) {
  if (!value?.trim()) return null;
  return parsePositiveDecimal(value, fieldName);
}

function parseCommissionRate(value: string) {
  const commissionRate = parseNonNegativeDecimal(value, "commissionRate");
  if (commissionRate.gt(1)) throw new BadRequestException("commissionRate cannot be greater than 1");
  return commissionRate;
}

function normalizePromotionCode(code: string | undefined) {
  return code?.trim().toUpperCase().replace(/\s+/g, "").slice(0, 32) ?? "";
}

function normalizeOptionalString(value?: string | null) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizeMediaUrls(urls?: string[]) {
  return (urls ?? [])
    .map((url) => url.trim())
    .filter(Boolean)
    .slice(0, 9);
}

function normalizeGameCode(value?: string | null) {
  const game = Object.values(GameCode).includes(value as GameCode) ? (value as GameCode) : undefined;
  return game && SUPPORTED_GAME_CODES.has(game) ? game : undefined;
}

function normalizeGameList(values: Array<GameCode | string> | undefined, primaryGame: GameCode) {
  const normalized = [primaryGame, ...(values ?? [])]
    .map((value) => normalizeGameCode(value))
    .filter((value): value is GameCode => Boolean(value));
  return Array.from(new Set(normalized)).slice(0, 24);
}

function parseOptionalDate(value: string | undefined, fieldName: string) {
  if (!value?.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${fieldName} must be a valid date`);
  }
  return date;
}

async function generateUniqueReferralCode(client: Prisma.TransactionClient | PrismaService, prefix: string) {
  for (let index = 0; index < 20; index += 1) {
    const code = `${prefix}${Math.floor(100000 + Math.random() * 900000)}`;
    const existing = await client.user.findUnique({
      where: { referralCode: code },
      select: { id: true }
    });
    if (!existing) return code;
  }
  return `${prefix}${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
}

async function generateAvailableDisplayNameKey(
  client: Prisma.TransactionClient | PrismaService,
  role: UserRole,
  displayName: string,
  userId: string
) {
  const baseKey = normalizeDisplayNameKey(displayName) || userId;

  for (let index = 0; index < 50; index += 1) {
    const candidate = index === 0 ? baseKey : `${baseKey}-${index + 1}`;
    const existing = await client.user.findFirst({
      where: {
        id: { not: userId },
        role,
        displayNameKey: candidate
      },
      select: { id: true }
    });
    if (!existing) return candidate;
  }

  return `${baseKey}-${Math.random().toString(16).slice(2, 8)}`;
}
