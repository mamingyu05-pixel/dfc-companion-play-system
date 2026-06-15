ALTER TABLE "companion_profiles"
  ADD COLUMN "photoUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "voiceIntroUrl" TEXT;
