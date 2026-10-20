import { createHash } from "node:crypto";
import { fixedDecimal } from "../financial-values";

export type PaymentState = "CREATED" | "PENDING" | "UNKNOWN" | "PAID" | "CLOSED";

// Load this snapshot from the server. PAID means the wallet transaction already committed.
export type PaymentOrderSnapshot = Readonly<{
  id: string;
  entry: "PROVIDER_RECHARGE";
  providerId: string;
  merchantId: string;
  merchantOrderId: string;
  amountMinor: string;
  currency: "CNY";
  state: PaymentState;
  providerTransactionId?: string;
}>;

export type RawPaymentNotification = Readonly<{
  rawBody: Uint8Array;
  headers: Readonly<Record<string, string | string[] | undefined>>;
}>;

export type PaymentObservation =
  | { status: "PAID"; merchantId: string; merchantOrderId: string; amountMinor: string; currency: string; transactionId: string }
  | { status: "PENDING" | "CLOSED"; merchantId: string; merchantOrderId: string }
  | { status: "UNKNOWN" }
  | { status: "NOT_FOUND" };

// Implementations are server-selected adapters. verifyNotification must verify the original
// bytes/signature and merchant identity before returning; a body field named "verified" is not proof.
export interface PaymentProvider {
  readonly id: string;
  assertConfigured(): void;
  verifyNotification(input: RawPaymentNotification): Promise<PaymentObservation>;
  queryPayment(order: PaymentOrderSnapshot): Promise<PaymentObservation>;
}

export class PaymentProviderUnavailable extends Error {
  readonly code = "PAYMENT_PROVIDER_UNAVAILABLE";
  constructor() { super("支付渠道尚未接入，无法确认付款；请使用现有人工充值申请"); }
}
export class PaymentQueryUncertain extends Error {}
export class PaymentEvidenceRejected extends Error {}

export type PaymentDecision = Readonly<{
  orderId: string;
  action: "CREDIT_REQUIRED" | "DUPLICATE" | "PENDING" | "UNKNOWN" | "CLOSE_WITHOUT_CREDIT" | "NO_CHANGE" | "REVIEW_REQUIRED";
  allowNewPaymentAttempt: false;
  transactionId?: string;
  walletBusinessKey?: string;
  amountMinor?: string;
}>;

// Uses the existing wallet decimal rules. Never derive expected money from a callback or browser success page.
export function rechargeAmountMinor(serverAmount: string): string {
  return fixedDecimal(serverAmount, "amount").mul(100).toFixed(0);
}

function identity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && value.trim() === value && !/[\x00-\x20\x7f]/.test(value);
}
function minorAmount(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,11}$/.test(value) && BigInt(value) <= 999999999999n;
}

export class PaymentBoundary {
  constructor(private readonly provider: PaymentProvider) {}

  async fromNotification(order: PaymentOrderSnapshot, input: RawPaymentNotification): Promise<PaymentDecision> {
    this.assertServerOrder(order);
    return this.decide(order, await this.provider.verifyNotification(input));
  }

  async fromQuery(order: PaymentOrderSnapshot): Promise<PaymentDecision> {
    this.assertServerOrder(order);
    try { return this.decide(order, await this.provider.queryPayment(order)); }
    catch (error) {
      if (error instanceof PaymentQueryUncertain) return this.decide(order, { status: "UNKNOWN" });
      throw error;
    }
  }

  private assertServerOrder(order: PaymentOrderSnapshot) {
    if (order.entry !== "PROVIDER_RECHARGE" || !identity(order.id) || !identity(order.providerId) ||
        !identity(order.merchantId) || !identity(order.merchantOrderId) || order.providerId !== this.provider.id ||
        order.currency !== "CNY" || !minorAmount(order.amountMinor) ||
        !["CREATED", "PENDING", "UNKNOWN", "PAID", "CLOSED"].includes(order.state)) {
      throw new PaymentEvidenceRejected("支付订单上下文无效，不能确认付款");
    }
  }

  // Both callback and query reach this same decision. It performs no DB writes or provider requests.
  // PaymentOrdersService locks/re-reads and writes WalletTransaction.businessKey in the same
  // transaction as the credit/state change. CREDIT_REQUIRED alone is not a receipt of credit.
  private decide(order: PaymentOrderSnapshot, result: PaymentObservation): PaymentDecision {
    const decision = (action: PaymentDecision["action"]): PaymentDecision => ({ orderId: order.id, action, allowNewPaymentAttempt: false });
    if (!result || !["PAID", "PENDING", "CLOSED", "UNKNOWN", "NOT_FOUND"].includes(result.status)) {
      throw new PaymentEvidenceRejected("支付渠道返回了无法识别的状态");
    }
    if (result.status === "UNKNOWN" || result.status === "NOT_FOUND") {
      return decision(order.state === "PAID" || order.state === "CLOSED" ? "NO_CHANGE" : "UNKNOWN");
    }
    if (result.merchantId !== order.merchantId || result.merchantOrderId !== order.merchantOrderId) {
      throw new PaymentEvidenceRejected("支付商户或订单不匹配");
    }
    if (result.status === "PAID") {
      if (result.currency !== order.currency || !minorAmount(result.amountMinor) || result.amountMinor !== order.amountMinor || !identity(result.transactionId)) {
        throw new PaymentEvidenceRejected("支付金额、币种或流水号不匹配");
      }
      if (order.state === "CLOSED") return decision("REVIEW_REQUIRED");
      if (order.state === "PAID") return decision(order.providerTransactionId === result.transactionId ? "DUPLICATE" : "REVIEW_REQUIRED");
      // One provider transaction cannot credit two different local orders: the order ID is deliberately excluded.
      const digest = createHash("sha256").update(JSON.stringify([this.provider.id, order.merchantId, result.transactionId])).digest("hex");
      return { ...decision("CREDIT_REQUIRED"), transactionId: result.transactionId, walletBusinessKey: `provider-recharge:${digest}`, amountMinor: order.amountMinor };
    }
    if (order.state === "PAID" || order.state === "CLOSED") return decision("NO_CHANGE");
    return decision(result.status === "CLOSED" ? "CLOSE_WITHOUT_CREDIT" : "PENDING");
  }
}
