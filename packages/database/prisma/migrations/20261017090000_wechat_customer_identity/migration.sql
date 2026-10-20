CREATE TABLE "wechat_identities" (
  "appId" TEXT NOT NULL,
  "openId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wechat_identities_pkey" PRIMARY KEY ("appId", "openId"),
  CONSTRAINT "wechat_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "wechat_identities_appId_userId_key" ON "wechat_identities"("appId", "userId");
CREATE INDEX "wechat_identities_userId_idx" ON "wechat_identities"("userId");
