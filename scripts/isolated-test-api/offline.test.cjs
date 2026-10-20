'use strict';
// Synthetic only: no listener, PostgreSQL, credential generation, or outbound request.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module'), assert = require('node:assert/strict');
const repo = process.env.DFC_TEST_SOURCE_ROOT || path.resolve(__dirname, '../..');
const deps = createRequire(path.join(repo, 'apps/api-server/package.json'));
const overlay = process.argv[2];
const ts = deps('typescript'), common = deps('@nestjs/common');
const source = relative => fs.readFileSync(overlay && fs.existsSync(path.join(overlay, relative)) ? path.join(overlay, relative) : path.join(repo, relative), 'utf8');
const environment = { DFC_ISOLATED_API: '1', NODE_ENV: 'test', DFC_TEST_MODE: '1', API_HOST: '127.0.0.1', API_PORT: '41001',
  DFC_BACKGROUND_JOBS_ENABLED: 'false', DFC_OUTBOUND_POLICY: 'deny', DFC_ISOLATED_DATABASE: 'dfc_test_fixture', DFC_STORE_KEY: 'TEST_fixture',
  DFC_TEST_SUBJECT: '11111111-1111-4111-8111-111111111111', JWT_SECRET: 'NON_SECRET_SYNTHETIC_CONFIGURATION_ONLY_'.repeat(2),
  DATABASE_URL: 'postgresql://dfc_test_fixture:NON_SECRET_FIXTURE@127.0.0.1:41002/dfc_test_fixture?connection_limit=1&pool_timeout=5' };
const cache = new Map(), fakeProcess = { env: { ...environment } };
function load(relative) {
  if (cache.has(relative)) return cache.get(relative);
  const exports = {}; cache.set(relative, exports);
  const output = ts.transpileModule(source(relative), { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS, experimentalDecorators: true, esModuleInterop: true }, fileName: relative });
  assert.equal((output.diagnostics || []).length, 0);
  function local(name) {
    if (name.endsWith('/prisma/prisma.service')) return { PrismaService: class {} };
    if (name.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(relative), name + '.ts')));
    return deps(name);
  }
  vm.runInNewContext(output.outputText, { exports, require: local, process: fakeProcess, URL, Error, globalThis }, { filename: relative });
  return exports;
}
const runtime = load('apps/api-server/src/isolated-test-runtime.ts');
const network = load('apps/api-server/src/isolated-test-network.ts');
const config = runtime.isolatedTestConfig(environment);
const claims = { sub: config.subject, role: 'CUSTOMER', iss: config.issuer, aud: config.audience,
  testEnvironment: 'isolated-test', testDatabase: config.database, testStore: config.storeKey };
