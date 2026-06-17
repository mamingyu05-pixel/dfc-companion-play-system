ALTER TYPE "GameCode" ADD VALUE IF NOT EXISTS 'STEAM';

ALTER TABLE "companion_profiles"
  ADD COLUMN IF NOT EXISTS "games" "GameCode"[] NOT NULL DEFAULT ARRAY[]::"GameCode"[];

UPDATE "companion_profiles"
SET "games" = ARRAY["game"]::"GameCode"[]
WHERE cardinality("games") = 0;
