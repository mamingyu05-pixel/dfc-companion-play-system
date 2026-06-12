CREATE UNIQUE INDEX "recharge_requests_customer_promotion_once_idx"
  ON "recharge_requests"("customerId", "promotionCodeId")
  WHERE "promotionCodeId" IS NOT NULL AND "status" <> 'REJECTED';
