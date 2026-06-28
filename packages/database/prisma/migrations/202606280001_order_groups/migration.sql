CREATE TABLE "order_groups" (
  "id" TEXT NOT NULL,
  "groupNo" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "sourceDraftId" TEXT,
  "sourcePlatform" "OrderSourcePlatform" NOT NULL DEFAULT 'WEB',
  "sourceChannelId" TEXT,
  "sourceMessageId" TEXT,
  "companionCount" INTEGER NOT NULL DEFAULT 1,
  "originalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "order_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_groups_groupNo_key" ON "order_groups"("groupNo");
CREATE UNIQUE INDEX "order_groups_sourceDraftId_key" ON "order_groups"("sourceDraftId");
CREATE INDEX "order_groups_customerId_idx" ON "order_groups"("customerId");
CREATE INDEX "order_groups_sourceDraftId_idx" ON "order_groups"("sourceDraftId");

ALTER TABLE "orders"
  ADD COLUMN "orderGroupId" TEXT,
  ADD COLUMN "groupItemIndex" INTEGER,
  ADD COLUMN "originalUnitPrice" DECIMAL(12,2),
  ADD COLUMN "discountPerHour" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "originalAmount" DECIMAL(12,2);

CREATE INDEX "orders_orderGroupId_idx" ON "orders"("orderGroupId");

ALTER TABLE "order_groups"
  ADD CONSTRAINT "order_groups_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_groups"
  ADD CONSTRAINT "order_groups_sourceDraftId_fkey" FOREIGN KEY ("sourceDraftId") REFERENCES "order_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_orderGroupId_fkey" FOREIGN KEY ("orderGroupId") REFERENCES "order_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
