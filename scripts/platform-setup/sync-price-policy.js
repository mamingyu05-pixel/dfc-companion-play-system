#!/usr/bin/env node
const { loadProjectEnv } = require("./utils");

Object.assign(process.env, loadProjectEnv());

const { PrismaClient, Prisma } = require("../script-prisma-client");

const TARGET = {
  pricePerHour: "128",
  entertainmentPricePerHour: "108",
  rankedPricePerHour: "128",
  highRankedPricePerHour: "128",
  kookPricePerHour: null,
  discordPricePerHour: null
};

const prisma = new PrismaClient();

main()
  .catch((error) => {
    console.error("❌ 错误：", error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has("--apply");
  const confirm = args.has("--confirm-sync-prices");

  console.log("💰 May猫饼陪玩价格策略同步");
  console.log(apply ? "模式：真实更新数据库" : "模式：只审计，不修改数据库");
  if (apply && !confirm) {
    throw new Error("真实更新需要同时传入 --confirm-sync-prices");
  }

  const profiles = await prisma.companionProfile.findMany({
    select: {
      id: true,
      nickname: true,
      status: true,
      pricePerHour: true,
      kookPricePerHour: true,
      discordPricePerHour: true,
      entertainmentPricePerHour: true,
      rankedPricePerHour: true,
      highRankedPricePerHour: true
    },
    orderBy: { createdAt: "asc" }
  });

  const toSync = profiles.filter(needsSync);
  console.log(`总陪玩资料：${profiles.length}`);
  console.log(`需同步价格：${toSync.length}`);

  for (const profile of toSync.slice(0, 12)) {
    console.log(
      `- ${profile.nickname} (${profile.status}) base=${decimalText(profile.pricePerHour)} entertainment=${decimalText(
        profile.entertainmentPricePerHour
      )} ranked=${decimalText(profile.rankedPricePerHour)} high=${decimalText(profile.highRankedPricePerHour)}`
    );
  }
  if (toSync.length > 12) console.log(`... 另有 ${toSync.length - 12} 条未展开`);

  if (!apply || toSync.length === 0) {
    console.log("\n如需真实更新：node scripts/platform-setup/sync-price-policy.js --apply --confirm-sync-prices");
    return;
  }

  const result = await prisma.companionProfile.updateMany({
    where: { id: { in: toSync.map((profile) => profile.id) } },
    data: {
      pricePerHour: new Prisma.Decimal(TARGET.pricePerHour),
      entertainmentPricePerHour: new Prisma.Decimal(TARGET.entertainmentPricePerHour),
      rankedPricePerHour: new Prisma.Decimal(TARGET.rankedPricePerHour),
      highRankedPricePerHour: new Prisma.Decimal(TARGET.highRankedPricePerHour),
      kookPricePerHour: null,
      discordPricePerHour: null
    }
  });
  console.log(`\n✅ 已同步陪玩价格：${result.count} 条`);
}

function needsSync(profile) {
  return (
    decimalText(profile.pricePerHour) !== TARGET.pricePerHour ||
    decimalText(profile.entertainmentPricePerHour) !== TARGET.entertainmentPricePerHour ||
    decimalText(profile.rankedPricePerHour) !== TARGET.rankedPricePerHour ||
    decimalText(profile.highRankedPricePerHour) !== TARGET.highRankedPricePerHour ||
    profile.kookPricePerHour !== TARGET.kookPricePerHour ||
    profile.discordPricePerHour !== TARGET.discordPricePerHour
  );
}

function decimalText(value) {
  return value == null ? null : new Prisma.Decimal(value).toString();
}
