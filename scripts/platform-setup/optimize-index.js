const { runDiscordOptimize } = require("./optimize-discord");
const { runKookOptimize } = require("./optimize-kook");

async function main() {
  const args = new Set(process.argv.slice(2));
  const runDiscord = !args.has("--kook-only");
  const runKook = !args.has("--discord-only");

  console.log("🔧 May猫饼平台频道优化开始\n");

  if (runDiscord) {
    console.log("═══ Discord ═══");
    await runDiscordOptimize();
  }

  if (runKook) {
    console.log("\n═══ KOOK ═══");
    await runKookOptimize();
  }

  console.log("\n✅ 全部完成");
  console.log("\n需要手动完成的事项：");
  console.log("  1. 在 Discord 频道简介里上传三张横幅图片（banner1-3.png）");
  console.log('  2. 如果 KOOK 店内导航是人工发的，请手动修正"自助下单"链接');
}

module.exports = {
  main
};

if (require.main === module) {
  main().catch((error) => {
    console.error("❌ 错误：", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
