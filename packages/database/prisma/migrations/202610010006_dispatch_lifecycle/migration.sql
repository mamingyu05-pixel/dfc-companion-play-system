ALTER TABLE "orders" ADD COLUMN "dispatchVersion" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "acceptanceDeadline" TIMESTAMP(3);
CREATE INDEX "orders_status_acceptanceDeadline_idx" ON "orders"("status", "acceptanceDeadline");
