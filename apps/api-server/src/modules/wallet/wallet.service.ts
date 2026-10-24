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
import { fixedDecimal, money } from "../financial-values";

import { validateRechargeScreenshot } from "./upload-evidence";

const MANUAL_RECHARGE_EVIDENCE = "MANUAL_SUPPORT_CONFIRMATION";
export const PROVIDER_RECHARGE_EVIDENCE_PREFIX = "PROVIDER_PAYMENT:";
const STAFF_RECHARGE_METHODS: Record<string, string> = { WECHAT: "微信", ALIPAY: "支付宝", BANK: "银行卡", OTHER: "其他" };

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
        where: { customerId: userId, NOT: { screenshotUrl: { startsWith: PROVIDER_RECHARGE_EVIDENCE_PREFIX } } },
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
    const [wallet, withdrawalRequests, disputeReserve] = await Promise.all([
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
      }),
      this.disputedIncome(this.prisma, userId)
    ]);

    const withdrawingAmount = wallet?.frozenIncome ?? new Prisma.Decimal(0);

    return {
      wallet: wallet
        ? {
            id: wallet.id,
            availableIncome: Prisma.Decimal.max(0, wallet.availableIncome.sub(disputeReserve)).toString(),
            availableIncomeBeforeDisputeReserve: wallet.availableIncome.toString(),
            disputeReserve: disputeReserve.toString(),
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
    body: { amount: string; screenshotUrl?: string; note?: string; promotionCode?: string; requestId?: unknown }
  ) {
    const requestId = optionalRequestId(body.requestId);
    const replay = async () => {
      if (!requestId) return null;
      const prior = await this.prisma.rechargeRequest.findUnique({ where: { customerId_requestId: { customerId, requestId } } });
      if (prior) assertSameAmount(prior.amount, this.positiveDecimal(body.amount, "amount"));
      return prior;
    };
    // A retry after a lost response returns the request the first attempt created.
    const prior = await replay();
    if (prior) return prior;
    try { return await this.prisma.$transaction(tx => this.createRechargeInTransaction(tx, customerId, body, undefined, requestId)); }
    catch (error) {
      if (isPrismaErrorCode(error, "P2002")) {
        const raced = await replay();
        if (raced) return raced;
        throw new BadRequestException("Promotion code can only be used once per customer");
      }
      throw error;
    }
  }

  // Internal provider entry; the public manual DTO cannot create this evidence marker.
  createProviderRechargeInTransaction(
    tx: Prisma.TransactionClient, customerId: string, paymentOrderId: string,
    body: { amount: string; note?: string; promotionCode?: string }
  ) {
    return this.createRechargeInTransaction(tx, customerId, body, `${PROVIDER_RECHARGE_EVIDENCE_PREFIX}${paymentOrderId}`);
  }

  private async createRechargeInTransaction(
    tx: Prisma.TransactionClient, customerId: string,
    body: { amount: string; screenshotUrl?: string; note?: string; promotionCode?: string }, providerEvidence?: string, requestId?: string
  ) {
    const amount = this.positiveDecimal(body.amount, "amount");
    const screenshotUrl = providerEvidence ?? validateRechargeScreenshot(body.screenshotUrl);

    const customer = await tx.user.findFirst({
      where: { id: customerId, role: UserRole.CUSTOMER, status: UserStatus.ACTIVE }
    });
    if (!customer) throw new BadRequestException("Customer does not exist or is not active");

    const promotion = body.promotionCode ? await this.findApplicablePromotionCode(body.promotionCode, amount, tx) : null;
    const promotionCodeBonus = promotion ? calculatePromotionBonus(amount, promotion) : new Prisma.Decimal(0);
    const predepositBonus = calculatePredepositBonus(amount);
    const promotionBonus = promotionCodeBonus.add(predepositBonus);

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
        screenshotUrl: screenshotUrl || MANUAL_RECHARGE_EVIDENCE,
        note: body.note,
        requestId
      }
    });
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
      const identity = await tx.rechargeRequest.findUnique({ where: { id: rechargeRequestId }, select: { customerId: true } });
      if (!identity) throw new NotFoundException("Recharge request not found");
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${identity.customerId} FOR UPDATE`;
      const request = await tx.rechargeRequest.findUnique({
        where: { id: rechargeRequestId },
        include: { customer: { include: { wallet: true } } }
      });

      if (!request) throw new NotFoundException("Recharge request not found");
      if (request.screenshotUrl.startsWith(PROVIDER_RECHARGE_EVIDENCE_PREFIX)) throw new BadRequestException("支付渠道充值不能通过人工审核入账");
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

      const { firstRechargeBonus, rechargeBonus, creditAmount } = await this.creditApprovedRecharge(tx, request, reviewerId, body.note);

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
            rechargeBonus: rechargeBonus.toString(),
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

  // Customers usually pay support staff directly (WeChat / Alipay). Staff record that payment here and it is
  // credited exactly like an approved recharge, so it counts toward membership level. requestId makes a
  // double-click or retry replay the first result instead of crediting twice.
  async recordStaffRecharge(
    customerId: string,
    staffId: string,
    body: { amount?: unknown; method?: unknown; screenshotUrl?: unknown; note?: unknown; requestId?: unknown }
  ) {
    const requestId = typeof body.requestId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(body.requestId) ? body.requestId : null;
    if (!requestId) throw new BadRequestException("requestId 无效");
    const methodLabel = STAFF_RECHARGE_METHODS[String(body.method)];
    if (!methodLabel) throw new BadRequestException("请选择付款方式");
    const extra = typeof body.note === "string" ? body.note.trim().slice(0, 200) : "";
    const note = `客服代录·${methodLabel}${extra ? `·${extra}` : ""}`;
    const businessKey = `staff-recharge:${requestId}`;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${customerId} FOR UPDATE`;
      const replay = await tx.walletTransaction.findUnique({ where: { businessKey }, select: { referenceId: true, userId: true } });
      if (replay) {
        if (replay.userId !== customerId || !replay.referenceId) throw new BadRequestException("requestId 已用于其他客户");
        return { replayed: true, recharge: await tx.rechargeRequest.findUniqueOrThrow({ where: { id: replay.referenceId } }) };
      }
      const created = await this.createRechargeInTransaction(tx, customerId, {
        amount: typeof body.amount === "string" || typeof body.amount === "number" ? String(body.amount) : "",
        screenshotUrl: typeof body.screenshotUrl === "string" ? body.screenshotUrl : undefined,
        note
      });
      await tx.rechargeRequest.update({ where: { id: created.id }, data: { status: ReviewStatus.APPROVED, reviewedById: staffId, reviewedAt: new Date(), reviewNote: note } });
      if (!await tx.wallet.findUnique({ where: { userId: customerId }, select: { id: true } })) await tx.wallet.create({ data: { userId: customerId } });
      const request = await tx.rechargeRequest.findUniqueOrThrow({ where: { id: created.id }, include: { customer: { include: { wallet: true } } } });
      const { creditAmount } = await this.creditApprovedRecharge(tx, request, staffId, note, businessKey);
      await tx.adminLog.create({ data: {
        actorId: staffId, targetUserId: customerId, action: "STAFF_RECORD_RECHARGE", entityType: "RECHARGE_REQUEST", entityId: created.id,
        detail: { amount: request.amount.toString(), totalCredit: creditAmount.toString(), method: methodLabel, requestId }
      } });
      return { replayed: false, recharge: await tx.rechargeRequest.findUniqueOrThrow({ where: { id: created.id } }) };
    });

    if (!result.replayed) await this.botNotifications.syncCustomerMembershipLevels(customerId).catch(() => undefined);
    return result;
  }

  // Caller owns the customer lock and commits the payment state and these ledger writes together.
  async settleProviderRechargeInTransaction(
    tx: Prisma.TransactionClient, rechargeRequestId: string, paymentOrderId: string,
    customerId: string, expectedAmount: string, walletBusinessKey: string
  ) {
    await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${customerId} FOR UPDATE`;
    const request = await tx.rechargeRequest.findUnique({ where: { id: rechargeRequestId }, include: { customer: { include: { wallet: true } } } });
    if (!request || request.customerId !== customerId || request.screenshotUrl !== `${PROVIDER_RECHARGE_EVIDENCE_PREFIX}${paymentOrderId}` ||
        !request.amount.eq(fixedDecimal(expectedAmount, "amount")) || request.status !== ReviewStatus.PENDING) {
      throw new BadRequestException("支付充值申请状态、归属或金额不匹配");
    }
    if (!/^provider-recharge:[a-f0-9]{64}$/.test(walletBusinessKey)) throw new BadRequestException("Invalid provider wallet business key");
    if (!request.customer.wallet) await tx.wallet.create({ data: { userId: customerId } });
    const changed = await tx.rechargeRequest.updateMany({ where: { id: rechargeRequestId, status: ReviewStatus.PENDING },
      data: { status: ReviewStatus.APPROVED, reviewedAt: new Date(), reviewNote: "支付渠道已确认" } });
    if (changed.count !== 1) throw new BadRequestException("充值申请状态已变化");
    await this.creditApprovedRecharge(tx, request, undefined, "支付渠道已确认", walletBusinessKey);
    return tx.rechargeRequest.findUniqueOrThrow({ where: { id: rechargeRequestId } });
  }

  async closeProviderRechargeInTransaction(tx: Prisma.TransactionClient, rechargeRequestId: string, paymentOrderId: string, customerId: string) {
    const request = await tx.rechargeRequest.findUnique({ where: { id: rechargeRequestId } });
    if (!request || request.customerId !== customerId || request.screenshotUrl !== `${PROVIDER_RECHARGE_EVIDENCE_PREFIX}${paymentOrderId}` || request.status !== ReviewStatus.PENDING) {
      throw new BadRequestException("支付充值申请状态或归属不匹配");
    }
    const changed = await tx.rechargeRequest.updateMany({ where: { id: rechargeRequestId, status: ReviewStatus.PENDING },
      data: { status: ReviewStatus.REJECTED, reviewedAt: new Date(), reviewNote: "支付渠道确认未付款并关闭" } });
    if (changed.count !== 1) throw new BadRequestException("充值申请状态已变化");
    // Same reservation release as a rejected manual application; this never refunds a paid order.
    if (request.promotionCodeId) await tx.promotionCode.updateMany({ where: { id: request.promotionCodeId, usedCount: { gt: 0 } }, data: { usedCount: { decrement: 1 } } });
  }

  private async creditApprovedRecharge(
    tx: Prisma.TransactionClient,
    request: Prisma.RechargeRequestGetPayload<{ include: { customer: { include: { wallet: true } } } }>,
    reviewerId?: string, note?: string, walletBusinessKey?: string
  ) {
    const rechargeRequestId = request.id;
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
    const rechargeBonus = request.promotionBonus ?? new Prisma.Decimal(0);
    const creditAmount = money(request.amount.add(firstRechargeBonus).add(rechargeBonus), true);

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
        businessKey: walletBusinessKey,
        direction: TransactionDirection.CREDIT,
        amount: request.amount,
        balanceAfter: wallet.availableBalance,
        referenceType: "RECHARGE_REQUEST",
        referenceId: rechargeRequestId,
        note
      }
    });

    if (firstRechargeBonus.gt(0)) {
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId: request.customerId,
          operatorId: reviewerId,
          type: WalletTransactionType.PROMOTION_BONUS,
          businessKey: `first-recharge:${request.customerId}`,
          direction: TransactionDirection.CREDIT,
          amount: firstRechargeBonus,
          balanceAfter: wallet.availableBalance,
          referenceType: "RECHARGE_REQUEST",
          referenceId: rechargeRequestId,
          note: "New customer first recharge bonus"
        }
      });
    }

    if (rechargeBonus.gt(0)) {
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId: request.customerId,
          operatorId: reviewerId,
          type: WalletTransactionType.PROMOTION_BONUS,
          direction: TransactionDirection.CREDIT,
          amount: rechargeBonus,
          balanceAfter: wallet.availableBalance,
          referenceType: request.promotionCodeId ? "RECHARGE_PROMOTION_CODE" : "RECHARGE_PREDEPOSIT_BONUS",
          referenceId: request.promotionCodeId ?? rechargeRequestId,
          note: request.promotionCodeId ? "Recharge promotion code / predeposit bonus" : "Predeposit recharge bonus"
        }
      });
    }

    return { firstRechargeBonus, rechargeBonus, creditAmount };
  }

  async createWithdrawalRequest(
    companionId: string,
    body: { amount: string; payoutAccount: string; note?: string; requestId?: unknown }
  ) {
    const amount = this.positiveDecimal(body.amount, "amount");
    const requestId = optionalRequestId(body.requestId);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${companionId} FOR UPDATE`;
      // Under the user lock, a retried submit finds the first request instead of freezing income a second time.
      if (requestId) {
        const prior = await tx.withdrawalRequest.findUnique({ where: { companionId_requestId: { companionId, requestId } } });
        if (prior) { assertSameAmount(prior.amount, amount); return prior; }
      }
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
      const disputeReserve = await this.disputedIncome(tx, companionId);

      const frozen = await tx.wallet.updateMany({
        where: {
          id: companion.wallet.id,
          availableIncome: { gte: amount.add(disputeReserve) }
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
          note: body.note,
          requestId
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
      const identity = await tx.withdrawalRequest.findUnique({ where: { id: withdrawalRequestId }, select: { companionId: true } });
      if (!identity) throw new NotFoundException("Withdrawal request not found");
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${identity.companionId} FOR UPDATE`;
      const request = await tx.withdrawalRequest.findUnique({
        where: { id: withdrawalRequestId },
        include: { companion: { include: { wallet: true } } }
      });

      if (!request) throw new NotFoundException("Withdrawal request not found");
      if (!request.companion.wallet) throw new BadRequestException("Companion wallet does not exist");
      if (body.status !== "REJECTED") {
        const reserve = await this.disputedIncome(tx, request.companionId);
        const liquid = request.companion.wallet.availableIncome.add(request.companion.wallet.frozenIncome);
        if (liquid.sub(request.amount).lt(reserve)) throw new BadRequestException("Unresolved order complaints reserve this income; manual finance review is required");
      }
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
    return fixedDecimal(value, fieldName);
  }

  private async disputedIncome(tx: Prisma.TransactionClient, companionId: string) {
    const result = await tx.order.aggregate({ where: { companionId, status: "COMPLETED", complaints: { some: { status: { in: ["OPEN", "IN_REVIEW"] } } } }, _sum: { companionIncome: true } });
    return result._sum.companionIncome ?? new Prisma.Decimal(0);
  }

  private async calculateFirstRechargeBonus(tx: Prisma.TransactionClient, rechargeAmount: Prisma.Decimal) {
    const [rateSetting, fixedSetting] = await Promise.all([
      tx.platformSetting.findUnique({ where: { key: "NEW_CUSTOMER_FIRST_RECHARGE_BONUS_RATE" } }),
      tx.platformSetting.findUnique({ where: { key: "NEW_CUSTOMER_FIRST_RECHARGE_BONUS_AMOUNT" } })
    ]);
    const rate = fixedDecimal(rateSetting?.value ?? "0", "NEW_CUSTOMER_FIRST_RECHARGE_BONUS_RATE", { scale: 4, zero: true, max: "1" });
    const fixed = this.nonNegativeDecimal(fixedSetting?.value ?? "0", "NEW_CUSTOMER_FIRST_RECHARGE_BONUS_AMOUNT");
    return money(rechargeAmount.mul(rate).add(fixed));
  }

  private async findApplicablePromotionCode(code: string, rechargeAmount: Prisma.Decimal, db: Prisma.TransactionClient = this.prisma) {
    const normalizedCode = normalizePromotionCode(code);
    if (!normalizedCode) return null;

    const promotion = await db.promotionCode.findUnique({ where: { code: normalizedCode } });
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
    return fixedDecimal(value, fieldName, { zero: true });
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

function calculatePredepositBonus(rechargeAmount: Prisma.Decimal) {
  if (rechargeAmount.gte(1000)) return new Prisma.Decimal(100);
  if (rechargeAmount.gte(500)) return new Prisma.Decimal(40);
  if (rechargeAmount.gte(300)) return new Prisma.Decimal(20);
  if (rechargeAmount.gte(100)) return new Prisma.Decimal(5);
  return new Prisma.Decimal(0);
}

function buildPayoutAccount(profile?: { payoutMethod: string | null; payoutAccountName: string | null; payoutAccountNo: string | null } | null) {
  if (!profile?.payoutAccountName || !profile.payoutAccountNo) return "";
  const method = profile.payoutMethod || "ALIPAY";
  return `${method}: ${profile.payoutAccountName} / ${profile.payoutAccountNo}`;
}

/** Optional client id for one submit intent; absent means the caller does not need replay. */
function optionalRequestId(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(value)) throw new BadRequestException("提交编号格式不正确，请刷新页面后重试");
  return value;
}

function assertSameAmount(prior: Prisma.Decimal, amount: Prisma.Decimal) {
  if (!prior.equals(amount)) throw new BadRequestException("这次提交和上一次的金额不一致，请刷新页面后重新填写");
}
