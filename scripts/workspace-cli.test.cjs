"use strict";

const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { test } = require("node:test");
const { apiEnvironment, testEnvironment, testPlan, workspaces, resolveCli } = require("./workspace-cli.cjs");
const { businessFiles } = require("./test-business.cjs");

test("API command refuses main or remote databases before running the test CLI and never includes credentials in the error", () => {
  for (const database of [
    "postgresql://synthetic:synthetic-private-value@127.0.0.1:15433/dfc_local",
    "postgresql://synthetic:synthetic-private-value@remote.invalid/dfc_synthetic",
    "http://synthetic:synthetic-private-value@127.0.0.1/dfc_synthetic"
  ]) {
    assert.throws(() => apiEnvironment({ DATABASE_URL: database }), error => {
      assert.doesNotMatch(error.message, /synthetic-private-value|remote\.invalid|postgresql:\/\//);
      return /dedicated loopback dfc_synthetic/.test(error.message);
    });
  }
  assert.throws(() => apiEnvironment({}), /API tests require/);
});

test("dedicated CI test environment preserves its DB target while disabling inherited integrations", () => {
  const database = "postgresql://synthetic:fixture@127.0.0.1:5432/dfc_synthetic";
  const environment = apiEnvironment({ DATABASE_URL: database, KOOK_TOKEN: "synthetic", SMTP_PASS: "synthetic", OPENAI_API_KEY: "synthetic",
    WECHAT_APP_SECRET: "synthetic", DFC_TEST_BASELINE: "1", DFC_BACKGROUND_JOBS_ENABLED: "true", AI_AUTO_DISPATCH_ENABLED: "true" });
  assert.equal(environment.DATABASE_URL, database);
  for (const name of ["KOOK_TOKEN", "SMTP_PASS", "OPENAI_API_KEY", "WECHAT_APP_SECRET"]) assert.equal(environment[name], undefined);
  assert.equal(environment.DFC_TEST_MODE, "1");
  assert.equal(environment.DFC_TEST_BASELINE, undefined);
  assert.equal(environment.NODE_ENV, "test");
  assert.equal(environment.DFC_BACKGROUND_JOBS_ENABLED, "false");
  assert.equal(environment.AI_AUTO_DISPATCH_ENABLED, "false");
  assert.ok(environment.JWT_SECRET.length >= 64);
});

test("offline business commands need no database and still disable external integrations", () => {
  const environment = testEnvironment({ DISCORD_TOKEN: "synthetic", AI_SUPPORT_ENABLED: "true" });
  assert.equal(environment.DATABASE_URL, undefined);
  assert.equal(environment.DISCORD_TOKEN, undefined);
  assert.equal(environment.AI_SUPPORT_ENABLED, "false");
});

test("root test plan runs API once and each discovered business file once", () => {
  const plan = testPlan();
  assert.equal(plan.api.invocations, 1);
  assert.equal(plan.business.invocations, 1);
  assert.equal(new Set(plan.business.files).size, plan.business.files.length);
  assert.ok(plan.business.files.includes("scripts/money-intent-recovery.test.cjs"));
  assert.ok(plan.business.files.includes("scripts/local-windows/gateway.test.cjs"));
  assert.deepEqual(plan.business.files, businessFiles());
});

test("admin and companion package tests select meaningful existing flows instead of placeholder commands", () => {
  assert.ok(businessFiles("admin").includes("scripts/finance-confirmation.test.cjs"));
  assert.ok(businessFiles("admin").includes("scripts/draft-selection.test.cjs"));
  assert.ok(businessFiles("companion").includes("scripts/companion-order-actions.test.cjs"));
  assert.ok(businessFiles("companion").includes("scripts/companion-receipt.test.cjs"));
  const root = path.resolve(__dirname, "..");
  for (const folder of ["admin", "companion"]) {
    const directory = `apps/${folder}-web/test`;
    if (!fs.existsSync(path.join(root, directory))) continue;
    for (const file of fs.readdirSync(path.join(root, directory)).filter(name => name.endsWith(".test.cjs"))) {
      assert.ok(businessFiles(folder).includes(`${directory}/${file}`));
      assert.ok(businessFiles().includes(`${directory}/${file}`));
    }
  }
});

test("compiler and Jest resolve their Node entry files without any .bin dependency", () => {
  const api = workspaces().find(workspace => workspace.manifest.name === "@dfc/api-server");
  const compiler = resolveCli(api, "typescript", "bin/tsc"), jest = resolveCli(api, "jest", "bin/jest.js");
  assert.ok(fs.statSync(compiler).isFile()); assert.ok(fs.statSync(jest).isFile());
  assert.equal(compiler.includes(`${path.sep}.bin${path.sep}`), false);
  assert.equal(jest.includes(`${path.sep}.bin${path.sep}`), false);
});
