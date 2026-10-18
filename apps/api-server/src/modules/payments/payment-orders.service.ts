import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";
import type { WalletService } from "../wallet/wallet.service";
import { requireOrderRequestId } from "../orders/order-request";
import { PaymentBoundary, PaymentEvidenceRejected, rechargeAmountMinor } from "./payment-boundary";
import type { PaymentDecision, PaymentOrderSnapshot, PaymentProvider, PaymentState, RawPaymentNotification } from "./payment-boundary";
import { UnconfiguredPaymentProvider } from "./unconfigured-payment-provider";

type PaymentRecord = {
  id: string; requestKey: string; payloadHash: string; customerId: string;
  providerId: string; merchantId: string; merchantOrderId: string;
  amount: Prisma.Decimal; currency: "CNY"; status: PaymentState;
  rechargeRequestId: string | null; providerTransactionId: string | null;
  walletBusinessKey: string | null; reviewRequired: boolean;
};

export type PaymentReceipt = Readonly<{
  id: string; merchantOrderId: string; rechargeRequestId: string;
  amount: string; currency: "CNY"; status: PaymentState; reviewRequired: boolean;
  creditApplied: boolean; allowNewPaymentAttempt: false;
}>;

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Internal only: no controller/module registration until real merchant verification is reviewed.
// The config and adapter are server-owned, never constructed from a request body or AppID.
export class PaymentOrdersService {
  private readonly boundary: PaymentBoundary;
  private readonly config: Readonly<{ providerId: string; merchantId: string }>;
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletService,
    config: Readonly<{ providerId: string; merchantId: string }>,
    private readonly provider: PaymentProvider = new UnconfiguredPaymentProvider(config.providerId)
  ) {
    this.config = Object.freeze({ ...config });
    this.boundary = new PaymentBoundary(provider);
  }

  async createIntent(customerId: string, body: { requestId: string; amount: string; note?: string; promotionCode?: string }): Promise<PaymentReceipt> {
    this.assertConfigured();
    const requestId = requireOrderRequestId(body.requestId);
    const amountMinor = rechargeAmountMinor(body.amount);
    // Keep the exact existing wallet normalization/bonus rules; only amount representation is canonicalized.
    const amount = `${BigInt(amountMinor) / 100n}.${(BigInt(amountMinor) % 100n).toString().padStart(2, "0")}`;
    const requestKey = digest(["PROVIDER_RECHARGE", customerId, requestId]);
    const payloadHash = digest([amountMinor, body.note ?? null, body.promotionCode ?? null, this.config.providerId, this.config.merchantId]);
    const id = randomUUID(), merchantOrderId = randomUUID().replace(/-/g, "");
    return this.prisma.$transaction(async tx => {
      // This lock order matches manual review and the settlement path, including first-recharge bonuses.
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${customerId} FOR UPDATE`;
      const [order] = await tx.$queryRaw<PaymentRecord[]>`
        INSERT INTO "provider_payment_orders" ("id", "requestKey", "payloadHash", "customerId", "providerId", "merchantId", "merchantOrderId", "amount", "currency", "status")
        VALUES (${id}, ${requestKey}, ${payloadHash}, ${customerId}, ${this.config.providerId}, ${this.config.merchantId}, ${merchantOrderId}, ${amount}::decimal, 'CNY', 'CREATED')
        ON CONFLICT ("requestKey") DO UPDATE SET "requestKey" = EXCLUDED."requestKey" RETURNING *`;
      if (!order || order.payloadHash !== payloadHash) throw new ConflictException("充值请求编号已用于其他内容，请核对原申请");
      if (order.rechargeRequestId) return this.receipt(order);
      if (order.id !== id) throw new ConflictException("充值申请关联不完整，需要人工核对");
      const recharge = await this.wallets.createProviderRechargeInTransaction(tx, customerId, id, { ...body, amount });
      const changed = await tx.$executeRaw`UPDATE "provider_payment_orders" SET "rechargeRequestId" = ${recharge.id}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${id} AND "rechargeRequestId" IS NULL`;
      if (changed !== 1) throw new ConflictException("充值申请未能关联，事务已回滚");
      return this.receipt({ ...order, rechargeRequestId: recharge.id });
    });
  }

  async fromNotification(paymentOrderId: string, input: RawPaymentNotification): Promise<PaymentReceipt> {
    this.assertConfigured();
    const order = await this.load(paymentOrderId);
    const decision = await this.boundary.fromNotification(this.snapshot(order), input);
    return this.applyDecision(order, decision);
  }

  async fromQuery(paymentOrderId: string): Promise<PaymentReceipt> {
    this.assertConfigured();
    const order = await this.load(paymentOrderId);
    const decision = await this.boundary.fromQuery(this.snapshot(order));
    return this.applyDecision(order, decision);
  }

  private assertConfigured() {
    this.provider.assertConfigured();
    if (this.config.providerId !== this.provider.id || !/^[^\s\x00-\x1f\x7f]{1,64}$/.test(this.config.providerId) ||
        !/^[^\s\x00-\x1f\x7f]{1,128}$/.test(this.config.merchantId)) {
      throw new BadRequestException("支付渠道商户配置无效");
    }
  }

  private async load(id: string) {
    const [order] = await this.prisma.$queryRaw<PaymentRecord[]>`SELECT * FROM "provider_payment_orders" WHERE "id" = ${id}`;
    if (!order) throw new NotFoundException("支付订单不存在，请核对原申请");
    this.snapshot(order);
    return order;
  }

  private snapshot(order: PaymentRecord): PaymentOrderSnapshot {
    if (order.providerId !== this.config.providerId || order.merchantId !== this.config.merchantId || !order.rechargeRequestId ||
        (order.status === "PAID" && (!order.providerTransactionId || !order.walletBusinessKey))) {
      throw new PaymentEvidenceRejected("支付订单与服务器配置或入账记录不一致");
    }
    return { id: order.id, entry: "PROVIDER_RECHARGE", providerId: order.providerId, merchantId: order.merchantId,
      merchantOrderId: order.merchantOrderId, amountMinor: rechargeAmountMinor(order.amount.toString()), currency: order.currency,
      state: order.status, providerTransactionId: order.providerTransactionId ?? undefined };
  }

  private receipt(order: PaymentRecord): PaymentReceipt {
    this.snapshot(order);
    return { id: order.id, merchantOrderId: order.merchantOrderId, rechargeRequestId: order.rechargeRequestId!, amount: order.amount.toString(),
      currency: order.currency, status: order.status, reviewRequired: order.reviewRequired, creditApplied: order.status === "PAID", allowNewPaymentAttempt: false };
  }

  private async applyDecision(observed: PaymentRecord, decision: PaymentDecision): Promise<PaymentReceipt> {
    try {
      return await this.prisma.$transaction(async tx => {
      // Provider I/O already finished. Lock/re-read after verification, then commit all financial changes together.
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${observed.customerId} FOR UPDATE`;
      const [order] = await tx.$queryRaw<PaymentRecord[]>`SELECT * FROM "provider_payment_orders" WHERE "id" = ${observed.id} FOR UPDATE`;
      if (!order || decision.orderId !== order.id || order.customerId !== observed.customerId ||
          order.payloadHash !== observed.payloadHash || order.rechargeRequestId !== observed.rechargeRequestId ||
          order.providerId !== observed.providerId || order.merchantId !== observed.merchantId || order.merchantOrderId !== observed.merchantOrderId ||
          order.currency !== observed.currency || rechargeAmountMinor(order.amount.toString()) !== rechargeAmountMinor(observed.amount.toString())) {
        throw new PaymentEvidenceRejected("支付订单在核验期间发生变化，不能入账");
      }
      this.snapshot(order);
      // A recorded financial anomaly stays on hold until a separate reviewed reconciliation.
      if (order.reviewRequired) return this.receipt(order);
      if (decision.action === "REVIEW_REQUIRED" || (decision.action === "CREDIT_REQUIRED" &&
          (order.status === "CLOSED" || (order.status === "PAID" && order.providerTransactionId !== decision.transactionId)))) {
        await tx.$executeRaw`UPDATE "provider_payment_orders" SET "reviewRequired" = TRUE, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${order.id}`;
        return this.receipt({ ...order, reviewRequired: true });
      }
      if (order.status === "PAID" || order.status === "CLOSED") return this.receipt(order);
      if (decision.action === "CREDIT_REQUIRED") {
        if (!decision.transactionId || !decision.walletBusinessKey || decision.amountMinor !== rechargeAmountMinor(order.amount.toString())) {
          throw new PaymentEvidenceRejected("支付入账指令不完整");
        }
        // The unique ledger key is also enforced by PostgreSQL for different customers racing on one provider transaction.
        const existing = await tx.walletTransaction.findUnique({ where: { businessKey: decision.walletBusinessKey }, select: { id: true } });
        if (existing) {
          await tx.$executeRaw`UPDATE "provider_payment_orders" SET "reviewRequired" = TRUE, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${order.id}`;
          return this.receipt({ ...order, reviewRequired: true });
        }
        await this.wallets.settleProviderRechargeInTransaction(tx, order.rechargeRequestId!, order.id, order.customerId, order.amount.toString(), decision.walletBusinessKey);
        const changed = await tx.$executeRaw`UPDATE "provider_payment_orders" SET "status" = 'PAID', "providerTransactionId" = ${decision.transactionId},
          "walletBusinessKey" = ${decision.walletBusinessKey}, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${order.id} AND "status" IN ('CREATED', 'PENDING', 'UNKNOWN')`;
        if (changed !== 1) throw new ConflictException("支付状态已变化，入账事务已回滚");
        return this.receipt({ ...order, status: "PAID", providerTransactionId: decision.transactionId, walletBusinessKey: decision.walletBusinessKey });
      }
      let status: PaymentState = order.status;
      if (decision.action === "CLOSE_WITHOUT_CREDIT") {
        await this.wallets.closeProviderRechargeInTransaction(tx, order.rechargeRequestId!, order.id, order.customerId);
        status = "CLOSED";
      } else if (decision.action === "UNKNOWN" || decision.action === "PENDING") {
        status = decision.action;
      } else if (decision.action !== "NO_CHANGE") {
        throw new PaymentEvidenceRejected("支付状态与核验结果不一致");
      }
      if (status !== order.status) await tx.$executeRaw`UPDATE "provider_payment_orders" SET "status" = ${status}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${order.id}`;
      return this.receipt({ ...order, status });
      });
    } catch (error) {
      // Separate customers can both observe an unused provider key. PostgreSQL's
      // unique constraint rolls the losing financial transaction back completely.
      // Return the persisted review receipt after that rollback, rather than a raw
      // unique-key error that could invite the caller to submit another payment.
      const failure = error as { code?: string; meta?: { modelName?: string; target?: unknown } };
      if (decision.action === "CREDIT_REQUIRED" && decision.walletBusinessKey && failure?.code === "P2002" &&
          failure.meta?.modelName === "WalletTransaction" && Array.isArray(failure.meta.target) &&
          failure.meta.target.includes("businessKey")) {
        const credited = await this.prisma.walletTransaction.findUnique({ where: { businessKey: decision.walletBusinessKey }, select: { id: true } });
        if (credited) return this.applyDecision(observed, { orderId: decision.orderId, action: "REVIEW_REQUIRED", allowNewPaymentAttempt: false });
      }
      throw error;
    }
  }
}
