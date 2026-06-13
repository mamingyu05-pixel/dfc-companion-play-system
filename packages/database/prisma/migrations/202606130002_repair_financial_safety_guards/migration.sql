-- Repair guard for production databases where 202606130001 was manually marked
-- as applied after failing midway. These statements are intentionally idempotent.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "commissionRateSnapshot" DECIMAL(5,4) NOT NULL DEFAULT 0.2;

CREATE UNIQUE INDEX IF NOT EXISTS "ai_support_conversations_platform_message_unique"
  ON "ai_support_conversations"("platform", "platformMessageId")
  WHERE "platformMessageId" IS NOT NULL;
