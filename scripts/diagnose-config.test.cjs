const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
function load(file, bindings = {}) {
  const exports = {};
  const result = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true } });
  vm.runInNewContext(result.outputText, { exports, URL,
    require: id => { throw new Error(`Unexpected import: ${id}`); }, ...bindings }, { timeout: 1000 });
  return exports;
}
const diagnostic = load("packages/config/src/diagnostics.ts");
const good = { NODE_ENV: "production", DOMAIN: "club.acme.cn",
  DATABASE_URL: "postgresql://service:Db7v9Qz@postgres:5432/dfc",
  JWT_SECRET: "A7b9".repeat(16), BOT_INTERNAL_TOKEN: "C2d3".repeat(16),
  CUSTOMER_WEB_URL: "https://club.acme.cn/customer", COMPANION_WEB_URL: "https://club.acme.cn/companion",
  ADMIN_WEB_URL: "https://club.acme.cn/admin", KOOK_TOKEN: "K9q8s7", KOOK_VERIFY_TOKEN: "V9q8s7",
  KOOK_GUILD_ID: "123456", KOOK_ORDER_CHANNEL_ID: "234567", KOOK_DISPATCH_CHANNEL_ID: "345678" };

test("missing credentials fail closed without external capabilities", () => {
  const result = diagnostic.diagnoseConfig({});
  assert.equal(result.ok, false); assert.equal(result.productionReady, false);
  assert.equal(result.checks.kook.configurationValid, false);
  assert.equal(result.checks.kook.fields.KOOK_TOKEN, "MISSING");
  assert.equal(result.externalChecksPerformed, false);
});
test("present credentials remain unverified and are never emitted", () => {
  const result = diagnostic.diagnoseConfig(good);
  assert.equal(result.checks.kook.configurationValid, true);
  assert.equal(result.checks.deployment.configurationValid, true);
  assert.equal(result.productionReady, false); assert.equal(result.ok, false);
  for (const key of ["KOOK_TOKEN", "KOOK_VERIFY_TOKEN", "DATABASE_URL", "JWT_SECRET", "BOT_INTERNAL_TOKEN"]) {
    assert.ok(!JSON.stringify(result).includes(good[key]));
  }
});
test("empty, whitespace and placeholder values do not pass", () => {
  for (const value of ["", "  ", "replace-with-token", "ChangeMe123!", "your_token", "${TOKEN}", "<token>", "xxxx", "dummy-value"]) {
    const result = diagnostic.diagnoseKook({ ...good, KOOK_TOKEN: value });
    assert.equal(result.configurationValid, false, value);
  }
});
test("wrong IDs and short internal authentication are rejected", () => {
  for (const [key, value] of [["KOOK_GUILD_ID", "channel-name"], ["KOOK_ORDER_CHANNEL_ID", "0"], ["BOT_INTERNAL_TOKEN", "short"]]) {
    assert.equal(diagnostic.diagnoseKook({ ...good, [key]: value }).fields[key], "INVALID");
  }
});
test("development, local callbacks, domain mismatch and example passwords cannot imply deployment health", () => {
  for (const [key, value] of [["NODE_ENV", "development"], ["DOMAIN", "example.com"],
    ["DATABASE_URL", "postgresql://dfc:replace-with-password@postgres/dfc"],
    ["CUSTOMER_WEB_URL", "http://localhost:3000/customer"],
    ["ADMIN_WEB_URL", "https://wrong.acme.cn/admin"], ["COMPANION_WEB_URL", "https://u:p@club.acme.cn/companion"]]) {
    assert.equal(diagnostic.diagnoseConfig({ ...good, [key]: value }).checks.deployment.configurationValid, false, key);
  }
});
test("test AppID is identified and is never payment authorization", () => {
  const result = diagnostic.diagnoseConfig(good, { appId: "wxe2812f4a7cbb2c64", simulation: true });
  assert.equal(result.checks.miniapp.appIdStatus, "TEST_ONLY");
  assert.ok(result.checks.miniapp.blockers.includes("SIMULATION_ONLY"));
  assert.equal(result.checks.payment.verified, false);
});
test("an arbitrary AppID or env flag cannot declare unimplemented integrations ready", () => {
  const result = diagnostic.diagnoseConfig({ ...good, PAYMENT_ENABLED: "true", MINIAPP_READY: "true" },
    { appId: "wx0123456789abcdef", simulation: false });
  assert.equal(result.checks.miniapp.status, "BLOCKED");
  assert.equal(result.checks.payment.status, "BLOCKED");
});
test("health distinguishes process liveness from production readiness", () => {
  const decorator = () => () => {};
  const health = load("apps/api-server/src/modules/health/health.controller.ts", {
    process: { env: {} }, require: id => id === "@nestjs/common" ? { Controller: decorator, Get: decorator } : diagnostic,
  });
  const result = new health.HealthController().check();
  assert.equal(result.processAlive, true); assert.equal(result.ok, false);
  assert.equal(result.scope, "offline_configuration");
});
test("KOOK startup blocks before construction or scheduling, without credential output", () => {
  for (const env of [{}, { ...good, KOOK_TOKEN: "replace-with-token" }]) {
    const messages = []; const exits = [];
    load("apps/kook-adapter/src/main.ts", { process: { env, exit: code => exits.push(code) },
      console: { error: error => messages.push(String(error)), log: () => assert.fail("Must not claim ready") },
      setInterval: () => assert.fail("Must not schedule jobs"),
      require: id => id === "./index" ? { KookAdapter: class { constructor() { assert.fail("Must not construct"); } } } : diagnostic,
    });
    assert.deepEqual(exits, [1]); assert.match(messages.join(), /configuration blocked/);
  }
});
test("CLI only reads explicit examples, returns 2, ignores ambient credentials", () => {
  for (const args of [[], ["--example", "production"], ["--example", "development"]]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, "diagnose-config.cjs"), ...args], {
      encoding: "utf8", timeout: 10000,
      env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH,
        KOOK_TOKEN: "AMBIENT_SECRET_DO_NOT_READ" },
    });
    assert.equal(result.status, 2, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false); assert.equal(report.credentialsRead, false);
    assert.ok(!result.stdout.includes("AMBIENT_SECRET_DO_NOT_READ"));
  }
});
test("CLI refuses arbitrary credential-file paths", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "diagnose-config.cjs"), "--example", ".env"],
    { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 2); assert.match(result.stderr, /Usage:/); assert.equal(result.stdout, "");
});

test("disabled background queue and missing heartbeat never report healthy", () => {
  assert.equal(diagnostic.diagnoseConfig({}).checks.backgroundJobs.status, "BLOCKED");
  const jobs = diagnostic.diagnoseConfig({ DFC_BACKGROUND_JOBS_ENABLED: "true" }).checks.backgroundJobs;
  assert.equal(jobs.enabled, true); assert.equal(jobs.verified, false);
  assert.ok(jobs.blockers.includes("WORKER_HEARTBEAT_NOT_VERIFIED"));
});
