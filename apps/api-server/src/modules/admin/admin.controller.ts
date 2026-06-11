import { BadRequestException, Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
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
    const pricePerHour = new Prisma.Decimal(body.pricePerHour);
    if (pricePerHour.lte(0)) throw new BadRequestException("pricePerHour must be greater than 0");

    return this.prisma.$transaction(async (tx) => {
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
