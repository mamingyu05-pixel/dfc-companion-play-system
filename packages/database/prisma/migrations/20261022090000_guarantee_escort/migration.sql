CREATE TYPE "OrderServiceKind" AS ENUM ('HOURLY', 'GUARANTEE');
CREATE TYPE "GamePlatform" AS ENUM ('PC', 'MOBILE');
CREATE TYPE "OrderEvidenceKind" AS ENUM ('VAULT_START', 'VAULT_END', 'RECORDING', 'OTHER');

ALTER TABLE "orders"
  ADD COLUMN "serviceKind" "OrderServiceKind" NOT NULL DEFAULT 'HOURLY',
  ADD COLUMN "guaranteePlatform" "GamePlatform",
  ADD COLUMN "guaranteeTargetWan" INTEGER;

CREATE TABLE "guarantee_packages" (
  "id" TEXT NOT NULL,
  "game" "GameCode" NOT NULL DEFAULT 'DELTA_FORCE',
  "platform" "GamePlatform" NOT NULL,
  "targetWan" INTEGER NOT NULL,
  "price" DECIMAL(12,2) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "guarantee_packages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "guarantee_packages_game_platform_targetWan_key" ON "guarantee_packages"("game", "platform", "targetWan");

CREATE TABLE "order_evidence" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "uploaderId" TEXT NOT NULL,
  "kind" "OrderEvidenceKind" NOT NULL,
  "imageUrl" TEXT,
  "linkUrl" TEXT,
  "vaultValueWan" INTEGER,
  "note" VARCHAR(200),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_evidence_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "order_evidence_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "order_evidence_orderId_createdAt_idx" ON "order_evidence"("orderId", "createdAt");

-- Opening prices follow public Delta Force escort listings seen 2026-10-22; operators adjust them in admin.
INSERT INTO "guarantee_packages" ("id", "platform", "targetWan", "price", "sortOrder", "updatedAt") VALUES
  ('guarantee-pc-400', 'PC', 400, 79.00, 10, CURRENT_TIMESTAMP),
  ('guarantee-pc-688', 'PC', 688, 128.00, 20, CURRENT_TIMESTAMP),
  ('guarantee-pc-1288', 'PC', 1288, 198.00, 30, CURRENT_TIMESTAMP),
  ('guarantee-mobile-400', 'MOBILE', 400, 49.00, 40, CURRENT_TIMESTAMP),
  ('guarantee-mobile-688', 'MOBILE', 688, 88.00, 50, CURRENT_TIMESTAMP),
  ('guarantee-mobile-1288', 'MOBILE', 1288, 148.00, 60, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
