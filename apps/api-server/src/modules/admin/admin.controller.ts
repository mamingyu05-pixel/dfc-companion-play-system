import { BadRequestException, Body, Controller, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  BotPlatform,
  CompanionProfileStatus,
  DeltaForceRank,
  OnlineStatus,
  Prisma,
  UserRole,
  VoicePreference
} from "@prisma/client";
import { createPasswordHash } from "@dfc/auth";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
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
