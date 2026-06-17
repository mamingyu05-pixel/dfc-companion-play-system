ALTER TABLE "companion_profiles"
  ADD COLUMN IF NOT EXISTS "kookPricePerHour" DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS "discordPricePerHour" DECIMAL(12, 2);
