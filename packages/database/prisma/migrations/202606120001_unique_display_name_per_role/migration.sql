ALTER TABLE "users" ADD COLUMN "displayNameKey" TEXT;

UPDATE "users"
SET "displayNameKey" = lower(regexp_replace(trim("displayName"), '\s+', ' ', 'g'));

ALTER TABLE "users" ALTER COLUMN "displayNameKey" SET NOT NULL;

CREATE UNIQUE INDEX "users_role_displayNameKey_key" ON "users"("role", "displayNameKey");
