"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const directories = ["apps/customer-web/test", "apps/admin-web/test", "apps/companion-web/test", "scripts", "scripts/local-windows"];
const sharedScopes = {
  admin: ["draft-selection", "finance-confirmation", "financial-loading", "money-intent-recovery", "three-role-flow"],
  companion: ["companion-order-actions", "companion-receipt", "financial-loading", "money-intent-recovery", "three-role-flow"],
  discord: ["community-config", "diagnose-config", "companion-receipt"],
  kook: ["community-config", "diagnose-config", "companion-receipt", "kook-onboarding-reminder"]
};

function businessFiles(scope = "all") {
  if (!["all", "customer", ...Object.keys(sharedScopes)].includes(scope)) throw new Error("Unknown business test scope");
  const files = directories.flatMap(directory => {
    if (!fs.existsSync(path.join(root, directory))) {
      if (directory === "apps/admin-web/test" || directory === "apps/companion-web/test") return [];
      throw new Error(`Required business regression directory missing: ${directory}`);
    }
    return fs.readdirSync(path.join(root, directory), { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith(".test.cjs"))
      .map(entry => `${directory}/${entry.name}`);
  }).sort();
  const selected = scope === "all" ? files : files.filter(file => file.startsWith(`apps/${scope}-web/test/`)
    || sharedScopes[scope]?.some(name => file === `scripts/${name}.test.cjs`));
  if (!selected.length) throw new Error(`No business regression files found for ${scope}`);
  return [...new Set(selected)];
}

function runBusinessTests(scope = "all", environment = process.env) {
  const files = businessFiles(scope);
  console.log(`BUSINESS_TEST_FILES count=${files.length}`);
  const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...files], {
    cwd: root, env: environment, windowsHide: true, stdio: "inherit"
  });
  if (result.error) console.error(result.error.message);
  return result.status ?? 1;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--list") console.log(JSON.stringify(businessFiles(), null, 2));
  else if (!args.length) process.exitCode = runBusinessTests();
  else throw new Error("Usage: node scripts/test-business.cjs [--list]");
}

module.exports = { businessFiles, runBusinessTests };
