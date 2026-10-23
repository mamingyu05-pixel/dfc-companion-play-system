ALTER TYPE "OrderServiceKind" ADD VALUE 'PACKAGE';
ALTER TYPE "OrderEvidenceKind" ADD VALUE 'BLOWN_RUN';
ALTER TYPE "WalletTransactionType" ADD VALUE 'ORDER_TIP';
ALTER TYPE "WalletTransactionType" ADD VALUE 'TIP_INCOME';

CREATE TABLE "service_packages" (
  "id" TEXT NOT NULL,
  "game" "GameCode" NOT NULL DEFAULT 'DELTA_FORCE',
  "category" VARCHAR(32) NOT NULL,
  "name" VARCHAR(40) NOT NULL,
  "description" VARCHAR(200),
  "price" DECIMAL(12,2) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "service_packages_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "orders"
  ADD COLUMN "guaranteeBlownBonusWan" INTEGER,
  ADD COLUMN "memberDiscountRate" DECIMAL(5,4),
  ADD COLUMN "tipAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "servicePackageId" TEXT,
  ADD CONSTRAINT "orders_servicePackageId_fkey" FOREIGN KEY ("servicePackageId") REFERENCES "service_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "companion_profiles"
  ADD COLUMN "verified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "badges" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Examples drawn from public Delta Force escort price lists seen 2026-10-23. They start unlisted:
-- operators review the names and prices in admin and list the ones they sell.
INSERT INTO "service_packages" ("id", "category", "name", "description", "price", "sortOrder", "isActive", "updatedAt") VALUES
  ('pkg-red-one', '大红任务', '指定大红 1 件', '指定一件大红物资，带出撤离即完成。', 49.00, 10, false, CURRENT_TIMESTAMP),
  ('pkg-red-three', '大红任务', '任意大红 3 件', '任意三件大红物资，带出撤离即完成。', 59.00, 20, false, CURRENT_TIMESTAMP),
  ('pkg-run-100', '跑刀', '跑刀 100 万', '纯手动跑刀，仓库净增 100 万哈夫币。', 10.00, 30, false, CURRENT_TIMESTAMP),
  ('pkg-run-600', '跑刀', '跑刀 600 万', '纯手动跑刀，仓库净增 600 万哈夫币。', 50.00, 40, false, CURRENT_TIMESTAMP),
  ('pkg-safe-15d', '3×3 保险箱', '3×3 保险箱（15 天）', '代做 3×3 保险箱任务，约 15 天完成。', 900.00, 50, false, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
