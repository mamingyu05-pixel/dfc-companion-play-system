-- Additive only. Existing payment migrations and order ledgers are unchanged.
CREATE TABLE "kook_order_flows" (
  "id" TEXT PRIMARY KEY,
  "eventKey" VARCHAR(64) NOT NULL UNIQUE,
  "draftId" TEXT UNIQUE REFERENCES "order_drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId" TEXT NOT NULL,
  "platformUserId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0 CHECK ("version" >= 0),
  "state" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kook_order_flows_state_check" CHECK (jsonb_typeof("state") = 'object' AND "state" ? 'step' AND jsonb_typeof("state"->'step') = 'string' AND "state"->>'step' IN ('MODE', 'HOURS', 'ROUTE', 'COMPANION', 'QUOTE', 'DEMAND', 'DRAFT_QUOTE', 'DONE', 'CANCELLED'))
);
CREATE INDEX "kook_order_flows_userId_platformUserId_createdAt_idx" ON "kook_order_flows" ("userId", "platformUserId", "createdAt");
