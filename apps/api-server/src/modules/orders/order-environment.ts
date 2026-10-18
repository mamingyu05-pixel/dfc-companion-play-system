import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

type IdentityDb = Pick<Prisma.TransactionClient, "$queryRaw">;
type IdentityRow = { database: string; address: string | null; rawAddress?: string | null };
const TEST_DATABASE_NAME = /^dfc_test_[a-z0-9_]{1,40}$/;

function hostClass(value: unknown) {
  if (value === "127.0.0.1") return "LOOPBACK_IPV4";
  if (value === "::1") return "LOOPBACK_IPV6";
  if (value === "127.0.0.1/32") return "LOOPBACK_IPV4_WITH_MASK";
  if (value === "::1/128") return "LOOPBACK_IPV6_WITH_MASK";
  return value == null ? "MISSING" : "OTHER";
}

// Return classifications only: never connection URLs, database names, addresses or credentials.
export async function inspectIsolatedDatabaseIdentity(db: IdentityDb, expectedDatabase: string) {
  // inet::text retains /32 or /128. host(inet) supplies the canonical host for exact matching.
  // https://www.postgresql.org/docs/16/functions-net.html
  const rows = await db.$queryRaw<Array<IdentityRow>>`
    SELECT current_database() AS "database", host(inet_server_addr()) AS "address",
           inet_server_addr()::text AS "rawAddress"`;
  const row = rows.length === 1 ? rows[0] : undefined;
  const expectedTestName = TEST_DATABASE_NAME.test(expectedDatabase);
  const actualTestName = typeof row?.database === "string" && TEST_DATABASE_NAME.test(row.database);
  const databaseMatches = row?.database === expectedDatabase;
  const normalizedClass = hostClass(row?.address);
  const accepted = rows.length === 1 && expectedTestName && actualTestName && databaseMatches &&
    (normalizedClass === "LOOPBACK_IPV4" || normalizedClass === "LOOPBACK_IPV6");
  return { accepted, rowCount: rows.length, expectedTestName, actualTestName, databaseMatches,
    hostClass: normalizedClass, rawHostClass: hostClass(row?.rawAddress ?? row?.address) };
}

// Server-owned marking. Client flags alone can never convert a live order to TEST.
export async function orderEnvironment(
  db: IdentityDb,
  requested?: unknown,
  env: Record<string, string | undefined> = process.env
) {
  if (requested !== undefined && requested !== "isolated-test") {
    throw new BadRequestException("订单环境无效，请重新核对连接");
  }
  const flag = env.DFC_ISOLATED_API;
  if (flag !== undefined && flag !== "" && flag !== "0" && flag !== "1") {
    throw new BadRequestException("隔离测试配置无效，已阻止下单");
  }
  if (flag !== "1") {
    if (requested !== undefined) throw new BadRequestException("当前不是隔离测试 API，已阻止测试订单");
    return { environment: "live" as const, isTest: false, storeKey: (env.DFC_STORE_KEY || "MAIN").slice(0, 50) };
  }
  const database = env.DFC_ISOLATED_DATABASE;
  const storeKey = env.DFC_STORE_KEY;
  if (env.NODE_ENV === "production" || !database || !TEST_DATABASE_NAME.test(database) ||
      !storeKey || !/^TEST_[A-Za-z0-9_-]{1,45}$/.test(storeKey)) {
    throw new BadRequestException("隔离数据库和 TEST 店铺尚未正确配置，已阻止下单");
  }
  // Check the connection actually used by the transaction, not the URL or client label.
  const isolation = await inspectIsolatedDatabaseIdentity(db, database);
  if (!isolation.accepted) {
    throw new BadRequestException({ message: "当前数据库未通过本机隔离核验，已阻止下单",
      code: "ISOLATED_DATABASE_REJECTED", isolation });
  }
  return { environment: "isolated-test" as const, isTest: true, storeKey };
}
