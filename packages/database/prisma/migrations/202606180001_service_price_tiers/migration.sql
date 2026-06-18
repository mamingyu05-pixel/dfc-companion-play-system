CREATE TYPE "ServicePriceTier" AS ENUM ('ENTERTAINMENT', 'RANKED', 'HIGH_RANKED', 'CUSTOM');

ALTER TABLE "companion_profiles"
  ADD COLUMN "entertainmentPricePerHour" DECIMAL(12,2),
  ADD COLUMN "rankedPricePerHour" DECIMAL(12,2),
  ADD COLUMN "highRankedPricePerHour" DECIMAL(12,2);

ALTER TABLE "orders"
  ADD COLUMN "priceTier" "ServicePriceTier" NOT NULL DEFAULT 'CUSTOM';

ALTER TABLE "order_drafts"
  ADD COLUMN "priceTier" "ServicePriceTier" NOT NULL DEFAULT 'CUSTOM';
