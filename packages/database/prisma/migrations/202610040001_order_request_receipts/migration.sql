-- Must be applied with the API change; no historical payments or balances are rewritten.
CREATE TABLE "order_request_receipts" (
    "key" VARCHAR(64) NOT NULL,
    "payloadHash" VARCHAR(64) NOT NULL,
    "resourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_request_receipts_pkey" PRIMARY KEY ("key")
);
