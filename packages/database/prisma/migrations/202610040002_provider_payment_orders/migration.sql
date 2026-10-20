-- Candidate only. Apply with the normal migration process after isolated validation.
-- No existing balance/recharge data is altered. WalletTransaction.businessKey remains the credit guard.
CREATE TABLE "provider_payment_orders" (
  "id" TEXT NOT NULL,
  "requestKey" VARCHAR(64) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "customerId" TEXT NOT NULL,
  "providerId" VARCHAR(64) NOT NULL,
  "merchantId" VARCHAR(128) NOT NULL,
  "merchantOrderId" VARCHAR(128) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'CNY',
  "status" VARCHAR(16) NOT NULL DEFAULT 'CREATED',
  "rechargeRequestId" TEXT,
  "providerTransactionId" VARCHAR(128),
  "walletBusinessKey" VARCHAR(96),
  "reviewRequired" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_payment_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_payment_orders_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "provider_payment_orders_currency_check" CHECK ("currency" = 'CNY'),
  CONSTRAINT "provider_payment_orders_status_check" CHECK ("status" IN ('CREATED', 'PENDING', 'UNKNOWN', 'PAID', 'CLOSED')),
  CONSTRAINT "provider_payment_orders_paid_receipt_check" CHECK ("status" <> 'PAID' OR
    ("rechargeRequestId" IS NOT NULL AND "providerTransactionId" IS NOT NULL AND "walletBusinessKey" IS NOT NULL)),
  CONSTRAINT "provider_payment_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "provider_payment_orders_rechargeRequestId_fkey" FOREIGN KEY ("rechargeRequestId") REFERENCES "recharge_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "provider_payment_orders_requestKey_key" ON "provider_payment_orders"("requestKey");
CREATE UNIQUE INDEX "provider_payment_orders_rechargeRequestId_key" ON "provider_payment_orders"("rechargeRequestId");
CREATE UNIQUE INDEX "provider_payment_orders_walletBusinessKey_key" ON "provider_payment_orders"("walletBusinessKey");
CREATE UNIQUE INDEX "provider_payment_orders_merchant_order_key" ON "provider_payment_orders"("providerId", "merchantId", "merchantOrderId");
CREATE UNIQUE INDEX "provider_payment_orders_provider_transaction_key" ON "provider_payment_orders"("providerId", "merchantId", "providerTransactionId");
CREATE INDEX "provider_payment_orders_customerId_createdAt_idx" ON "provider_payment_orders"("customerId", "createdAt");
CREATE INDEX "provider_payment_orders_status_updatedAt_idx" ON "provider_payment_orders"("status", "updatedAt");
