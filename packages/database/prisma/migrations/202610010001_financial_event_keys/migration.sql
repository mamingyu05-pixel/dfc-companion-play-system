-- New events have stable keys; historical entries remain untouched.
ALTER TABLE "wallet_transactions" ADD COLUMN "businessKey" TEXT;
CREATE UNIQUE INDEX "wallet_transactions_businessKey_key" ON "wallet_transactions"("businessKey");
