import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  BotPlatform,
  CompanionProfileStatus,
  DeltaForceRank,
  OnlineStatus,
  Prisma,
  UserRole,
  UserStatus,
  VoicePreference
} from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { createPasswordHash } from "../auth/password.util";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { OrdersService } from "../orders/orders.service";
import { PrismaService } from "../prisma/prisma.service";
import { WalletService } from "../wallet/wallet.service";
import { CompanionExternalAccountsService } from "./companion-external-accounts.service";

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly wallet: WalletService,
    private readonly externalAccounts: CompanionExternalAccountsService
  ) {}

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
            status: true,
            onlineStatus: true,
            pricePerHour: true
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
              status: item.companionProfile.status,
              onlineStatus: item.companionProfile.onlineStatus,
              pricePerHour: item.companionProfile.pricePerHour.toString()
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
    @Body() body: { amount: string; note?: string }
  ) {
    return this.wallet.adminCreditCustomerBalance(id, user.id, body);
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
    if (body.password.length < 8) {
      throw new BadRequestException("Password must be at least 8 characters");
    }

    const passwordHash = await createPasswordHash(body.password);
    const role = body.role === "SUPER_ADMIN" ? UserRole.SUPER_ADMIN : UserRole.ADMIN;

    try {
      const created = await this.prisma.user.create({
        data: {
          email: body.email.trim().toLowerCase(),
          passwordHash,
          role,
          displayName: body.displayName.trim()
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
        throw new BadRequestException("Email is already registered");
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
        status: profile.status,
        onlineStatus: profile.onlineStatus,
        deltaForceRank: profile.deltaForceRank,
        skillModes: profile.skillModes,
        pricePerHour: profile.pricePerHour.toString(),
        availableIncome: profile.user.wallet?.availableIncome.toString() ?? "0",
        pendingIncome: profile.user.wallet?.pendingIncome.toString() ?? "0"
      }))
    );
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
      avatarUrl?: string;
      gender?: string;
      deltaForceRank?: DeltaForceRank;
      skillModes?: string[];
      bio?: string;
      voicePreference?: VoicePreference;
    }
  ) {
    const passwordHash = await createPasswordHash(body.password);
    let pricePerHour: Prisma.Decimal;
    try {
      pricePerHour = new Prisma.Decimal(body.pricePerHour);
    } catch {
      throw new BadRequestException("pricePerHour must be a valid amount");
    }
    if (pricePerHour.lte(0)) throw new BadRequestException("pricePerHour must be greater than 0");

    try {
      return await this.prisma.$transaction(async (tx) => {
        const companion = await tx.user.create({
          data: {
            email: body.email.toLowerCase(),
            passwordHash,
            role: UserRole.COMPANION,
            displayName: body.nickname,
            wallet: { create: {} },
            companionProfile: {
              create: {
                nickname: body.nickname,
                avatarUrl: body.avatarUrl,
                gender: body.gender,
                deltaForceRank: body.deltaForceRank ?? DeltaForceRank.UNRANKED,
                skillModes: body.skillModes ?? [],
                pricePerHour,
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
            detail: { nickname: body.nickname, pricePerHour: body.pricePerHour }
          }
        });

        return companion;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("Email is already registered");
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
  assignOrder(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: { companionId: string }) {
    return this.orders.assignOrder(id, body.companionId, user.id);
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
}
