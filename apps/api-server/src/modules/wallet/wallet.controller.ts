import { Body, Controller, Get, Post } from "@nestjs/common";

@Controller("wallet")
export class WalletController {
  @Get("me")
  getMyWallet() {
    return {
      accepted: true,
      next: "Return wallet balances and latest wallet_transactions for current JWT user"
    };
  }

  @Post("recharge-requests")
  createRechargeRequest(@Body() body: { amount: string; screenshotUrl: string; note?: string }) {
    return {
      accepted: true,
      next: "Create pending recharge request and notify admin Discord channel",
      amount: body.amount
    };
  }

  @Post("withdrawal-requests")
  createWithdrawalRequest(@Body() body: { amount: string; payoutAccount: string; note?: string }) {
    return {
      accepted: true,
      next: "Create pending withdrawal request for COMPANION and notify admin Discord channel",
      amount: body.amount
    };
  }
}
