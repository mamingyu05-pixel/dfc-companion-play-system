-- Candidate only: follows the existing 202610040002 table migration.
-- No data rewrite. Existing inconsistent rows must fail validation, never be silently repaired.
-- One ALTER statement keeps replacement constraints atomic; no migration has been executed here.
ALTER TABLE "provider_payment_orders"
    DROP CONSTRAINT "provider_payment_orders_paid_receipt_check",
    ADD CONSTRAINT "provider_payment_orders_paid_receipt_check" CHECK (
        ("status" = 'PAID' AND "rechargeRequestId" IS NOT NULL
          AND "providerTransactionId" IS NOT NULL AND length("providerTransactionId") > 0
          AND "walletBusinessKey" IS NOT NULL AND "walletBusinessKey" ~ '^provider-recharge:[a-f0-9]{64}$')
        OR ("status" <> 'PAID' AND "providerTransactionId" IS NULL AND "walletBusinessKey" IS NULL)
    ),
    DROP CONSTRAINT "provider_payment_orders_rechargeRequestId_fkey",
    ADD CONSTRAINT "provider_payment_orders_rechargeRequestId_fkey" FOREIGN KEY ("rechargeRequestId")
        REFERENCES "recharge_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
