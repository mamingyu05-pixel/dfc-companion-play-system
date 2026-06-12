ALTER TABLE "ai_support_conversations"
  ADD COLUMN "platform" "BotPlatform",
  ADD COLUMN "platformUserId" TEXT,
  ADD COLUMN "platformGuildId" TEXT,
  ADD COLUMN "platformChannelId" TEXT,
  ADD COLUMN "platformMessageId" TEXT,
  ADD COLUMN "replyMessageId" TEXT;

CREATE INDEX "ai_support_conversations_platform_platformUserId_idx"
  ON "ai_support_conversations"("platform", "platformUserId");

CREATE INDEX "ai_support_conversations_platformChannelId_idx"
  ON "ai_support_conversations"("platformChannelId");
