import { Body, Controller, Get, Patch, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { WalletService } from "./wallet.service";

@Controller("wallet")
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get("me")
  @UseGuards(JwtAuthGuard)
  getMyWallet(@CurrentUser() user: AuthenticatedUser) {
    return this.wallet.getWallet(user.id);
  }

  @Get("customer-summary")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  getCustomerWalletSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.wallet.getCustomerWalletSummary(user.id);
  }

  @Get("companion-summary")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.COMPANION)
  getCompanionWalletSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.wallet.getCompanionWalletSummary(user.id);
  }

  @Post("recharge-requests")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  createRechargeRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { amount: string; screenshotUrl: string; note?: string; promotionCode?: string }
  ) {
    return this.wallet.createRechargeRequest(user.id, body);
  }

  @Post("withdrawal-requests")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.COMPANION)
  createWithdrawalRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { amount: string; payoutAccount: string; note?: string }
  ) {
    return this.wallet.createWithdrawalRequest(user.id, body);
  }

  @Get("companion-payout-profile")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.COMPANION)
  getCompanionPayoutProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.wallet.getCompanionPayoutProfile(user.id);
  }

  @Patch("companion-payout-profile")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.COMPANION)
  updateCompanionPayoutProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { payoutMethod?: string; payoutAccountName?: string; payoutAccountNo?: string; payoutQrCodeUrl?: string }
  ) {
    return this.wallet.updateCompanionPayoutProfile(user.id, body);
  }
}
