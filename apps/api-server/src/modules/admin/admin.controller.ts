import { Body, Controller, Param, Patch, Post } from "@nestjs/common";
import { BotPlatform } from "@prisma/client";
import { OrdersService } from "../orders/orders.service";
import { CompanionExternalAccountsService } from "./companion-external-accounts.service";

@Controller("admin")
export class AdminController {
  constructor(
    private readonly orders: OrdersService,
    private readonly externalAccounts: CompanionExternalAccountsService
  ) {}

  @Post("companions")
  createCompanion(@Body() body: { email: string; password: string; nickname: string }) {
    return {
      accepted: true,
      next: "Create COMPANION user, wallet and companion profile; write admin_logs",
      nickname: body.nickname
    };
  }

  @Patch("recharges/:id/review")
  reviewRecharge(@Param("id") id: string, @Body() body: { status: "APPROVED" | "REJECTED"; note?: string }) {
    return {
      accepted: true,
      next: "If approved, credit customer available_balance and create wallet_transactions in one transaction",
      id,
      status: body.status
    };
  }

  @Patch("withdrawals/:id/review")
  reviewWithdrawal(@Param("id") id: string, @Body() body: { status: "APPROVED" | "REJECTED"; note?: string }) {
    return {
      accepted: true,
      next: "Freeze/release companion income according to manual payout review result",
      id,
      status: body.status
    };
  }

  @Patch("orders/:id/assign")
  assignOrder(@Param("id") id: string, @Body() body: { companionId: string; assignedById?: string }) {
    return this.orders.assignOrder(id, body.companionId, body.assignedById);
  }

  @Post("companions/:id/external-accounts")
  bindCompanionExternalAccount(
    @Param("id") id: string,
    @Body()
    body: {
      platform: "DISCORD" | "KOOK";
      externalUserId: string;
      displayName?: string;
      actorId?: string;
    }
  ) {
    return this.externalAccounts.bindCompanionAccount(
      id,
      body.platform === "DISCORD" ? BotPlatform.DISCORD : BotPlatform.KOOK,
      body.externalUserId,
      body.displayName,
      body.actorId
    );
  }
}
