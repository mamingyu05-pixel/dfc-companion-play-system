const { renameDiscord } = require("./discord/rename");
const { fixPermissions } = require("./discord/permissions");
const { resetIntro } = require("./discord/reset-intro");
const { updateExamChannels } = require("./discord/exam-channels");
const { publishOpsContent } = require("./discord/ops-content");
const { syncKook } = require("./kook/sync");

async function main() {
  const args = new Set(process.argv.slice(2));
  const runDiscord = !args.has("--kook-only");
  const runKook = !args.has("--discord-only");

  console.log("🚀 May猫饼平台频道全套搭建\n");

  if (runDiscord) {
    console.log("━━━ M1: Discord 重命名 ━━━");
    await renameDiscord();

    console.log("\n━━━ M2: Discord 权限 ━━━");
    await fixPermissions();

    console.log("\n━━━ M3: Discord 频道简介重置 ━━━");
    await resetIntro();

    console.log("\n━━━ M4: Discord 考核/违规 ━━━");
    await updateExamChannels();

    console.log("\n━━━ M5: Discord 运营内容 ━━━");
    await publishOpsContent();
  }

  if (runKook) {
    console.log("\n━━━ M6: KOOK 同步 ━━━");
    await syncKook();
  }

  console.log("\n✅ 全部完成");
}

module.exports = {
  main
};

if (require.main === module) {
  main().catch((error) => {
    console.error("\n❌ 错误：", error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) console.error(error.stack);
    process.exit(1);
  });
}
