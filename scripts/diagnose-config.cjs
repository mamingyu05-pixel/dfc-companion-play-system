#!/usr/bin/env node
// No dotenv, no process credentials, no fetch, and no service startup.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const input = process.argv.slice(2);
if (input.length && !(input.length === 2 && input[0] === "--example" && ["development", "production"].includes(input[1]))) {
  console.error("Usage: node scripts/diagnose-config.cjs [--example development|production]");
  process.exitCode = 2;
} else {
  const env = {};
  if (input.length) {
    const file = input[1] === "production" ? ".env.production.example" : ".env.example";
    for (const line of fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (match) env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  const source = fs.readFileSync(path.join(root, "packages/config/src/diagnostics.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  vm.runInNewContext(compiled.outputText, { exports, URL }, { timeout: 1000 });
  const result = exports.diagnoseConfig(env, { appId: exports.TEST_WECHAT_APP_ID, simulation: true });
  console.log(JSON.stringify({ ...result, input: input.length ? `${input[1]}_example` : "empty_environment",
    credentialsRead: false, miniappEvidence: "known_test_appid_and_existing_simulation_only" }, null, 2));
  process.exitCode = 2;
}
