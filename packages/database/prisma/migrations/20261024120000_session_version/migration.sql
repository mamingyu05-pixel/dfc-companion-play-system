-- Lets a password change or ban revoke every token issued before it.
ALTER TABLE "users" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- One-time login hand-off bound to the browser that will receive the session.
CREATE TABLE "login_receipts" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "browserHash" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "confirm" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "login_receipts_codeHash_key" ON "login_receipts"("codeHash");
CREATE INDEX "login_receipts_userId_idx" ON "login_receipts"("userId");

ALTER TABLE "login_receipts" ADD CONSTRAINT "login_receipts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Retried recharge/withdrawal submissions replay the original request.
ALTER TABLE "recharge_requests" ADD COLUMN "requestId" TEXT;
CREATE UNIQUE INDEX "recharge_requests_customerId_requestId_key" ON "recharge_requests"("customerId", "requestId");
ALTER TABLE "withdrawal_requests" ADD COLUMN "requestId" TEXT;
CREATE UNIQUE INDEX "withdrawal_requests_companionId_requestId_key" ON "withdrawal_requests"("companionId", "requestId");
