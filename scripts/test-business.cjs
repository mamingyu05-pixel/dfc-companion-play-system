"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const directories = ["apps/customer-web/test", "scripts", "scripts/local-windows"];
const files = directories.flatMap(directory => fs.readdirSync(path.join(root, directory), { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith(".test.cjs"))
  .map(entry => `${directory}/${entry.name}`)).sort();

if (!files.length) throw new Error("No business regression files found");
if (process.argv.length > 2) {
  if (process.argv.length !== 3 || process.argv[2] !== "--list") throw new Error("Usage: node scripts/test-business.cjs [--list]");
  console.log(JSON.stringify(files, null, 2));
} else {
  console.log(`BUSINESS_TEST_FILES count=${files.length}`);
  const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...files], {
    cwd: root, env: process.env, windowsHide: true, stdio: "inherit"
  });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
