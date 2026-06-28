#!/usr/bin/env node
const { loadProjectEnv } = require("./utils");

Object.assign(process.env, loadProjectEnv());

const { PrismaClient, Prisma } = require("../script-prisma-client");

const LEGACY_FLAT_PRICE = {
  pricePerHour: "128",
  entertainmentPricePerHour: "108",
  rankedPricePerHour: "128",
  highRankedPricePerHour: "128"
};

const BASELINE_PRICE = {
  pricePerHour: "98",
  entertainmentPricePerHour: "98",
  rankedPricePerHour: "98",
  highRankedPricePerHour: "98"
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
  const confirm = args.has("--confirm-rank-baseline") || args.has("--confirm-sync-prices");

  console.log("💰 May猫饼段位价基线审计");
  console.log("说明：新版不是统一价；本脚本只处理上一版遗留的 128/108 扁平价，并回到 ¥98 起基线。");
  console.log(apply ? "模式：真实更新数据库" : "模式：只审计，不修改数据库");
  if (apply && !confirm) {
    throw new Error("真实更新需要同时传入 --confirm-rank-baseline");
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
  console.log(`需回到段位价基线：${toSync.length}`);

  for (const profile of toSync.slice(0, 12)) {
    console.log(
      `- ${profile.nickname} (${profile.status}) base=${decimalText(profile.pricePerHour)} entertainment=${decimalText(
        profile.entertainmentPricePerHour
      )} ranked=${decimalText(profile.rankedPricePerHour)} high=${decimalText(profile.highRankedPricePerHour)} kook=${decimalText(
        profile.kookPricePerHour
      )} discord=${decimalText(profile.discordPricePerHour)}`
    );
  }
  if (toSync.length > 12) console.log(`... 另有 ${toSync.length - 12} 条未展开`);

  if (!apply || toSync.length === 0) {
    console.log("\n如需真实更新：node scripts/platform-setup/sync-price-policy.js --apply --confirm-rank-baseline");
    return;
  }

  const result = await prisma.$transaction(
    toSync.map((profile) =>
      prisma.companionProfile.update({
        where: { id: profile.id },
        data: buildUpdateData(profile)
      })
    )
  );
  console.log(`\n✅ 已回到段位价基线：${result.length} 条`);
}

function needsSync(profile) {
  return Object.keys(buildUpdateData(profile)).length > 0;
}

function buildUpdateData(profile) {
  const data = {};
  for (const [field, legacyValue] of Object.entries(LEGACY_FLAT_PRICE)) {
    if (decimalText(profile[field]) === legacyValue) {
      data[field] = new Prisma.Decimal(BASELINE_PRICE[field]);
    }
  }
  if (profile.kookPricePerHour !== null) data.kookPricePerHour = null;
  if (profile.discordPricePerHour !== null) data.discordPricePerHour = null;
  return data;
}

function decimalText(value) {
  return value == null ? null : new Prisma.Decimal(value).toString();
}
