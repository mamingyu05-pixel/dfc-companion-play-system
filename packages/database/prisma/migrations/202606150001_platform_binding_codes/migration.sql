CREATE TABLE "platform_binding_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "BotPlatform" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_binding_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_binding_codes_codeHash_key" ON "platform_binding_codes"("codeHash");
CREATE INDEX "platform_binding_codes_userId_platform_idx" ON "platform_binding_codes"("userId", "platform");
CREATE INDEX "platform_binding_codes_expiresAt_idx" ON "platform_binding_codes"("expiresAt");

ALTER TABLE "platform_binding_codes"
ADD CONSTRAINT "platform_binding_codes_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
