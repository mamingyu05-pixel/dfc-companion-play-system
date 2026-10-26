const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const crypto = require('node:crypto');
const net = require('node:net');

const root = path.resolve(__dirname, '../..');
const runtime = path.resolve(process.env.DFC_LOCAL_RUNTIME || path.join(path.parse(root).root, 'dfc-local-runtime'));
const configFile = path.join(runtime, 'runtime-private.json');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
fs.mkdirSync(runtime, { recursive: true });

function command(file, args, options = {}) {
  const result = spawnSync(file, args, { cwd: root, windowsHide: true, encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`Command failed (${result.status}): ${path.basename(file)} ${args[0] || ''}. See runtime logs.`);
  return result.stdout;
}

function config() {
  if (!fs.existsSync(configFile)) throw new Error('Run prepare first.');
  return JSON.parse(fs.readFileSync(configFile, 'utf8'));
}

function env(c, database = 'dfc_local') {
  // The local deployment uses its own database and credentials; it never inherits bot/email integrations.
  const result = { ...process.env };
  for (const key of Object.keys(result)) if (/^(DISCORD|KOOK|SMTP|WECHAT|OAUTH|PAYMENT|PAYOUT|AI_SUPPORT|OPENAI|ANTHROPIC|DEEPSEEK|DFC_ISOLATED|DFC_TEST|DFC_STORE)/.test(key)) delete result[key];
  return { ...result, NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=640',
    DATABASE_URL: `postgresql://dfc_local:${encodeURIComponent(c.pgPassword)}@127.0.0.1:${c.pgPort}/${database}?schema=public&connection_limit=4`,
    JWT_SECRET: c.jwtSecret, BOT_INTERNAL_TOKEN: c.botToken,
    ADMIN_EMAIL: 'admin@dfc.local', ADMIN_PASSWORD: c.adminPassword,
    API_HOST: '127.0.0.1', API_PORT: '18400', DOMAIN: 'localhost',
    CUSTOMER_WEB_URL: 'http://127.0.0.1:18080/customer', COMPANION_WEB_URL: 'http://127.0.0.1:18080/companion', ADMIN_WEB_URL: 'http://127.0.0.1:18080/admin',
    DFC_BACKGROUND_JOBS_ENABLED: 'false', AI_SUPPORT_ENABLED: 'false', AI_AUTO_DISPATCH_ENABLED: 'false', TRUSTED_PROXY_CIDRS: 'loopback',
    UPLOAD_DIR: path.join(runtime, 'uploads'), NEXT_TELEMETRY_DISABLED: '1', DFC_LOCAL_BUILD: '1',
    NODE_PATH: path.join(runtime, 'node_modules') };
}

function packageRoot(resolver, name) {
  try { return path.dirname(resolver.resolve(`${name}/package.json`)); } catch { /* Some exports hide package.json. */ }
  let current = path.dirname(resolver.resolve(name));
  while (current !== path.dirname(current)) {
    const file = path.join(current, 'package.json');
    if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).name === name) return current;
    current = path.dirname(current);
  }
  throw new Error(`Dependency not installed: ${name}`);
}

function assertPinnedDependency(name, required, target) {
  if (!/^\d+\.\d+\.\d+$/.test(required)) return;
  const installed = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')).version;
  if (installed !== required) throw new Error(`Dependency ${name} requires ${required}, found ${installed}. Use the frozen patched dependency workspace.`);
}

