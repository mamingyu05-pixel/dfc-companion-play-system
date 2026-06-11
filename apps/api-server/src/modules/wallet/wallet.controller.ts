import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
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

  @Post("recharge-requests")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  createRechargeRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { amount: string; screenshotUrl: string; note?: string }
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
}
