#!/usr/bin/env node
const { runDiscordSetup } = require("./discord-setup");
const { runKookSetup } = require("./kook-setup");

async function main() {
  const args = new Set(process.argv.slice(2));
  const runDiscord = !args.has("--kook-only");
  const runKook = !args.has("--discord-only");

  console.log("May猫饼平台频道搭建开始\n");

  if (runDiscord) {
    console.log("========== Discord ==========");
    await runDiscordSetup();
  }

  if (runKook) {
    console.log("\n========== KOOK ==========");
    await runKookSetup();
  }

  console.log("\n全部完成");
}

main().catch((error) => {
  console.error("平台频道搭建失败：", error instanceof Error ? error.message : error);
  process.exit(1);
});
