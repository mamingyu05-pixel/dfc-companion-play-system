ALTER TABLE "orders"
  ADD COLUMN "commissionRateSnapshot" DECIMAL(5,4) NOT NULL DEFAULT 0.2;

CREATE UNIQUE INDEX "ai_support_conversations_platform_message_unique"
  ON "ai_support_conversations"("platform", "platformMessageId");
