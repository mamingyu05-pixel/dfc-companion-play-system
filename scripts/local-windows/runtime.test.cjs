"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

function withEnvironment(values, run) {
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) process.env[key] = value;
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("local runtime environment remains isolated from inherited integrations", async t => {
  // Requiring the launcher creates its runtime folder. Keep that side effect in our own empty temp directory.
  const temporaryRuntime = fs.mkdtempSync(path.join(os.tmpdir(), "dfc-runtime-env-test-"));
  t.after(() => {
    assert.equal(path.dirname(temporaryRuntime), path.resolve(os.tmpdir()));
    assert.match(path.basename(temporaryRuntime), /^dfc-runtime-env-test-/);
    assert.deepEqual(fs.readdirSync(temporaryRuntime), []);
    fs.rmdirSync(temporaryRuntime);
  });
  const launcher = withEnvironment({ DFC_LOCAL_RUNTIME: temporaryRuntime }, () => require("./runtime.cjs"));
  assert.equal(launcher.runtime, temporaryRuntime);
  const localConfig = { pgPort: 15433, pgPassword: "synthetic:p@ss/word#?", jwtSecret: "synthetic-local-jwt",
    botToken: "synthetic-local-bot", adminPassword: "synthetic-local-admin" };

  await t.test("AI, bot, mail, payment and isolated-test configuration is removed or explicitly disabled", () => {
    const removed = ["AI_SUPPORT_API_KEY", "AI_SUPPORT_BASE_URL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY",
      "DISCORD_TOKEN", "DISCORD_ORDER_CHANNEL_ID", "KOOK_TOKEN", "KOOK_GUILD_ID", "SMTP_HOST", "SMTP_USER", "SMTP_PASS",
      "WECHAT_APP_SECRET", "OAUTH_CLIENT_SECRET", "PAYMENT_API_KEY", "PAYOUT_TOKEN", "DFC_ISOLATED_API", "DFC_TEST_MODE", "DFC_STORE_KEY"];
    const inherited = Object.fromEntries(removed.map(key => [key, "synthetic-inherited-value"]));
    Object.assign(inherited, { AI_SUPPORT_ENABLED: "true", AI_AUTO_DISPATCH_ENABLED: "true", DFC_BACKGROUND_JOBS_ENABLED: "true" });
    withEnvironment(inherited, () => {
      const result = launcher.env(localConfig);
      for (const key of removed) assert.equal(result[key], undefined, `${key} must not reach the local services`);
      assert.equal(result.AI_SUPPORT_ENABLED, "false");
      assert.equal(result.AI_AUTO_DISPATCH_ENABLED, "false");
      assert.equal(result.DFC_BACKGROUND_JOBS_ENABLED, "false");
      assert.equal(process.env.OPENAI_API_KEY, "synthetic-inherited-value", "building child env must not mutate the parent env");
      assert.equal(process.env.DFC_BACKGROUND_JOBS_ENABLED, "true");
    });
  });

  await t.test("all portal URLs retain their base paths on the shared loopback origin", () => {
    withEnvironment({ CUSTOMER_WEB_URL: "https://synthetic.invalid", COMPANION_WEB_URL: "https://synthetic.invalid", ADMIN_WEB_URL: "https://synthetic.invalid" }, () => {
      const result = launcher.env(localConfig);
      for (const [key, basePath] of [["CUSTOMER_WEB_URL", "/customer"], ["COMPANION_WEB_URL", "/companion"], ["ADMIN_WEB_URL", "/admin"]]) {
        const url = new URL(result[key]);
        assert.equal(url.origin, "http://127.0.0.1:18080");
        assert.equal(url.pathname, basePath);
      }
    });
  });

  await t.test("private credentials, database, pool size and API binding override inherited deployment settings", () => {
    withEnvironment({ DATABASE_URL: "postgresql://synthetic:fixture@synthetic.invalid/inherited", JWT_SECRET: "synthetic-inherited-jwt",
      BOT_INTERNAL_TOKEN: "synthetic-inherited-bot", ADMIN_PASSWORD: "synthetic-inherited-admin", API_HOST: "0.0.0.0", API_PORT: "4000",
      NODE_ENV: "development", NODE_OPTIONS: "--max-old-space-size=8192", UPLOAD_DIR: "synthetic-inherited-uploads", TRUSTED_PROXY_CIDRS: "*" }, () => {
      const result = launcher.env(localConfig);
      const url = new URL(result.DATABASE_URL);
      assert.equal(url.protocol, "postgresql:");
      assert.equal(url.hostname, "127.0.0.1");
      assert.equal(url.port, "15433");
      assert.equal(url.username, "dfc_local");
      assert.equal(decodeURIComponent(url.password), localConfig.pgPassword);
      assert.equal(url.pathname, "/dfc_local");
      assert.equal(url.searchParams.get("schema"), "public");
      assert.equal(url.searchParams.get("connection_limit"), "4");
      assert.equal(new URL(launcher.env(localConfig, "dfc_synthetic").DATABASE_URL).pathname, "/dfc_synthetic");
      assert.equal(result.JWT_SECRET, localConfig.jwtSecret);
      assert.equal(result.BOT_INTERNAL_TOKEN, localConfig.botToken);
      assert.equal(result.ADMIN_PASSWORD, localConfig.adminPassword);
      assert.equal(result.API_HOST, "127.0.0.1");
      assert.equal(result.API_PORT, "18400");
      assert.equal(result.TRUSTED_PROXY_CIDRS, "loopback");
      assert.equal(result.NODE_ENV, "production");
      assert.equal(result.NODE_OPTIONS, "--max-old-space-size=640");
      assert.equal(result.UPLOAD_DIR, path.join(temporaryRuntime, "uploads"));
      assert.equal(result.NODE_PATH, path.join(temporaryRuntime, "node_modules"));
      assert.equal(result.NEXT_TELEMETRY_DISABLED, "1");
    });
  });
});
