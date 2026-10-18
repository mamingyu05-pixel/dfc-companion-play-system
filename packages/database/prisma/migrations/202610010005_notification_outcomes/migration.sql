ALTER TYPE "BotEventStatus" ADD VALUE 'UNKNOWN';
CREATE TABLE "notification_deliveries" (
  "id" TEXT PRIMARY KEY, "key" TEXT NOT NULL UNIQUE, "businessKey" TEXT NOT NULL,
  "platform" "BotPlatform" NOT NULL, "target" TEXT NOT NULL, "path" TEXT NOT NULL,
  "requestBody" JSONB NOT NULL, "response" JSONB, "messageId" TEXT, "jobKey" TEXT,
  "status" TEXT NOT NULL DEFAULT 'READY', "attempts" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3), "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "notification_deliveries_status_startedAt_idx" ON "notification_deliveries"("status", "startedAt");
