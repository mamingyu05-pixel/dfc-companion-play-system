-- Referral rewards, companion payout profile, and AI support records.
CREATE TYPE "ReferralRewardStatus" AS ENUM ('PENDING', 'REWARDED', 'CANCELLED');
CREATE TYPE "ReferralSourceType" AS ENUM ('CUSTOMER', 'COMPANION', 'ADMIN');

ALTER TABLE "users" ADD COLUMN "referralCode" TEXT;

ALTER TABLE "companion_profiles"
  ADD COLUMN "payoutMethod" TEXT,
  ADD COLUMN "payoutAccountName" TEXT,
  ADD COLUMN "payoutAccountNo" TEXT,
  ADD COLUMN "payoutQrCodeUrl" TEXT;

UPDATE "users"
SET "referralCode" = (
  CASE
    WHEN "role" = 'COMPANION' THEN 'P'
    WHEN "role" = 'SUPER_ADMIN' THEN 'S'
    WHEN "role" = 'ADMIN' THEN 'A'
    ELSE 'C'
  END
) || UPPER(SUBSTRING(MD5("id") FROM 1 FOR 8))
WHERE "referralCode" IS NULL;

CREATE UNIQUE INDEX "users_referralCode_key" ON "users"("referralCode");

CREATE TABLE "user_referrals" (
  "id" TEXT NOT NULL,
  "referrerId" TEXT NOT NULL,
  "referredUserId" TEXT NOT NULL,
  "sourceType" "ReferralSourceType" NOT NULL,
  "rewardStatus" "ReferralRewardStatus" NOT NULL DEFAULT 'PENDING',
  "firstOrderId" TEXT,
  "rewardedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_referrals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_referrals_referredUserId_key" ON "user_referrals"("referredUserId");
CREATE INDEX "user_referrals_referrerId_idx" ON "user_referrals"("referrerId");
CREATE INDEX "user_referrals_rewardStatus_idx" ON "user_referrals"("rewardStatus");

CREATE TABLE "ai_support_conversations" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "message" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "matchedTopic" TEXT,
  "handoffRequired" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_support_conversations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_support_conversations_userId_idx" ON "ai_support_conversations"("userId");
CREATE INDEX "ai_support_conversations_createdAt_idx" ON "ai_support_conversations"("createdAt");

ALTER TABLE "user_referrals" ADD CONSTRAINT "user_referrals_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_referrals" ADD CONSTRAINT "user_referrals_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_referrals" ADD CONSTRAINT "user_referrals_firstOrderId_fkey" FOREIGN KEY ("firstOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_support_conversations" ADD CONSTRAINT "ai_support_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