function link(target, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  let existing;
  try { existing = fs.lstatSync(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    if (!existing.isSymbolicLink()) throw new Error(`Refusing to replace non-link: ${destination}`);
    if (fs.existsSync(destination) && fs.realpathSync(destination) === fs.realpathSync(target)) return;
    fs.unlinkSync(destination);
  }
  fs.symlinkSync(target, destination, 'junction');
}

function prepare() {
  if (!process.env.DFC_DEPENDENCY_SOURCE || !process.env.DFC_PG_BIN) throw new Error('Set DFC_DEPENDENCY_SOURCE to an installed checkout and DFC_PG_BIN to PostgreSQL 16 bin.');
  const source = path.resolve(process.env.DFC_DEPENDENCY_SOURCE);
  const resolver = createRequire(path.join(source, 'apps/api-server/package.json'));
  const c = fs.existsSync(configFile) ? config() : {
    pgBin: path.resolve(process.env.DFC_PG_BIN), pgPort: 15433,
    pgPassword: crypto.randomBytes(32).toString('hex'), jwtSecret: crypto.randomBytes(48).toString('hex'),
    botToken: crypto.randomBytes(48).toString('hex'), adminPassword: crypto.randomBytes(24).toString('base64url')
  };
  c.pgBin = path.resolve(process.env.DFC_PG_BIN);
  write(configFile, c);
  const modules = path.join(runtime, 'node_modules');
  fs.mkdirSync(modules, { recursive: true });
  if (!fs.existsSync(path.join(runtime, 'package.json'))) write(path.join(runtime, 'package.json'), { name: 'dfc-local-runtime', private: true });
  const api = JSON.parse(fs.readFileSync(path.join(root, 'apps/api-server/package.json'), 'utf8'));
  for (const name of new Set([...Object.keys(api.dependencies), ...Object.keys(api.devDependencies), '@types/node'])) {
    if (name.startsWith('@dfc/') || name === '@prisma/client') continue;
    let target;
    try { target = packageRoot(resolver, name); }
    catch {
      const direct = [path.join(source, 'apps/api-server/node_modules', name), path.join(source, 'node_modules', name)]
        .find(candidate => fs.existsSync(path.join(candidate, 'package.json')));
      if (!direct) throw new Error(`Missing dependency: ${name}`);
      target = fs.realpathSync(direct);
    }
    assertPinnedDependency(name, api.dependencies[name] || api.devDependencies[name] || '', target);
    link(target, path.join(modules, name));
  }
  for (const dir of ['apps/api-server', 'packages/database', 'packages/auth', 'packages/config', 'packages/shared']) link(modules, path.join(root, dir, 'node_modules'));
  for (const name of ['auth', 'config', 'database', 'shared']) link(path.join(root, 'packages', name), path.join(modules, '@dfc', name));
  // Generate into a private directory instead of overwriting the shared dependency client's schema.
  const schema = fs.readFileSync(path.join(root, 'packages/database/prisma/schema.prisma'), 'utf8')
    .replace('provider = "prisma-client-js"', 'provider = "prisma-client-js"\n  output = "./generated-client"');
  fs.writeFileSync(path.join(runtime, 'schema.prisma'), schema);
  link(packageRoot(resolver, '@prisma/client'), path.join(modules, '@prisma/client'));
  const r = createRequire(path.join(runtime, 'package.json'));
  command(process.execPath, [r.resolve('prisma/build/index.js'), 'generate', '--schema', path.join(runtime, 'schema.prisma')], { cwd: runtime, env: { ...env(c), PRISMA_GENERATE_SKIP_AUTOINSTALL: '1' }, stdio: 'inherit' });
  link(path.join(runtime, 'generated-client'), path.join(modules, '@prisma/client'));
  for (const name of ['customer-web', 'companion-web', 'admin-web']) {
    const frontendModules = path.join(runtime, `${name}-modules`);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps', name, 'package.json'), 'utf8'));
    const frontendResolver = createRequire(process.env.DFC_WEB_DEPENDENCY_SOURCE
      ? path.join(path.resolve(process.env.DFC_WEB_DEPENDENCY_SOURCE), 'package.json')
      : path.join(source, 'apps', name, 'package.json'));
    for (const dependency of [...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)]) {
      const target = dependency === '@dfc/ui' ? path.join(root, 'packages/ui') : packageRoot(frontendResolver, dependency);
      assertPinnedDependency(dependency, manifest.dependencies[dependency] || manifest.devDependencies[dependency] || '', target);
      link(target, path.join(frontendModules, dependency));
    }
    link(frontendModules, path.join(root, 'apps', name, 'node_modules'));
    if (name === 'customer-web') link(frontendModules, path.join(root, 'packages/ui/node_modules'));
  }
  console.log('PREPARED: private runtime, shared dependency links, current Prisma client');
}

