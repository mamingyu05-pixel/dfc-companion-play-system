const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

const TABLES = [
  ["complaints", () => prisma.complaint.count()],
  ["orderStatusLogs", () => prisma.orderStatusLog.count()],
  ["orders", () => prisma.order.count()],
  ["orderDraftCandidates", () => prisma.orderDraftCandidate.count()],
  ["orderDraftEvents", () => prisma.orderDraftEvent.count()],
  ["orderDrafts", () => prisma.orderDraft.count()],
  ["walletTransactions", () => prisma.walletTransaction.count()],
  ["rechargeRequests", () => prisma.rechargeRequest.count()],
  ["withdrawalRequests", () => prisma.withdrawalRequest.count()],
  ["botEvents", () => prisma.botEvent.count()],
  ["aiSupportConversations", () => prisma.aiSupportConversation.count()],
];

async function printCounts(title) {
  console.log(`\n${title}`);
  for (const [name, countFn] of TABLES) {
    console.log(`${name}: ${await countFn()}`);
  }
  console.log(`wallets: ${await prisma.wallet.count()}`);
  console.log(`promotionCodes: ${await prisma.promotionCode.count()}`);
}

async function main() {
  await printCounts("Current business data");

  console.log("\nWill keep users, companion profiles, platform bindings, admin accounts and uploaded media references.");
  console.log("Will clear orders, drafts, wallet transactions, recharge/withdrawal requests, bot events and AI support conversations.");
  console.log("Will reset wallet balances/income and promotion code used counts to zero.");

  if (!apply) {
    console.log("\nPreview only. Re-run with --apply to clear test business data.");
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const summary = {};

    summary.complaints = (await tx.complaint.deleteMany({})).count;
    summary.orderStatusLogs = (await tx.orderStatusLog.deleteMany({})).count;
    summary.referralsReset = (
      await tx.userReferral.updateMany({
        where: {
          OR: [
            { firstOrderId: { not: null } },
            { rewardedAt: { not: null } },
            { rewardStatus: { not: "PENDING" } },
          ],
        },
        data: {
          firstOrderId: null,
          rewardedAt: null,
          rewardStatus: "PENDING",
        },
      })
    ).count;
    summary.orders = (await tx.order.deleteMany({})).count;

    summary.orderDraftCandidates = (await tx.orderDraftCandidate.deleteMany({})).count;
    summary.orderDraftEvents = (await tx.orderDraftEvent.deleteMany({})).count;
    summary.orderDrafts = (await tx.orderDraft.deleteMany({})).count;

    summary.walletTransactions = (await tx.walletTransaction.deleteMany({})).count;
    summary.rechargeRequests = (await tx.rechargeRequest.deleteMany({})).count;
    summary.withdrawalRequests = (await tx.withdrawalRequest.deleteMany({})).count;
    summary.botEvents = (await tx.botEvent.deleteMany({})).count;
    summary.aiSupportConversations = (await tx.aiSupportConversation.deleteMany({})).count;

    summary.walletsReset = (
      await tx.wallet.updateMany({
        data: {
          availableBalance: "0",
          frozenBalance: "0",
          availableIncome: "0",
          pendingIncome: "0",
          frozenIncome: "0",
        },
      })
    ).count;
    summary.promotionCodesReset = (
      await tx.promotionCode.updateMany({
        data: { usedCount: 0 },
      })
    ).count;

    return summary;
  });

  console.log("\nCleared business test data:");
  console.table(result);
  await printCounts("Remaining business data");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
