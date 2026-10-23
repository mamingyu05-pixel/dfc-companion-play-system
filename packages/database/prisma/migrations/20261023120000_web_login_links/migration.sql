CREATE TABLE "web_login_links" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "web_login_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "web_login_links_tokenHash_key" ON "web_login_links"("tokenHash");
CREATE INDEX "web_login_links_userId_idx" ON "web_login_links"("userId");
ALTER TABLE "web_login_links" ADD CONSTRAINT "web_login_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
