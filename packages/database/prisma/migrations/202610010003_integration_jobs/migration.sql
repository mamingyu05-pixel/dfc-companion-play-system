CREATE TABLE "integration_jobs" (
  "id" TEXT PRIMARY KEY, "key" TEXT NOT NULL, "kind" TEXT NOT NULL, "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "leaseUntil" TIMESTAMP(3), "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "integration_jobs_key_key" ON "integration_jobs"("key");
CREATE INDEX "integration_jobs_status_nextAttemptAt_idx" ON "integration_jobs"("status", "nextAttemptAt");
ALTER TABLE "order_drafts" ADD COLUMN "sourceBusinessKey" TEXT;
CREATE UNIQUE INDEX "order_drafts_sourceBusinessKey_key" ON "order_drafts"("sourceBusinessKey");
