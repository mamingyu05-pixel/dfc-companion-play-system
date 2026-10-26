"use strict";

const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { createRequire } = require("node:module"), { spawnSync } = require("node:child_process");
const { businessFiles, runBusinessTests } = require("./test-business.cjs");
const root = path.resolve(__dirname, "..");

function workspaces() {
  return ["apps", "packages"].flatMap(area => fs.readdirSync(path.join(root, area), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(root, area, entry.name, "package.json")))
    .map(entry => {
      const relative = `${area}/${entry.name}`, directory = path.join(root, relative);
      return { relative, directory, manifest: JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8")) };
    })).sort((a, b) => a.relative.localeCompare(b.relative));
}
function resolveCli(workspace, packageName, entry) {
  for (const manifest of [path.join(workspace.directory, "package.json"), path.join(root, "package.json")]) {
    try {
      const resolver = createRequire(manifest);
      const file = path.join(path.dirname(resolver.resolve(`${packageName}/package.json`)), entry);
      if (fs.statSync(file).isFile()) return file;
    } catch { /* A workspace may use the root's existing dependency link. */ }
  }
  throw new Error(`Cannot resolve ${packageName} CLI for ${workspace.manifest.name}; check the existing dependency links`);
}
function testEnvironment(inherited = process.env) {
  let environment = { ...inherited };
  if (inherited.DFC_LOCAL_RUNTIME) {
    const runtimePath = path.resolve(inherited.DFC_LOCAL_RUNTIME);
    if (!fs.existsSync(path.join(runtimePath, "runtime-private.json"))) throw new Error("DFC_LOCAL_RUNTIME must refer to an already prepared local runtime");
    // The launcher reads its runtime selection on first import; never use its default main database.
    const previous = process.env.DFC_LOCAL_RUNTIME;
    try {
      process.env.DFC_LOCAL_RUNTIME = runtimePath;
      const launcherFile = path.join(__dirname, "local-windows/runtime.cjs");
      delete require.cache[require.resolve(launcherFile)];
      const launcher = require(launcherFile);
      let configuration;
      try { configuration = launcher.config(); }
      catch { throw new Error("Cannot load the prepared local runtime test configuration"); }
      environment = { ...inherited, ...launcher.env(configuration, "dfc_synthetic") };
    } finally {
      if (previous === undefined) delete process.env.DFC_LOCAL_RUNTIME;
      else process.env.DFC_LOCAL_RUNTIME = previous;
    }
  }
  if (environment.DATABASE_URL) {
    let database;
    try { database = new URL(environment.DATABASE_URL); } catch { throw new Error("Tests require a valid dedicated loopback dfc_synthetic database URL"); }
    if (!["postgres:", "postgresql:"].includes(database.protocol) || !["127.0.0.1", "localhost"].includes(database.hostname) || database.pathname !== "/dfc_synthetic") {
      throw new Error("Tests refuse databases other than the dedicated loopback dfc_synthetic database");
    }
  }
  for (const name of Object.keys(environment)) {
    if (/^(DISCORD|KOOK|SMTP|WECHAT|OAUTH|PAYMENT|PAYOUT|AI_SUPPORT|OPENAI|ANTHROPIC|DEEPSEEK|DFC_ISOLATED|DFC_STORE|DFC_TEST)/.test(name)) delete environment[name];
  }
  const modulePaths = [environment.NODE_PATH, path.join(root, "node_modules"), path.join(root, "apps/api-server/node_modules")].filter(Boolean);
  return { ...environment, NODE_ENV: "test", DFC_TEST_MODE: "1", DFC_BACKGROUND_JOBS_ENABLED: "false", AI_SUPPORT_ENABLED: "false", AI_AUTO_DISPATCH_ENABLED: "false",
    JWT_SECRET: environment.JWT_SECRET || crypto.randomBytes(32).toString("hex"), NODE_PATH: [...new Set(modulePaths)].join(path.delimiter) };
}
function apiEnvironment(inherited = process.env) {
  const environment = testEnvironment(inherited);
  if (!environment.DATABASE_URL) throw new Error("API tests require DFC_LOCAL_RUNTIME or an explicit dedicated loopback dfc_synthetic DATABASE_URL");
  return environment;
}
function runNode(label, entry, args, cwd, environment = process.env) {
  console.log(`WORKSPACE_COMMAND ${label}`);
  const result = spawnSync(process.execPath, [entry, ...args], { cwd, env: environment, windowsHide: true, stdio: "inherit" });
  if (result.error) console.error(result.error.message);
  const code = result.status ?? 1;
  console.log(`WORKSPACE_RESULT ${label} exit=${code}`);
  return code;
}
function lint(target) {
  const candidates = workspaces().filter(workspace => workspace.manifest.scripts?.lint);
  const selected = target ? candidates.filter(workspace => [workspace.relative, workspace.manifest.name, path.basename(workspace.relative)].includes(target)) : candidates;
  if (!selected.length) throw new Error("No configured lint workspace matched");
  let failures = 0;
  for (const workspace of selected) {
    const code = runNode(`${workspace.manifest.name}:lint`, resolveCli(workspace, "typescript", "bin/tsc"),
      ["-p", "tsconfig.json", "--noEmit", "--incremental", "false"], workspace.directory);
    if (code !== 0) failures++;
  }
  console.log(`WORKSPACE_LINT_${failures ? "FAIL" : "PASS"} workspaces=${selected.length} failed=${failures}`);
  return failures ? 1 : 0;
}
function apiTests(environment, extra = []) {
  const workspace = workspaces().find(item => item.manifest.name === "@dfc/api-server");
  console.log("API_TEST_DATABASE name=dfc_synthetic scope=loopback-only");
  return runNode("@dfc/api-server:test", resolveCli(workspace, "jest", "bin/jest.js"),
    ["--runInBand", "--watchman=false", ...(extra[0] === "--" ? extra.slice(1) : extra)], workspace.directory, environment);
}
function testPlan() {
  return { api: { workspace: "apps/api-server", invocations: 1 }, business: { invocations: 1, files: businessFiles() } };
}
function main(args) {
  const [action, ...tail] = args;
  const rest = tail[0] === "--" ? tail.slice(1) : tail;
  if (action === "lint" && rest.length <= 1) return lint(rest[0]);
  if (action === "test" && rest.length === 1 && rest[0] === "--list") { console.log(JSON.stringify(testPlan(), null, 2)); return 0; }
  if (action === "test" && !rest.length) {
    const environment = apiEnvironment(), plan = testPlan();
    console.log(`WORKSPACE_TEST_PLAN apiInvocations=1 businessInvocations=1 businessFiles=${plan.business.files.length}`);
    const apiCode = apiTests(environment);
    const businessCode = runBusinessTests("all", environment);
    console.log(`WORKSPACE_TEST_${apiCode || businessCode ? "FAIL" : "PASS"} apiExit=${apiCode} businessExit=${businessCode}`);
    return apiCode || businessCode ? 1 : 0;
  }
  if (action === "test:api") return apiTests(apiEnvironment(), rest);
  const scope = { "test:business": "all", "test:customer": "customer", "test:admin": "admin", "test:companion": "companion", "test:discord": "discord", "test:kook": "kook" }[action];
  if (scope && rest.length === 1 && rest[0] === "--list") { console.log(JSON.stringify(businessFiles(scope), null, 2)); return 0; }
  if (scope && !rest.length) return runBusinessTests(scope, testEnvironment());
  throw new Error("Usage: workspace-cli.cjs lint [workspace] | test [--list] | test:api [Jest options] | test:business|customer|admin|companion|discord|kook [--list]");
}
if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { workspaces, resolveCli, testEnvironment, apiEnvironment, testPlan, main };
