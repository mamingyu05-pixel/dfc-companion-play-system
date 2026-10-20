import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

type Receipt = { key: string; payloadHash: string; resourceId: string | null };

// Attach this only after the transaction rejects with a business validation error.
// Database/commit/transport errors have an unknown outcome and must keep the original request identity.
export function rejectUncommittedOrderRequest(error: unknown): never {
  if (error instanceof BadRequestException) {
    throw new BadRequestException({ statusCode: 400, message: error.message, requestOutcome: "NOT_COMMITTED" });
  }
  throw error;
}

export function requireOrderRequestId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,96}$/.test(value)) {
    throw new BadRequestException("requestId is required (16-96 letters, digits, hyphens or underscores)");
  }
  return value;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export async function beginOrderRequest(
  tx: Prisma.TransactionClient, scope: "ORDER" | "ORDER_GROUP", customerId: string,
  body: { requestId?: string; sourceDraftId?: string; [key: string]: unknown }
): Promise<Receipt> {
  // Draft conversion is an internal path with a stable source identity; public controllers require requestId.
  const identity = body.requestId === undefined && body.sourceDraftId
    ? `draft:${body.sourceDraftId}` : requireOrderRequestId(body.requestId);
  const digest = (value: string) => createHash("sha256").update(value).digest("hex");
  const key = digest(JSON.stringify([scope, customerId, identity]));
  const { requestId: _requestId, ...payload } = body;
  const payloadHash = digest(JSON.stringify(canonical(payload)));
  // Unique-key conflict waits for the prior transaction. The receipt and debit commit/roll back together.
  const [receipt] = await tx.$queryRaw<Receipt[]>`
    INSERT INTO "order_request_receipts" ("key", "payloadHash") VALUES (${key}, ${payloadHash})
    ON CONFLICT ("key") DO UPDATE SET "key" = EXCLUDED."key"
    RETURNING "key", "payloadHash", "resourceId"`;
  if (!receipt || receipt.payloadHash !== payloadHash) {
    throw new ConflictException("requestId already belongs to a different order request; restore the original request");
  }
  return receipt;
}

export async function completeOrderRequest(tx: Prisma.TransactionClient, receipt: Receipt, resourceId: string) {
  const updated = await tx.$executeRaw`
    UPDATE "order_request_receipts" SET "resourceId" = ${resourceId}
    WHERE "key" = ${receipt.key} AND "resourceId" IS NULL`;
  if (updated !== 1) throw new ConflictException("Order request receipt could not be completed");
}


// Read-only recovery. Absence can race an in-flight commit and never permits a new request key.
export async function findCustomerOrderRequest(db: Prisma.TransactionClient, customerId: string, requestId: string) {
  const identity = requireOrderRequestId(requestId);
  const key = createHash("sha256").update(JSON.stringify(["ORDER", customerId, identity])).digest("hex");
  const [receipt] = await db.$queryRaw<Receipt[]>`
    SELECT "key", "payloadHash", "resourceId" FROM "order_request_receipts" WHERE "key" = ${key}`;
  if (!receipt?.resourceId) return { requestId: identity, outcome: "UNRESOLVED" as const, allowNewRequest: false };
  const order = await db.order.findFirst({ where: { id: receipt.resourceId, customerId },
    select: { id: true, orderNo: true, status: true, totalAmount: true, hours: true, mode: true, isTest: true, storeKey: true } });
  if (!order) throw new ConflictException("原申请需要管理员核对，请勿重复下单");
  return { requestId: identity, outcome: "CONFIRMED" as const, allowNewRequest: false,
    order: { ...order, totalAmount: order.totalAmount.toString(), hours: order.hours.toString() } };
}
