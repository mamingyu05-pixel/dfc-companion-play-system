CREATE TYPE "OrderSourcePlatform" AS ENUM ('WEB', 'DISCORD', 'KOOK');
CREATE TYPE "OrderDraftStatus" AS ENUM ('OPEN', 'TRIALING', 'SELECTED', 'CUSTOMER_CONFIRMED', 'CONVERTED', 'CANCELLED');
CREATE TYPE "OrderDraftCandidateStatus" AS ENUM ('RECOMMENDED', 'TRIALING', 'LIKED', 'REJECTED', 'SELECTED');
CREATE TYPE "OrderDraftActorType" AS ENUM ('CUSTOMER', 'ADMIN', 'COMPANION', 'BOT');
CREATE TYPE "OrderDraftEventType" AS ENUM (
  'DRAFT_CREATED',
  'CUSTOMER_REQUESTED_ORDER',
  'COMPANION_RECOMMENDED',
  'COMPANION_TRIAL_STARTED',
  'CUSTOMER_SELECTED_COMPANION',
  'CUSTOMER_CHANGED_COMPANION',
  'CUSTOMER_CONFIRMED',
  'DRAFT_CONVERTED_TO_ORDER',
  'DRAFT_CANCELLED',
  'NOTE_ADDED'
);

ALTER TABLE "orders"
  ADD COLUMN "sourcePlatform" "OrderSourcePlatform" NOT NULL DEFAULT 'WEB',
  ADD COLUMN "sourceDraftId" TEXT,
  ADD COLUMN "sourceChannelId" TEXT,
  ADD COLUMN "sourceMessageId" TEXT;

CREATE TABLE "order_drafts" (
  "id" TEXT NOT NULL,
  "draftNo" TEXT NOT NULL,
  "customerId" TEXT,
  "serviceAdminId" TEXT NOT NULL,
  "selectedCompanionId" TEXT,
  "convertedById" TEXT,
  "sourcePlatform" "OrderSourcePlatform" NOT NULL,
  "customerPlatformUserId" TEXT,
  "customerDisplayName" TEXT,
  "sourceGuildId" TEXT,
  "sourceChannelId" TEXT,
  "sourceMessageId" TEXT,
  "voiceRoomId" TEXT,
  "game" "GameCode" NOT NULL DEFAULT 'DELTA_FORCE',
  "mode" TEXT NOT NULL,
  "hours" DECIMAL(6,2),
  "budgetAmount" DECIMAL(12,2),
  "status" "OrderDraftStatus" NOT NULL DEFAULT 'OPEN',
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_drafts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_draft_candidates" (
  "id" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "recommendedById" TEXT,
  "status" "OrderDraftCandidateStatus" NOT NULL DEFAULT 'RECOMMENDED',
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_draft_candidates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_draft_events" (
  "id" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "actorType" "OrderDraftActorType" NOT NULL,
  "actorUserId" TEXT,
  "platform" "OrderSourcePlatform" NOT NULL,
  "platformUserId" TEXT,
  "eventType" "OrderDraftEventType" NOT NULL,
  "content" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_draft_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_drafts_draftNo_key" ON "order_drafts"("draftNo");
CREATE INDEX "order_drafts_status_idx" ON "order_drafts"("status");
CREATE INDEX "order_drafts_customerId_idx" ON "order_drafts"("customerId");
CREATE INDEX "order_drafts_serviceAdminId_idx" ON "order_drafts"("serviceAdminId");
CREATE INDEX "order_drafts_selectedCompanionId_idx" ON "order_drafts"("selectedCompanionId");
CREATE UNIQUE INDEX "order_draft_candidates_draftId_companionId_key" ON "order_draft_candidates"("draftId", "companionId");
CREATE INDEX "order_draft_candidates_companionId_idx" ON "order_draft_candidates"("companionId");
CREATE INDEX "order_draft_events_draftId_idx" ON "order_draft_events"("draftId");
CREATE INDEX "order_draft_events_eventType_idx" ON "order_draft_events"("eventType");
CREATE UNIQUE INDEX "orders_sourceDraftId_key" ON "orders"("sourceDraftId");

ALTER TABLE "order_drafts" ADD CONSTRAINT "order_drafts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_drafts" ADD CONSTRAINT "order_drafts_serviceAdminId_fkey" FOREIGN KEY ("serviceAdminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_drafts" ADD CONSTRAINT "order_drafts_selectedCompanionId_fkey" FOREIGN KEY ("selectedCompanionId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_drafts" ADD CONSTRAINT "order_drafts_convertedById_fkey" FOREIGN KEY ("convertedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_draft_candidates" ADD CONSTRAINT "order_draft_candidates_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "order_drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_draft_candidates" ADD CONSTRAINT "order_draft_candidates_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_draft_candidates" ADD CONSTRAINT "order_draft_candidates_recommendedById_fkey" FOREIGN KEY ("recommendedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_draft_events" ADD CONSTRAINT "order_draft_events_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "order_drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_draft_events" ADD CONSTRAINT "order_draft_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_sourceDraftId_fkey" FOREIGN KEY ("sourceDraftId") REFERENCES "order_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
