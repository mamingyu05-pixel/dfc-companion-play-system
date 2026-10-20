CREATE TABLE "order_reviews" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "stars" INTEGER NOT NULL CHECK ("stars" BETWEEN 1 AND 5),
  "comment" VARCHAR(200) NOT NULL DEFAULT '',
  "hidden" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_reviews_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "order_reviews_orderId_key" ON "order_reviews"("orderId");
CREATE INDEX "orders_status_reportedCompletedAt_idx" ON "orders"("status", "reportedCompletedAt");
INSERT INTO "platform_settings" ("id", "key", "value", "description", "updatedAt")
VALUES ('order-auto-acceptance-hours', 'ORDER_AUTO_ACCEPTANCE_HOURS', '48', '客户超时自动验收小时数（公司代定48小时，可改）', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
