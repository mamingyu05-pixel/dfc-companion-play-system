import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  Prisma,
  ReviewStatus,
  TransactionDirection,
  UserRole,
  UserStatus,
  WalletTransactionType,
  WithdrawalStatus
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  getWallet(userId: string) {
    return this.prisma.wallet.findUnique({
      where: { userId },
      include: {
        transactions: {
          orderBy: { createdAt: "desc" },
          take: 30
        }
      }
    });
  }

  async getCustomerWalletSummary(userId: string) {
    const [wallet, rechargeRequests] = await Promise.all([
      this.prisma.wallet.findUnique({
        where: { userId },
        include: {
          transactions: {
            orderBy: { createdAt: "desc" },
            take: 20
          }
        }
      }),
      this.prisma.rechargeRequest.findMany({
        where: { customerId: userId },
        orderBy: { createdAt: "desc" },
        take: 20
      })
    ]);

    const pendingRechargeAmount = rechargeRequests
      .filter((request) => request.status === ReviewStatus.PENDING)
      .reduce((total, request) => total.add(request.amount), new Prisma.Decimal(0));

    return {
      wallet: wallet
        ? {
            id: wallet.id,
            availableBalance: wallet.availableBalance.toString(),
            frozenBalance: wallet.frozenBalance.toString(),
            transactions: wallet.transactions.map((transaction) => ({
              id: transaction.id,
              type: transaction.type,
              direction: transaction.direction,
              amount: transaction.amount.toString(),
              balanceAfter: transaction.balanceAfter.toString(),
              createdAt: transaction.createdAt
            }))
          }
        : null,
      pendingRechargeAmount: pendingRechargeAmount.toString(),
      rechargeRequests: rechargeRequests.map((request) => ({
        id: request.id,
        amount: request.amount.toString(),
        status: request.status,
        note: request.note,
        reviewNote: request.reviewNote,
        createdAt: request.createdAt
      }))
    };
  }

  async getCompanionWalletSummary(userId: string) {
    const [wallet, withdrawalRequests] = await Promise.all([
      this.prisma.wallet.findUnique({
        where: { userId },
        include: {
          transactions: {
            orderBy: { createdAt: "desc" },
            take: 20
          }
        }
      }),
      this.prisma.withdrawalRequest.findMany({
        where: { companionId: userId },
        orderBy: { createdAt: "desc" },
        take: 20
      })
    ]);

    const withdrawingAmount = withdrawalRequests
      .filter((request) => request.status === WithdrawalStatus.PENDING || request.status === WithdrawalStatus.APPROVED)
      .reduce((total, request) => total.add(request.amount), new Prisma.Decimal(0));

    return {
      wallet: wallet
        ? {
            id: wallet.id,
            availableIncome: wallet.availableIncome.toString(),
            pendingIncome: wallet.pendingIncome.toString(),
            frozenIncome: wallet.frozenIncome.toString(),
            transactions: wallet.transactions.map((transaction) => ({
              id: transaction.id,
              type: transaction.type,
              direction: transaction.direction,
              amount: transaction.amount.toString(),
              balanceAfter: transaction.balanceAfter.toString(),
              createdAt: transaction.createdAt
            }))
          }
        : null,
      withdrawingAmount: withdrawingAmount.toString(),
      withdrawalRequests: withdrawalRequests.map((request) => ({
        id: request.id,
        amount: request.amount.toString(),
        payoutAccount: request.payoutAccount,
        status: request.status,
        note: request.note,
        reviewNote: request.reviewNote,
        payoutReference: request.payoutReference,
        createdAt: request.createdAt
      }))
    };
  }

  async createRechargeRequest(
    customerId: string,
    body: { amount: string; screenshotUrl: string; note?: string }
  ) {
    const amount = this.positiveDecimal(body.amount, "amount");
    if (!body.screenshotUrl) throw new BadRequestException("screenshotUrl is required");
    if (body.screenshotUrl.length > 2_500_000) {
      throw new BadRequestException("screenshotUrl is too large");
    }

    const customer = await this.prisma.user.findFirst({
      where: { id: customerId, role: UserRole.CUSTOMER, status: UserStatus.ACTIVE }
    });
    if (!customer) throw new BadRequestException("Customer does not exist or is not active");

    return this.prisma.rechargeRequest.create({
      data: {
        customerId,
        amount,
        screenshotUrl: body.screenshotUrl,
        note: body.note
      }
    });
  }

  async adminCreditCustomerBalance(
    customerId: string,
    operatorId: string,
    body: { amount: string; note?: string }
  ) {
    const amount = this.positiveDecimal(body.amount, "amount");

    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.user.findFirst({
        where: { id: customerId, role: UserRole.CUSTOMER, status: UserStatus.ACTIVE },
        include: { wallet: true }
      });
      if (!customer) throw new BadRequestException("Customer does not exist or is not active");

      const wallet = customer.wallet
        ? await tx.wallet.update({
            where: { id: customer.wallet.id },
            data: { availableBalance: { increment: amount } }
          })
        : await tx.wallet.create({
            data: { userId: customerId, availableBalance: amount }
          });

      const transaction = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId: customerId,
          operatorId,
          type: WalletTransactionType.ADMIN_ADJUSTMENT,
          direction: TransactionDirection.CREDIT,
          amount,
          balanceAfter: wallet.availableBalance,
          referenceType: "ADMIN_BALANCE_ADJUSTMENT",
          referenceId: customerId,
          note: body.note
        }
      });

      await tx.adminLog.create({
        data: {
          actorId: operatorId,
          targetUserId: customerId,
          action: "ADMIN_CREDIT_BALANCE",
          entityType: "WALLET",
          entityId: wallet.id,
          detail: { amount: amount.toString(), balanceAfter: wallet.availableBalance.toString(), note: body.note }
        }
      });

      return {
        wallet: {
          id: wallet.id,
          availableBalance: wallet.availableBalance.toString(),
          frozenBalance: wallet.frozenBalance.toString()
        },
        transaction: {
          id: transaction.id,
          amount: transaction.amount.toString(),
          balanceAfter: transaction.balanceAfter.toString()
        }
      };
    });
  }

  async reviewRecharge(
    rechargeRequestId: string,
    reviewerId: string,
    body: { status: "APPROVED" | "REJECTED"; note?: string }
  ) {
    if (!["APPROVED", "REJECTED"].includes(body.status)) {
      throw new BadRequestException("Invalid recharge review status");
    }

    return this.prisma.$transaction(async (tx) => {
      const request = await tx.rechargeRequest.findUnique({
        where: { id: rechargeRequestId },
        include: { customer: { include: { wallet: true } } }
      });

      if (!request) throw new NotFoundException("Recharge request not found");
      if (request.status !== ReviewStatus.PENDING) throw new BadRequestException("Recharge request was already reviewed");
      if (!request.customer.wallet) {
        await tx.wallet.create({ data: { userId: request.customerId } });
      }

      const status = body.status === "APPROVED" ? ReviewStatus.APPROVED : ReviewStatus.REJECTED;
      const reviewed = await tx.rechargeRequest.updateMany({
        where: { id: rechargeRequestId, status: ReviewStatus.PENDING },
        data: {
          status,
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          reviewNote: body.note
        }
      });
      if (reviewed.count !== 1) throw new BadRequestException("Recharge request was already reviewed");

      if (status === ReviewStatus.REJECTED) {
        await tx.adminLog.create({
          data: {
            actorId: reviewerId,
            targetUserId: request.customerId,
            action: "REJECT_RECHARGE",
            entityType: "RECHARGE_REQUEST",
            entityId: rechargeRequestId,
            detail: { amount: request.amount.toString(), note: body.note }
          }
        });
        return tx.rechargeRequest.findUniqueOrThrow({ where: { id: rechargeRequestId } });
      }

      const wallet = await tx.wallet.update({
        where: { userId: request.customerId },
        data: { availableBalance: { increment: request.amount } }
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId: request.customerId,
          operatorId: reviewerId,
          type: WalletTransactionType.RECHARGE_APPROVED,
          direction: TransactionDirection.CREDIT,
          amount: request.amount,
          balanceAfter: wallet.availableBalance,
          referenceType: "RECHARGE_REQUEST",
          referenceId: rechargeRequestId,
          note: body.note
        }
      });

      await tx.adminLog.create({
        data: {
          actorId: reviewerId,
          targetUserId: request.customerId,
          action: "APPROVE_RECHARGE",
          entityType: "RECHARGE_REQUEST",
          entityId: rechargeRequestId,
          detail: { amount: request.amount.toString(), note: body.note }
        }
      });

      return tx.rechargeRequest.findUniqueOrThrow({ where: { id: rechargeRequestId } });
    });
  }

  async createWithdrawalRequest(
    companionId: string,
    body: { amount: string; payoutAccount: string; note?: string }
  ) {
    const amount = this.positiveDecimal(body.amount, "amount");
    if (!body.payoutAccount) throw new BadRequestException("payoutAccount is required");

    return this.prisma.$transaction(async (tx) => {
      const companion = await tx.user.findFirst({
        where: { id: companionId, role: UserRole.COMPANION, status: UserStatus.ACTIVE },
        include: { wallet: true }
      });
      if (!companion?.wallet) throw new BadRequestException("Companion wallet does not exist");

      const frozen = await tx.wallet.updateMany({
        where: {
          id: companion.wallet.id,
          availableIncome: { gte: amount }
        },
        data: {
          availableIncome: { decrement: amount },
          frozenIncome: { increment: amount }
        }
      });
      if (frozen.count !== 1) throw new BadRequestException("Insufficient available income");

      const walletAfter = await tx.wallet.findUniqueOrThrow({ where: { id: companion.wallet.id } });
      const request = await tx.withdrawalRequest.create({
        data: {
          companionId,
          amount,
          payoutAccount: body.payoutAccount,
          note: body.note
        }
      });

      await tx.walletTransaction.create({
        data: {
          walletId: companion.wallet.id,
          userId: companionId,
          type: WalletTransactionType.WITHDRAWAL_FREEZE,
          direction: TransactionDirection.DEBIT,
          amount,
          balanceAfter: walletAfter.availableIncome,
          referenceType: "WITHDRAWAL_REQUEST",
          referenceId: request.id,
          note: "Withdrawal request freeze"
        }
      });

      return request;
    });
  }

  async reviewWithdrawal(
    withdrawalRequestId: string,
    reviewerId: string,
    body: { status: "APPROVED" | "REJECTED" | "PAID"; note?: string; payoutReference?: string }
  ) {
    if (!["APPROVED", "REJECTED", "PAID"].includes(body.status)) {
      throw new BadRequestException("Invalid withdrawal review status");
    }

    return this.prisma.$transaction(async (tx) => {
      const request = await tx.withdrawalRequest.findUnique({
        where: { id: withdrawalRequestId },
        include: { companion: { include: { wallet: true } } }
      });

      if (!request) throw new NotFoundException("Withdrawal request not found");
      if (!request.companion.wallet) throw new BadRequestException("Companion wallet does not exist");
      if (request.status !== WithdrawalStatus.PENDING && request.status !== WithdrawalStatus.APPROVED) {
        throw new BadRequestException("Withdrawal request cannot be reviewed from current status");
      }

      if (body.status === "REJECTED") {
        if (request.status !== WithdrawalStatus.PENDING) {
          throw new BadRequestException("Only PENDING withdrawals can be rejected");
        }

        await this.changeWithdrawalStatus(
          tx,
          withdrawalRequestId,
          WithdrawalStatus.PENDING,
          WithdrawalStatus.REJECTED,
          reviewerId,
          body
        );

        const released = await tx.wallet.updateMany({
          where: {
            id: request.companion.wallet.id,
            frozenIncome: { gte: request.amount }
          },
          data: {
            frozenIncome: { decrement: request.amount },
            availableIncome: { increment: request.amount }
          }
        });
        if (released.count !== 1) throw new BadRequestException("Withdrawal frozen income is insufficient");

        const walletAfter = await tx.wallet.findUniqueOrThrow({ where: { id: request.companion.wallet.id } });
        await tx.walletTransaction.create({
          data: {
            walletId: request.companion.wallet.id,
            userId: request.companionId,
            operatorId: reviewerId,
            type: WalletTransactionType.WITHDRAWAL_REJECTED,
            direction: TransactionDirection.CREDIT,
            amount: request.amount,
            balanceAfter: walletAfter.availableIncome,
            referenceType: "WITHDRAWAL_REQUEST",
            referenceId: withdrawalRequestId,
            note: body.note
          }
        });

        await this.writeWithdrawalAdminLog(
          tx,
          withdrawalRequestId,
          reviewerId,
          request.companionId,
          WithdrawalStatus.REJECTED,
          body
        );
        return tx.withdrawalRequest.findUniqueOrThrow({ where: { id: withdrawalRequestId } });
      }

      if (body.status === "APPROVED") {
        if (request.status !== WithdrawalStatus.PENDING) {
          throw new BadRequestException("Only PENDING withdrawals can be approved");
        }
        await this.changeWithdrawalStatus(
          tx,
          withdrawalRequestId,
          WithdrawalStatus.PENDING,
          WithdrawalStatus.APPROVED,
          reviewerId,
          body
        );
        await this.writeWithdrawalAdminLog(
          tx,
          withdrawalRequestId,
          reviewerId,
          request.companionId,
          WithdrawalStatus.APPROVED,
          body
        );
        return tx.withdrawalRequest.findUniqueOrThrow({ where: { id: withdrawalRequestId } });
      }

      if (request.status !== WithdrawalStatus.APPROVED) {
        throw new BadRequestException("Withdrawal must be APPROVED before marking PAID");
      }

      await this.changeWithdrawalStatus(
        tx,
        withdrawalRequestId,
        WithdrawalStatus.APPROVED,
        WithdrawalStatus.PAID,
        reviewerId,
        body
      );

      const paid = await tx.wallet.updateMany({
        where: {
          id: request.companion.wallet.id,
          frozenIncome: { gte: request.amount }
        },
        data: {
          frozenIncome: { decrement: request.amount }
        }
      });
      if (paid.count !== 1) throw new BadRequestException("Withdrawal frozen income is insufficient");

      const walletAfter = await tx.wallet.findUniqueOrThrow({ where: { id: request.companion.wallet.id } });
      await tx.walletTransaction.create({
        data: {
          walletId: request.companion.wallet.id,
          userId: request.companionId,
          operatorId: reviewerId,
          type: WalletTransactionType.WITHDRAWAL_COMPLETED,
          direction: TransactionDirection.DEBIT,
          amount: request.amount,
          balanceAfter: walletAfter.frozenIncome,
          referenceType: "WITHDRAWAL_REQUEST",
          referenceId: withdrawalRequestId,
          note: body.note
        }
      });

      await this.writeWithdrawalAdminLog(
        tx,
        withdrawalRequestId,
        reviewerId,
        request.companionId,
        WithdrawalStatus.PAID,
        body
      );
      return tx.withdrawalRequest.findUniqueOrThrow({ where: { id: withdrawalRequestId } });
    });
  }

  private async changeWithdrawalStatus(
    tx: Prisma.TransactionClient,
    withdrawalRequestId: string,
    fromStatus: WithdrawalStatus,
    status: WithdrawalStatus,
    reviewerId: string,
    body: { note?: string; payoutReference?: string }
  ) {
    const changed = await tx.withdrawalRequest.updateMany({
      where: { id: withdrawalRequestId, status: fromStatus },
      data: {
        status,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewNote: body.note,
        paidAt: status === WithdrawalStatus.PAID ? new Date() : undefined,
        payoutReference: body.payoutReference
      }
    });

    if (changed.count !== 1) {
      throw new BadRequestException("Withdrawal request was already changed");
    }
  }

  private async writeWithdrawalAdminLog(
    tx: Prisma.TransactionClient,
    withdrawalRequestId: string,
    reviewerId: string,
    companionId: string,
    status: WithdrawalStatus,
    body: { note?: string; payoutReference?: string }
  ) {
    await tx.adminLog.create({
      data: {
        actorId: reviewerId,
        targetUserId: companionId,
        action: `${status}_WITHDRAWAL`,
        entityType: "WITHDRAWAL_REQUEST",
        entityId: withdrawalRequestId,
        detail: { status, note: body.note, payoutReference: body.payoutReference }
      }
    });
  }

  private positiveDecimal(value: string, fieldName: string) {
    let decimal: Prisma.Decimal;
    try {
      decimal = new Prisma.Decimal(value);
    } catch {
      throw new BadRequestException(`${fieldName} must be a valid amount`);
    }
    if (decimal.lte(0)) throw new BadRequestException(`${fieldName} must be greater than 0`);
    return decimal;
  }
}
