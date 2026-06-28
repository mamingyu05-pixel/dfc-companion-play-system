const { parseOptions, runWalkthroughFix04 } = require("./discord/walkthrough-fix-04");
const { runKookWalkthroughFix04 } = require("./kook/walkthrough-fix-04");

async function main() {
  const args = new Set(process.argv.slice(2));
  const options = parseOptions();
  const runDiscord = !args.has("--kook-only");
  const runKook = !args.has("--discord-only");

  console.log("🔧 MayCat Club 频道走查修复 · 第 04 版\n");

  if (runDiscord) {
    console.log("═══ Discord ═══");
    await runWalkthroughFix04(options);
  }

  if (runKook) {
    console.log("\n═══ KOOK ═══");
    await runKookWalkthroughFix04(options);
  }
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