async function postgres() {
  const c = config(); const data = path.join(runtime, 'data');
  if (!fs.existsSync(path.join(data, 'PG_VERSION'))) {
    const pw = path.join(runtime, 'pg-password.tmp');
    fs.writeFileSync(pw, c.pgPassword + '\n');
    const log = fs.openSync(path.join(runtime, 'initdb.log'), 'a');
    try { command(path.join(c.pgBin, 'initdb.exe'), ['-D', data, '-U', 'dfc_local', '--pwfile', pw, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C'], { stdio: ['ignore', log, log] }); }
    finally { fs.closeSync(log); fs.unlinkSync(pw); }
    fs.appendFileSync(path.join(data, 'postgresql.conf'), `\nlisten_addresses='127.0.0.1'\nport=${c.pgPort}\nshared_buffers='32MB'\nmax_connections=20\nwork_mem='2MB'\n`);
  }
  const status = spawnSync(path.join(c.pgBin, 'pg_ctl.exe'), ['-D', data, 'status'], { windowsHide: true, stdio: 'ignore' });
  if (status.status !== 0) {
    // PostgreSQL inherits stdout on Windows; a pipe would keep spawnSync waiting after pg_ctl exits.
    const log = fs.openSync(path.join(runtime, 'pg-start.log'), 'a');
    try { command(path.join(c.pgBin, 'pg_ctl.exe'), ['-D', data, '-l', path.join(runtime, 'postgres.log'), '-w', 'start'], { stdio: ['ignore', log, log] }); }
    finally { fs.closeSync(log); }
  }
  const { PrismaClient } = require(path.join(runtime, 'generated-client'));
  const client = new PrismaClient({ datasources: { db: { url: env(c, 'postgres').DATABASE_URL } } });
  try {
    for (const database of ['dfc_local', 'dfc_synthetic']) {
      const found = await client.$queryRawUnsafe('SELECT datname FROM pg_database WHERE datname=$1', database);
      if (!found.length) await client.$executeRawUnsafe(`CREATE DATABASE ${database}`);
    }
  } finally { await client.$disconnect(); }
  console.log(`POSTGRES_READY 127.0.0.1:${c.pgPort}`);
}

function migrate(database = 'dfc_local') {
  if (!['dfc_local', 'dfc_synthetic'].includes(database)) throw new Error('Unknown local database');
  const r = createRequire(path.join(runtime, 'package.json'));
  command(process.execPath, [r.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(root, 'packages/database/prisma/schema.prisma')], { env: env(config(), database), stdio: 'inherit' });
}

function build(target = 'api-server') {
  const c = config(); const cwd = path.join(root, 'apps', target); const r = createRequire(path.join(cwd, 'package.json'));
  if (target === 'api-server') command(process.execPath, [r.resolve('@nestjs/cli/bin/nest.js'), 'build'], { cwd, env: env(c), stdio: 'inherit' });
  else if (['customer-web', 'companion-web', 'admin-web'].includes(target)) command(process.execPath, [r.resolve('next/dist/bin/next'), 'build'], { cwd, env: env(c), stdio: 'inherit' });
  else throw new Error('Unknown build target');
}

function test() {
  const cwd = path.join(root, 'apps/api-server');
  const r = createRequire(path.join(cwd, 'package.json'));
  const jest = path.join(path.dirname(r.resolve('jest/package.json')), 'bin/jest.js');
  command(process.execPath, [jest, '--runInBand', '--watchman=false', '--json', '--outputFile', path.join(runtime, 'jest-results.json')], {
    cwd, env: { ...env(config(), 'dfc_synthetic'), NODE_ENV: 'test', DFC_TEST_MODE: '1' }, stdio: 'inherit'
  });
}

async function seed() {
  const { PrismaClient } = require(path.join(runtime, 'generated-client'));
  const bcrypt = require(path.join(runtime, 'node_modules/bcryptjs'));
  const c = config(); const prisma = new PrismaClient({ datasources: { db: { url: env(c).DATABASE_URL } } });
  try {
    const passwordHash = await bcrypt.hash(c.adminPassword, 12);
    await prisma.user.upsert({ where: { email: 'admin@dfc.local' }, update: {},
      create: { email: 'admin@dfc.local', passwordHash, role: 'SUPER_ADMIN', displayName: 'DFC Local Admin', displayNameKey: 'dfc local admin', wallet: { create: {} } } });
    console.log(`DATABASE_VERIFIED users=${await prisma.user.count()} migrations=${(await prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL'))[0].count}`);
  } finally { await prisma.$disconnect(); }
}

async function start() {
  const stateFile = path.join(runtime, 'processes.json');
  if (fs.existsSync(stateFile)) {
    const old = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (old.some(item => { try { process.kill(item.pid, 0); return true; } catch { return false; } })) throw new Error('Runtime already has live process entries. Check status before restarting.');
  }
  for (const port of [18080, 18300, 18301, 18302, 18400]) {
    await new Promise((resolve, reject) => {
      const socket = net.createServer();
      socket.once('error', () => reject(new Error(`Local port already occupied: ${port}`)));
      socket.listen(port, '127.0.0.1', () => socket.close(resolve));
    });
  }
  const c = config(); const state = [];
  async function launch(name, args, cwd) {
    const log = fs.openSync(path.join(runtime, `${name}.log`), 'a');
    const child = spawn(process.execPath, args, { cwd, env: env(c), windowsHide: true, detached: true, stdio: ['ignore', log, log] });
    fs.closeSync(log);
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    state.push({ name, pid: child.pid, cwd, args, startedAt: new Date().toISOString() }); write(stateFile, state);
  }
  await launch('api-server', [path.join(root, 'apps/api-server/dist/main.js')], root);
  for (const [name, port] of [['customer-web', 18300], ['companion-web', 18301], ['admin-web', 18302]]) {
    const cwd = path.join(root, 'apps', name); const r = createRequire(path.join(cwd, 'package.json'));
    await launch(name, [r.resolve('next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(port)], cwd);
  }
  await launch('gateway', [path.join(__dirname, 'gateway.cjs')], root);
  for (let i = 0; i < 30; i++) {
    try {
      const responses = await Promise.all(['/api/health', '/customer/', '/companion/', '/admin/'].map(p => fetch('http://127.0.0.1:18080' + p, { signal: AbortSignal.timeout(1500) })));
      await Promise.all(responses.map(response => response.body?.cancel()));
      if (responses.every(response => response.ok) && state.every(item => { try { process.kill(item.pid, 0); return true; } catch { return false; } })) {
        console.log('LOCAL_READY http://127.0.0.1:18080 customer=200 companion=200 admin=200 api=200'); return;
      }
    } catch { /* Allow initial service startup. */ }
    await delay(1000);
  }
  throw new Error('Readiness failed. Check individual runtime logs.');
}

async function stop() {
  const stateFile = path.join(runtime, 'processes.json');
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : [];
  for (const item of [...state].reverse()) {
    if (!Number.isSafeInteger(item.pid) || item.pid <= 0) throw new Error('Invalid recorded process id');
    const raw = command('powershell.exe', ['-NoProfile', '-Command',
      `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); Get-CimInstance Win32_Process -Filter 'ProcessId=${item.pid}' | Select-Object Name,CommandLine,CreationDate | ConvertTo-Json -Compress`]);
    if (!raw.trim()) continue;
    const current = JSON.parse(raw);
    const normalize = value => value.replaceAll('\\', '/').toLowerCase();
    if (current.Name !== 'node.exe' || !item.args.every(arg => normalize(current.CommandLine || '').includes(normalize(arg)))) {
      throw new Error(`Process ownership does not match saved runtime entry: ${item.name}`);
    }
    process.kill(item.pid, 'SIGTERM');
  }
  await delay(500);
  if (state.length) write(stateFile, []);
  const c = config();
  const data = path.join(runtime, 'data');
  if (spawnSync(path.join(c.pgBin, 'pg_ctl.exe'), ['-D', data, 'status'], { windowsHide: true, stdio: 'ignore' }).status === 0) {
    command(path.join(c.pgBin, 'pg_ctl.exe'), ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' });
  }
  console.log('LOCAL_STOPPED: owned services and private PostgreSQL');
}

async function main() {
  const [action, target] = process.argv.slice(2);
  if (action === 'prepare') prepare();
  else if (action === 'postgres') await postgres();
  else if (action === 'migrate') migrate(target);
  else if (action === 'build') build(target);
  else if (action === 'test') test();
  else if (action === 'seed') await seed();
  else if (action === 'start') await start();
  else if (action === 'stop') await stop();
  else if (action === 'status') {
    for (const p of ['/api/health', '/api/auth/public-config', '/api/orders/public/companions', '/customer/', '/companion/', '/admin/']) {
      const response = await fetch('http://127.0.0.1:18080' + p, { signal: AbortSignal.timeout(5000) });
      await response.body?.cancel(); console.log(`${p} ${response.status}`);
    }
  } else throw new Error('Usage: node scripts/local-windows/runtime.cjs prepare|postgres|migrate|build [app]|test|seed|start|status|stop');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { root, runtime, config, env, assertPinnedDependency };
