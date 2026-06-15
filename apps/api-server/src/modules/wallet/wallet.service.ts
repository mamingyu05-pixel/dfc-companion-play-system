import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import {
  CompanionProfileStatus,
  Prisma,
  ReviewStatus,
  TransactionDirection,
  UserRole,
  UserStatus,
  WalletTransactionType,
  WithdrawalStatus
} from "@prisma/client";
import { BotNotificationService } from "../bot/bot-notification.service";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly botNotifications: BotNotificationService
  ) {}

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
        promotionBonus: request.promotionBonus.toString(),
        status: request.status,
        note: request.note,
        reviewNote: request.reviewNote,
        createdAt: request.createdAt
      }))
    };
  }

  async getCompanionWalletSummary(userId: string) {
    await this.assertCompanionAccess(userId);
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

  async getCompanionPayoutProfile(userId: string) {
    await this.assertCompanionAccess(userId);
    const profile = await this.prisma.companionProfile.findUnique({
      where: { userId },
      select: {
        payoutMethod: true,
        payoutAccountName: true,
        payoutAccountNo: true,
        payoutQrCodeUrl: true
      }
    });
    if (!profile) throw new BadRequestException("Companion profile does not exist");
    return profile;
  }

  async updateCompanionPayoutProfile(
    userId: string,
    body: { payoutMethod?: string; payoutAccountName?: string; payoutAccountNo?: string; payoutQrCodeUrl?: string }
  ) {
    await this.assertCompanionAccess(userId);
    const payoutMethod = sanitizeText(body.payoutMethod || "ALIPAY", 30);
    const payoutAccountName = sanitizeText(body.payoutAccountName, 50);
    const payoutAccountNo = sanitizeText(body.payoutAccountNo, 120);
    const payoutQrCodeUrl = sanitizeText(body.payoutQrCodeUrl, 2_500_000);

    if (!payoutAccountName || !payoutAccountNo) {
      throw new BadRequestException("payoutAccountName and payoutAccountNo are required");
    }

    return this.prisma.companionProfile.update({
      where: { userId },
      data: {
        payoutMethod,
        payoutAccountName,
        payoutAccountNo,
        payoutQrCodeUrl: payoutQrCodeUrl || null
      },
      select: {
        payoutMethod: true,
        payoutAccountName: true,
        payoutAccountNo: true,
        payoutQrCodeUrl: true
      }
    });
  }

  async createRechargeRequest(
    customerId: string,
    body: { amount: string; screenshotUrl: string; note?: string; promotionCode?: string }
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

    const promotion = body.promotionCode ? await this.findApplicablePromotionCode(body.promotionCode, amount) : null;
    const promotionBonus = promotion ? calculatePromotionBonus(amount, promotion) : new Prisma.Decimal(0);

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (promotion) {
          const existingUse = await tx.rechargeRequest.findFirst({
            where: {
              customerId,
              promotionCodeId: promotion.id,
              status: { not: ReviewStatus.REJECTED }
            },
            select: { id: true }
          });
          if (existingUse) {
            throw new BadRequestException("Promotion code can only be used once per customer");
          }

          if (promotion.usageLimit === null) {
            await tx.promotionCode.update({
              where: { id: promotion.id },
              data: { usedCount: { increment: 1 } }
            });
          } else {
            const reserved = await tx.promotionCode.updateMany({
              where: {
                id: promotion.id,
                usedCount: { lt: promotion.usageLimit }
              },
              data: { usedCount: { increment: 1 } }
            });
            if (reserved.count !== 1) throw new BadRequestException("Promotion code usage limit reached");
          }
        }

        return tx.rechargeRequest.create({
          data: {
            customerId,
            promotionCodeId: promotion?.id,
            amount,
            promotionBonus,
            screenshotUrl: body.screenshotUrl,
            note: body.note
          }
        });
      });
    } catch (error) {
      if (isPrismaErrorCode(error, "P2002")) {
        throw new BadRequestException("Promotion code can only be used once per customer");
      }
      throw error;
    }
  }

  async adminCreditCustomerBalance(
    customerId: string,
    operatorId: string,
    body: { amount: string; note?: string; direction?: "CREDIT" | "DEBIT" }
  ) {
    try {
      const amount = this.positiveDecimal(body.amount, "amount");
      const direction = body.direction === "DEBIT" ? TransactionDirection.DEBIT : TransactionDirection.CREDIT;

      return await this.prisma.$transaction(async (tx) => {
        const customer = await tx.user.findFirst({
          where: { id: customerId, role: UserRole.CUSTOMER, status: UserStatus.ACTIVE },
          include: { wallet: true }
        });
        if (!customer) throw new BadRequestException("Customer does not exist or is not active");

        if (direction === TransactionDirection.DEBIT && !customer.wallet) {
          throw new BadRequestException("Insufficient available balance");
        }

        const wallet =
          direction === TransactionDirection.CREDIT
            ? customer.wallet
              ? await tx.wallet.update({
                  where: { id: customer.wallet.id },
                  data: { availableBalance: { increment: amount } }
                })
              : await tx.wallet.create({
                  data: { userId: customerId, availableBalance: amount }
                })
            : await this.debitCustomerAvailableBalance(tx, customer.wallet!.id, amount);

        const transaction = await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            userId: customerId,
            operatorId,
            type: WalletTransactionType.ADMIN_ADJUSTMENT,
            direction,
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
            action: direction === TransactionDirection.CREDIT ? "ADMIN_CREDIT_BALANCE" : "ADMIN_DEBIT_BALANCE",
            entityType: "WALLET",
            entityId: wallet.id,
            detail: { direction, amount: amount.toString(), balanceAfter: wallet.availableBalance.toString(), note: body.note }
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
    } catch (error) {
      throw mapWalletOperationError(error);
    }
  }

  async reviewRecharge(
    rechargeRequestId: string,
    reviewerId: string,
    body: { status: "APPROVED" | "REJECTED"; note?: string }
  ) {
    if (!["APPROVED", "REJECTED"].includes(body.status)) {
      throw new BadRequestException("Invalid recharge review status");
    }

    const result = await this.prisma.$transaction(async (tx) => {
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
        if (request.promotionCodeId) {
          await tx.promotionCode.updateMany({
            where: { id: request.promotionCodeId, usedCount: { gt: 0 } },
            data: { usedCount: { decrement: 1 } }
          });
        }

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

      const approvedRechargeCount = await tx.rechargeRequest.count({
        where: {
          customerId: request.customerId,
          status: ReviewStatus.APPROVED,
          id: { not: rechargeRequestId }
        }
      });
      const firstRechargeBonus = approvedRechargeCount === 0
        ? await this.calculateFirstRechargeBonus(tx, request.amount)
        : new Prisma.Decimal(0);
      const promotionCodeBonus = request.promotionBonus ?? new Prisma.Decimal(0);
      const creditAmount = request.amount.add(firstRechargeBonus).add(promotionCodeBonus);

      const wallet = await tx.wallet.update({
        where: { userId: request.customerId },
        data: { availableBalance: { increment: creditAmount } }
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

      if (firstRechargeBonus.gt(0)) {
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            userId: request.customerId,
            operatorId: reviewerId,
            type: WalletTransactionType.PROMOTION_BONUS,
            direction: TransactionDirection.CREDIT,
            amount: firstRechargeBonus,
            balanceAfter: wallet.availableBalance,
            referenceType: "RECHARGE_REQUEST",
            referenceId: rechargeRequestId,
            note: "New customer first recharge bonus"
          }
        });
      }

      if (promotionCodeBonus.gt(0)) {
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            userId: request.customerId,
            operatorId: reviewerId,
            type: WalletTransactionType.PROMOTION_BONUS,
            direction: TransactionDirection.CREDIT,
            amount: promotionCodeBonus,
            balanceAfter: wallet.availableBalance,
            referenceType: "RECHARGE_PROMOTION_CODE",
            referenceId: request.promotionCodeId,
            note: "Recharge promotion code bonus"
          }
        });
      }

      await tx.adminLog.create({
        data: {
          actorId: reviewerId,
          targetUserId: request.customerId,
          action: "APPROVE_RECHARGE",
          entityType: "RECHARGE_REQUEST",
          entityId: rechargeRequestId,
          detail: {
            amount: request.amount.toString(),
            firstRechargeBonus: firstRechargeBonus.toString(),
            promotionCodeBonus: promotionCodeBonus.toString(),
            promotionCodeId: request.promotionCodeId,
            totalCredit: creditAmount.toString(),
            note: body.note
          }
        }
      });

      return tx.rechargeRequest.findUniqueOrThrow({ where: { id: rechargeRequestId } });
    });

    if (result.status === ReviewStatus.APPROVED) {
      await this.botNotifications.syncCustomerMembershipLevels(result.customerId).catch(() => undefined);
    }

    return result;
  }

  async createWithdrawalRequest(
    companionId: string,
    body: { amount: string; payoutAccount: string; note?: string }
  ) {
    const amount = this.positiveDecimal(body.amount, "amount");

    return this.prisma.$transaction(async (tx) => {
      const companion = await tx.user.findFirst({
        where: {
          id: companionId,
          status: UserStatus.ACTIVE,
          companionProfile: { is: { status: { not: CompanionProfileStatus.BANNED } } }
        },
        include: { wallet: true, companionProfile: true }
      });
      if (!companion?.wallet) throw new BadRequestException("Companion wallet does not exist");
      const payoutAccount = sanitizeText(body.payoutAccount, 500) || buildPayoutAccount(companion.companionProfile);
      if (!payoutAccount) throw new BadRequestException("payoutAccount is required");

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
          payoutAccount,
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

  private async assertCompanionAccess(userId: string) {
    const companion = await this.prisma.user.findFirst({
      where: {
        id: userId,
        status: UserStatus.ACTIVE,
        companionProfile: { is: { status: { not: CompanionProfileStatus.BANNED } } }
      },
      select: { id: true }
    });
    if (!companion) throw new BadRequestException("Companion profile does not exist or is unavailable");
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

  private async calculateFirstRechargeBonus(tx: Prisma.TransactionClient, rechargeAmount: Prisma.Decimal) {
    const [rateSetting, fixedSetting] = await Promise.all([
      tx.platformSetting.findUnique({ where: { key: "NEW_CUSTOMER_FIRST_RECHARGE_BONUS_RATE" } }),
      tx.platformSetting.findUnique({ where: { key: "NEW_CUSTOMER_FIRST_RECHARGE_BONUS_AMOUNT" } })
    ]);
    const rate = this.nonNegativeDecimal(rateSetting?.value ?? "0", "NEW_CUSTOMER_FIRST_RECHARGE_BONUS_RATE");
    const fixed = this.nonNegativeDecimal(fixedSetting?.value ?? "0", "NEW_CUSTOMER_FIRST_RECHARGE_BONUS_AMOUNT");
    return rechargeAmount.mul(rate).add(fixed).toDecimalPlaces(2);
  }

  private async findApplicablePromotionCode(code: string, rechargeAmount: Prisma.Decimal) {
    const normalizedCode = normalizePromotionCode(code);
    if (!normalizedCode) return null;

    const promotion = await this.prisma.promotionCode.findUnique({ where: { code: normalizedCode } });
    const now = new Date();
    if (!promotion || !promotion.isActive) {
      throw new BadRequestException("Promotion code is invalid");
    }
    if (promotion.startsAt && promotion.startsAt > now) {
      throw new BadRequestException("Promotion code is not active yet");
    }
    if (promotion.endsAt && promotion.endsAt < now) {
      throw new BadRequestException("Promotion code is expired");
    }
    if (promotion.usageLimit !== null && promotion.usedCount >= promotion.usageLimit) {
      throw new BadRequestException("Promotion code usage limit reached");
    }
    if (rechargeAmount.lt(promotion.minRecharge)) {
      throw new BadRequestException("Recharge amount does not meet promotion code minimum");
    }

    const bonus = calculatePromotionBonus(rechargeAmount, promotion);
    if (bonus.lte(0)) {
      throw new BadRequestException("Promotion code has no bonus");
    }

    return promotion;
  }

  private nonNegativeDecimal(value: string, fieldName: string) {
    let decimal: Prisma.Decimal;
    try {
      decimal = new Prisma.Decimal(value);
    } catch {
      throw new BadRequestException(`${fieldName} must be a valid amount`);
    }
    if (decimal.lt(0)) throw new BadRequestException(`${fieldName} cannot be negative`);
    return decimal;
  }

  private async debitCustomerAvailableBalance(tx: Prisma.TransactionClient, walletId: string, amount: Prisma.Decimal) {
    const updated = await tx.wallet.updateMany({
      where: {
        id: walletId,
        availableBalance: { gte: amount }
      },
      data: { availableBalance: { decrement: amount } }
    });

    if (updated.count !== 1) {
      throw new BadRequestException("Insufficient available balance");
    }

    return tx.wallet.findUniqueOrThrow({ where: { id: walletId } });
  }
}

function mapWalletOperationError(error: unknown) {
  if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof InternalServerErrorException) {
    return error;
  }
  if (isPrismaErrorCode(error, "P2021") || isPrismaErrorCode(error, "P2022")) {
    return new InternalServerErrorException("Database migration is not applied");
  }
  if (isPrismaErrorCode(error, "P2003")) {
    return new BadRequestException("Related account or wallet data is invalid");
  }
  return error;
}

function isPrismaErrorCode(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === code;
}

function sanitizeText(value: string | null | undefined, maxLength: number) {
  return (value ?? "").trim().slice(0, maxLength);
}

function normalizePromotionCode(code: string | undefined) {
  return code?.trim().toUpperCase().replace(/\s+/g, "").slice(0, 32) ?? "";
}

function calculatePromotionBonus(
  rechargeAmount: Prisma.Decimal,
  promotion: { bonusAmount: Prisma.Decimal; bonusRate: Prisma.Decimal; maxBonusAmount: Prisma.Decimal | null }
) {
  let bonus = promotion.bonusAmount.add(rechargeAmount.mul(promotion.bonusRate));
  if (promotion.maxBonusAmount && bonus.gt(promotion.maxBonusAmount)) {
    bonus = promotion.maxBonusAmount;
  }
  return bonus.toDecimalPlaces(2);
}

function buildPayoutAccount(profile?: { payoutMethod: string | null; payoutAccountName: string | null; payoutAccountNo: string | null } | null) {
  if (!profile?.payoutAccountName || !profile.payoutAccountNo) return "";
  const method = profile.payoutMethod || "ALIPAY";
  return `${method}: ${profile.payoutAccountName} / ${profile.payoutAccountNo}`;
}
