CREATE TABLE "auth_rate_limit_buckets" (
  "key" TEXT PRIMARY KEY,
  "attempts" INTEGER NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL
);
CREATE INDEX "auth_rate_limit_buckets_expiresAt_idx" ON "auth_rate_limit_buckets"("expiresAt");
