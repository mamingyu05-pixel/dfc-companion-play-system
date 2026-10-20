import { Prisma } from "@prisma/client";

// Every status mutation uses group -> order lock order. Cancellation reprices
// siblings, so locking only the cancelled row would race a sibling's start.
export async function lockOrder(tx: Prisma.TransactionClient, orderId: string) {
  const rows = await tx.$queryRaw<Array<{ orderGroupId: string | null }>>`
    SELECT "orderGroupId" FROM "orders" WHERE "id" = ${orderId}`;
  if (rows[0]?.orderGroupId) {
    await tx.$queryRaw`SELECT "id" FROM "order_groups" WHERE "id" = ${rows[0].orderGroupId} FOR UPDATE`;
  }
  await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${orderId} FOR UPDATE`;
}
