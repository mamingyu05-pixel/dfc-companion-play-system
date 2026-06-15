#!/usr/bin/env node
const { PrismaClient, UserRole, UserStatus } = require("./script-prisma-client");

const prisma = new PrismaClient();

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

async function main() {
  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");
  const rows = await prisma.userExternalAccount.findMany({
    where: {
      platform: { in: ["KOOK", "DISCORD"] },
      user: {
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
        email: { endsWith: "@platform.maycatplay.local" }
      }
    },
    include: {
      user: {
        include: {
          wallet: true,
          customerOrders: { select: { id: true }, take: 1 },
          customerOrderDrafts: { select: { id: true }, take: 1 },
          walletTransactions: { select: { id: true }, take: 1 }
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });

  const invalidRows = rows.filter((row) => !isValidPlatformUserId(row.platform, row.externalUserId));
  console.log(`Invalid platform placeholder users found: ${invalidRows.length}`);
  if (!invalidRows.length) return;

  let quarantined = 0;
  let skipped = 0;
  for (const row of invalidRows) {
    const business = getBusinessFootprint(row.user);
    const canQuarantine = force || !business.hasBusinessData;
    const line = [
      row.user.id,
      row.user.displayName,
      row.user.email,
      `${row.platform}:${row.externalUserId}`,
      business.summary || "empty"
    ].join(" | ");

    if (!apply) {
      console.log(`[preview] ${canQuarantine ? "will quarantine" : "skip business data"} | ${line}`);
      continue;
    }

    if (!canQuarantine) {
      console.log(`[skip] business data exists | ${line}`);
      skipped += 1;
      continue;
    }

    const displayName = `无效${row.platform}占位账号-${row.externalUserId}`;
    await prisma.user.update({
      where: { id: row.userId },
      data: {
        status: UserStatus.BANNED,
        displayName,
        displayNameKey: `invalid-${row.platform.toLowerCase()}-${row.externalUserId}-${row.userId.slice(-8)}`.toLowerCase()
      }
    });
    console.log(`[quarantined] ${line}`);
    quarantined += 1;
  }

  if (!apply) {
    console.log("Preview only. Re-run with --apply to ban empty invalid placeholders.");
    console.log("Use --force only if you manually confirmed the placeholder has no real customer value.");
    return;
  }

  console.log(`Done. quarantined=${quarantined}, skipped=${skipped}`);
}

function isValidPlatformUserId(platform, value) {
  const text = String(value ?? "");
  if (platform === "KOOK") return /^\d{6,}$/.test(text);
  if (platform === "DISCORD") return /^\d{15,22}$/.test(text);
  return true;
}

function getBusinessFootprint(user) {
  const wallet = user.wallet;
  const hasMoney =
    wallet &&
    (wallet.availableBalance.toNumber() !== 0 ||
      wallet.frozenBalance.toNumber() !== 0 ||
      wallet.availableIncome.toNumber() !== 0 ||
      wallet.pendingIncome.toNumber() !== 0);
  const hasOrders = user.customerOrders.length > 0;
  const hasDrafts = user.customerOrderDrafts.length > 0;
  const hasTransactions = user.walletTransactions.length > 0;
  const parts = [];
  if (hasMoney) parts.push("wallet_non_zero");
  if (hasOrders) parts.push("orders");
  if (hasDrafts) parts.push("drafts");
  if (hasTransactions) parts.push("wallet_transactions");
  return { hasBusinessData: parts.length > 0, summary: parts.join(",") };
}
