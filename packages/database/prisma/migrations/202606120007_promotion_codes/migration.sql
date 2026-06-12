CREATE TABLE "promotion_codes" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "minRecharge" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "bonusAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "bonusRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
  "maxBonusAmount" DECIMAL(12,2),
  "usageLimit" INTEGER,
  "usedCount" INTEGER NOT NULL DEFAULT 0,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "promotion_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "promotion_codes_code_key" ON "promotion_codes"("code");
CREATE INDEX "promotion_codes_isActive_idx" ON "promotion_codes"("isActive");
CREATE INDEX "promotion_codes_startsAt_endsAt_idx" ON "promotion_codes"("startsAt", "endsAt");

ALTER TABLE "promotion_codes"
  ADD CONSTRAINT "promotion_codes_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recharge_requests" ADD COLUMN "promotionCodeId" TEXT;
ALTER TABLE "recharge_requests" ADD COLUMN "promotionBonus" DECIMAL(12,2) NOT NULL DEFAULT 0;
CREATE INDEX "recharge_requests_promotionCodeId_idx" ON "recharge_requests"("promotionCodeId");

ALTER TABLE "recharge_requests"
  ADD CONSTRAINT "recharge_requests_promotionCodeId_fkey"
  FOREIGN KEY ("promotionCodeId") REFERENCES "promotion_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