const cases = [];
async function test(name, fn) { await fn(); cases.push(name); console.log('PASS ' + name); }
(async () => {
  await test('Live default stays off; complete explicit TEST configuration is immutable', () => {
    assert.equal(runtime.isolatedTestConfig({}), null);
    assert.equal(runtime.isolatedTestConfig({ DFC_ISOLATED_API: '0' }), null);
    assert(Object.isFrozen(config)); assert.equal(config.host, '127.0.0.1');
  });
  await test('Missing binding, identity, outbound policy, unsafe database and inherited integration settings fail closed without values in errors', () => {
    for (const key of Object.keys(environment)) {
      const invalid = { ...environment }; delete invalid[key];
      assert.throws(() => runtime.isolatedTestConfig(invalid), /configuration rejected/);
    }
    for (const [key, value] of Object.entries({ DFC_ISOLATED_API: 'yes', NODE_ENV: 'production', API_HOST: '0.0.0.0', API_PORT: '65536',
      DFC_BACKGROUND_JOBS_ENABLED: 'true', DFC_OUTBOUND_POLICY: 'allow', DFC_TEST_SUBJECT: 'real-customer',
      DFC_ISOLATED_DATABASE: 'production', DFC_STORE_KEY: 'MAIN', KOOK_TOKEN: 'DO_NOT_LOG_SENTINEL',
      HTTP_PROXY: 'http://example.invalid', DATABASE_URL: environment.DATABASE_URL.replace('127.0.0.1', 'example.invalid') })) {
      assert.throws(() => runtime.isolatedTestConfig({ ...environment, [key]: value }), error =>
        /configuration rejected/.test(error.message) && !error.message.includes(value) && !error.message.includes('SENTINEL'));
    }
    for (const suffix of ['&host=example.invalid', '&sslmode=require', '#fragment']) {
      assert.throws(() => runtime.isolatedTestConfig({ ...environment, DATABASE_URL: environment.DATABASE_URL + suffix }));
    }
  });
  await test('Token scope binds customer, database, store, issuer and audience', () => {
    assert(runtime.isolatedClaimsMatch(claims, config));
    for (const key of Object.keys(claims)) assert.equal(runtime.isolatedClaimsMatch({ ...claims, [key]: 'wrong' }, config), false);
    assert.equal(runtime.isolatedClaimsMatch(null, config), false);
  });
  await test('Only the native TEST flow routes are reachable; login, callbacks, messages and encoded routes are refused', () => {
    for (const [method, route] of [['GET', '/api/orders/environment'], ['GET', '/api/wallet/customer-summary'], ['POST', '/api/orders/preview'], ['POST', '/api/orders'], ['GET', '/api/orders/requests/mini-test-123456789']]) assert(runtime.isolatedRouteAllowed(method, route));
    for (const [method, route] of [['POST', '/api/auth/login'], ['POST', '/api/kook/webhook'], ['POST', '/api/wallet/recharge-requests'], ['PATCH', '/api/orders/1/accept'], ['GET', '/api/orders/%65nvironment']]) assert.equal(runtime.isolatedRouteAllowed(method, route), false);
  });
  await test('Transport destination validation rejects public hosts, named pipes, PG-over-HTTP and URL-option overrides', () => {
    assert(network.isolatedSocketAllowed([{ host: '127.0.0.1', port: 41002 }], config));
    assert(network.isolatedSocketAllowed([41001, '127.0.0.1'], config));
    for (const args of [[{ host: 'example.invalid', port: 41002 }], [{ path: '\\\\.\\pipe\\other' }], [41001], [{ host: '127.0.0.1', port: 443 }]]) assert.equal(network.isolatedSocketAllowed(args, config), false);
    assert(network.isolatedHttpAllowed(['http://127.0.0.1:41001/api/orders'], config));
    for (const args of [['https://127.0.0.1:41001'], ['http://127.0.0.1:41002'], ['http://127.0.0.1:41001', { hostname: 'example.invalid' }], [{ hostname: '127.0.0.1', port: 41001, socketPath: 'pipe' }]]) assert.equal(network.isolatedHttpAllowed(args, config), false);
  });
  await test('Installed transport hooks block before touching synthetic transports and restore exactly', () => {
    let calls = 0; const transport = () => { calls++; return 'synthetic'; };
    const modules = { http: { request: transport, get: transport }, https: { request: transport, get: transport },
      socket: { connect: transport }, tls: { connect: transport }, dns: { lookup: transport, resolve4: transport },
      dnsPromises: { lookup: transport }, dgram: { createSocket: transport }, global: { fetch: transport }, sync() {} };
    const restore = network.installIsolatedNetwork(config, modules);
    for (const fn of [() => modules.http.request('http://example.invalid'), () => modules.https.get('https://example.invalid'),
      () => modules.socket.connect({ host: 'example.invalid', port: 80 }), () => modules.tls.connect({}),
      () => modules.dns.lookup('example.invalid'), () => modules.dnsPromises.lookup('example.invalid'),
      () => modules.dgram.createSocket('udp4'), () => modules.global.fetch('http://127.0.0.1:41001')]) assert.throws(fn, /outbound transport blocked/);
    assert.equal(calls, 0); modules.http.request('http://127.0.0.1:41001/api/orders'); assert.equal(calls, 1);
    restore(); assert.equal(modules.http.request, transport); assert.equal(modules.socket.connect, transport); assert.equal(modules.global.fetch, transport);
  });
  await test('Actual JWT guard enforces signed scope before DB lookup, and refuses non-synthetic or non-customer rows', async () => {
    const { JwtAuthGuard } = load('apps/api-server/src/modules/auth/jwt-auth.guard.ts');
    let payload = claims, lookups = 0, verifyOptions, row = { id: config.subject, email: 'test@synthetic.invalid', role: 'CUSTOMER', status: 'ACTIVE' };
    const guard = new JwtAuthGuard({ async verifyAsync(_token, options) { verifyOptions = options; return payload; } },
      { user: { async findUnique() { lookups++; return row; } } });
    const request = { header: () => 'Bearer NON_SECRET_MOCK_TOKEN' }, context = { switchToHttp: () => ({ getRequest: () => request }) };
    assert(await guard.canActivate(context)); assert.equal(verifyOptions.issuer, config.issuer); assert.equal(verifyOptions.algorithms[0], 'HS256');
    payload = { ...claims, testDatabase: 'dfc_test_wrong' };
    await assert.rejects(guard.canActivate(context), common.UnauthorizedException); assert.equal(lookups, 1);
    payload = claims;
    for (const changed of [{ email: 'real@example.invalid' }, { role: 'ADMIN' }, { status: 'BANNED' }, { id: 'someone-else' }]) {
      const original = row; row = { ...row, ...changed }; await assert.rejects(guard.canActivate(context), common.UnauthorizedException); row = original;
    }
  });

  await test('PostgreSQL inet text includes masks: normalize in SQL, retain exact DB/host boundary and redact diagnostics', async () => {
    const { orderEnvironment, inspectIsolatedDatabaseIdentity } = load('apps/api-server/src/modules/orders/order-environment.ts');
    // PostgreSQL 16 documented display semantics only; this is not an executed SQL test.
    // https://www.postgresql.org/docs/16/functions-net.html (text(inet), host(inet)).
    function fixture(database, inet, forceAddress) {
      return { async $queryRaw(parts) {
        const sql = parts.join('?');
        const normalized = /host\s*\(\s*inet_server_addr\s*\(\s*\)\s*\)\s+AS\s+"address"/i.test(sql);
        const address = forceAddress !== undefined ? forceAddress : normalized && typeof inet === 'string' ? inet.replace(/\/\d+$/, '') : inet;
        return [{ database, address, rawAddress: inet }];
      } };
    }
    for (const inet of ['127.0.0.1/32', '::1/128']) {
      const db = fixture(config.database, inet);
      const value = await orderEnvironment(db, 'isolated-test', environment);
      assert.equal(value.environment, 'isolated-test'); assert.equal(value.isTest, true); assert.equal(value.storeKey, config.storeKey);
      const diagnosis = await inspectIsolatedDatabaseIdentity(db, config.database);
      assert.equal(diagnosis.accepted, true); assert.equal(diagnosis.databaseMatches, true);
      assert.match(diagnosis.rawHostClass, /_WITH_MASK$/); assert.match(diagnosis.hostClass, /^LOOPBACK_/);
      assert(!JSON.stringify(diagnosis).includes(config.database)); assert(!JSON.stringify(diagnosis).includes(inet));
    }
    for (const [database, inet, address] of [
      ['dfc_test_other', '127.0.0.1/32'], ['production', '127.0.0.1/32'],
      [config.database, '203.0.113.9/32'], [config.database, null],
      [config.database, '127.0.0.1/32', '127.0.0.1/32'], [config.database, '127.0.0.1.evil/32'],
      [config.database, '::ffff:127.0.0.1/128']
    ]) {
      await assert.rejects(orderEnvironment(fixture(database, inet, address), 'isolated-test', environment), error => {
        assert.equal(error.getStatus(), 400);
        const response = error.getResponse(); assert.equal(response.code, 'ISOLATED_DATABASE_REJECTED');
        assert.equal(response.isolation.accepted, false);
        const serialized = JSON.stringify(response.isolation);
        assert(!serialized.includes(database)); if (inet) assert(!serialized.includes(inet));
        return true;
      });
    }
    for (const rows of [[], [{ database: config.database, address: '127.0.0.1' }, { database: config.database, address: '127.0.0.1' }]]) {
      await assert.rejects(orderEnvironment({ $queryRaw: async () => rows }, 'isolated-test', environment));
    }
  });

  await test('Node listen literal lookup stays local; external DNS, mapped aliases and non-loopback transports remain denied', async () => {
    const net = require('node:net'), dns = require('node:dns');
    const originalListen = net.Server.prototype._listen2;
    const originalLookup = dns.lookup, originalPromiseLookup = dns.promises.lookup;
    const originalResolve = dns.resolve4, originalPromiseResolve = dns.promises.resolve4;
    const delegated = [], bindings = [];
    // Spy only the literal-IP fast path. Refuse unexpected inputs before native DNS.
    function exactLiteral(host) { assert(['127.0.0.1', '::1'].includes(host)); delegated.push(host); }
    dns.lookup = function(host, ...args) { exactLiteral(host); return originalLookup.call(this, host, ...args); };
    dns.promises.lookup = function(host, ...args) { exactLiteral(host); return originalPromiseLookup.call(this, host, ...args); };
    // This seam is before the OS handle allocation; the actual net.Server.listen lookup path still runs.
    net.Server.prototype._listen2 = function(address, port, family) {
      assert.equal(this._handle, null); bindings.push({ address, port, family });
      process.nextTick(() => this.emit('listening'));
    };
    const unused = () => assert.fail('No transport may run in this synthetic test');
    const modules = { http: { request: unused, get: unused }, https: { request: unused, get: unused },
      socket: { connect: unused }, tls: { connect: unused }, dns, dnsPromises: dns.promises,
      dgram: { createSocket: unused }, global: { fetch: unused }, sync() {} };
    let restore;
    try {
      restore = network.installIsolatedNetwork(config, modules);
      for (const [host, family] of [['127.0.0.1', 4], ['::1', 6]]) {
        const server = net.createServer();
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, host, resolve); });
        assert.equal(server.listening, false); assert.equal(server.address(), null);
        assert.deepEqual(bindings.at(-1), { address: host, port: config.port, family });
        const value = await new Promise((resolve, reject) => dns.lookup(host, (error, address, actualFamily) => error ? reject(error) : resolve({ address, family: actualFamily })));
        assert.deepEqual(value, { address: host, family });
        assert.deepEqual(await dns.promises.lookup(host), { address: host, family });
        assert.deepEqual(await dns.promises.lookup(host, { all: true }), [{ address: host, family }]);
      }
      const delegatedBeforeDenials = delegated.length;
      const denied = ['example.invalid', 'localhost', '203.0.113.9', '192.168.1.5', '0.0.0.0', '127.0.0.2',
        '::', '::ffff:127.0.0.1', '::ffff:7f00:1', '127.1', '2130706433', '0177.0.0.1', '0x7f000001',
        '127.0.0.1.', ' 127.0.0.1', '[::1]', '', null, { toString: () => '127.0.0.1' }];
      for (const host of denied) {
        assert.throws(() => dns.lookup(host, () => {}), /outbound transport blocked/);
        assert.throws(() => dns.promises.lookup(host), /outbound transport blocked/);
        assert.equal(network.isolatedSocketAllowed([{ host, port: config.port }], config), false);
        if (typeof host === 'string' && host) assert.throws(() => net.createServer().listen(config.port, host), /outbound transport blocked/);
      }
      for (const target of [dns, dns.promises, new dns.Resolver(), new dns.promises.Resolver()]) {
        assert.throws(() => target.resolve4('127.0.0.1', () => {}), /outbound transport blocked/);
        assert.throws(() => target.reverse('127.0.0.1', () => {}), /outbound transport blocked/);
      }
      assert.throws(() => dns.lookupService('127.0.0.1', config.port, () => {}), /outbound transport blocked/);
      assert.throws(() => dns.promises.lookupService('::1', config.port), /outbound transport blocked/);
      assert.equal(network.isolatedSocketAllowed([{ host: '::1', port: config.port }], config), false);
      assert.equal(delegated.length, delegatedBeforeDenials); assert.equal(bindings.length, 2);
    } finally {
      if (restore) restore();
      net.Server.prototype._listen2 = originalListen;
      dns.lookup = originalLookup; dns.promises.lookup = originalPromiseLookup;
    }
    assert.equal(dns.resolve4, originalResolve); assert.equal(dns.promises.resolve4, originalPromiseResolve);
  });

  console.log(JSON.stringify({ success: true, tests: cases.length, passed: cases.length, networkRequests: 0, pgStarted: false, listenersStarted: 0, credentialsGenerated: false }));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
