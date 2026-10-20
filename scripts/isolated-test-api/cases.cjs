'use strict';
// Runs only inside guard.py's approved, owned Job and fresh PostgreSQL cluster.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const http = require('node:http'), { createRequire } = require('node:module'), { randomUUID } = require('node:crypto');

module.exports = async function({ load, prisma, second, test, result, check, manifest, isolation, registerCleanup, interactive }) {
  const deps = createRequire(path.join(manifest.root, 'apps/api-server/package.json'));
  deps('reflect-metadata');
  const { Module } = deps('@nestjs/common'), { NestFactory, Reflector } = deps('@nestjs/core'), { JwtService } = deps('@nestjs/jwt');
  const { OrdersController } = load('apps/api-server/src/modules/orders/orders.controller.ts');
  const { OrdersService } = load('apps/api-server/src/modules/orders/orders.service.ts');
  const { OrderDraftsService } = load('apps/api-server/src/modules/orders/order-drafts.service.ts');
  const { WalletController } = load('apps/api-server/src/modules/wallet/wallet.controller.ts');
  const { WalletService } = load('apps/api-server/src/modules/wallet/wallet.service.ts');
  const { JwtAuthGuard } = load('apps/api-server/src/modules/auth/jwt-auth.guard.ts');
  const { RolesGuard } = load('apps/api-server/src/modules/auth/roles.guard.ts');
  const { PrismaService } = load('apps/api-server/src/modules/prisma/prisma.service.ts');
  const { isolatedHttpBoundary } = load('apps/api-server/src/isolated-test-runtime.ts');
  const { orderEnvironment, inspectIsolatedDatabaseIdentity } = load('apps/api-server/src/modules/orders/order-environment.ts');
  result.isolatedDatabaseIdentity = await inspectIsolatedDatabaseIdentity(prisma, isolation.database);
  await orderEnvironment(prisma); // Verify before even synthetic identity fixtures are written.
  let notificationCalls = 0;
  const forbidden = new Proxy({}, { get(_target, key) {
    if (key === 'then' || /^on(Module|Application)|^beforeApplication/.test(String(key))) return undefined;
    return () => { notificationCalls++; throw Error('External service prohibited in this isolated test'); };
  } });
  const orders = new OrdersService(prisma, forbidden), wallet = new WalletService(prisma, forbidden), jwt = new JwtService();
  const customer = await prisma.user.create({ data: { id: isolation.subject, email: isolation.subject + '@synthetic.invalid',
    displayName: 'Synthetic TEST customer', displayNameKey: isolation.subject, passwordHash: 'UNUSABLE_SYNTHETIC_NO_LOGIN',
    role: 'CUSTOMER', status: 'ACTIVE', wallet: { create: { availableBalance: '1000' } } } });
  const companionId = randomUUID();
  await prisma.user.create({ data: { id: companionId, email: companionId + '@synthetic.invalid', displayName: 'Synthetic TEST companion',
    displayNameKey: companionId, passwordHash: 'UNUSABLE_SYNTHETIC_NO_LOGIN', role: 'COMPANION', status: 'ACTIVE', wallet: { create: {} },
    companionProfile: { create: { nickname: 'TEST companion', game: 'DELTA_FORCE', games: ['DELTA_FORCE'], skillModes: ['烽火地带'],
      pricePerHour: '50', entertainmentPricePerHour: '50', commissionRate: '0.2', status: 'LISTED', onlineStatus: 'ONLINE' } } } });
  const scope = { sub: customer.id, email: customer.email, role: 'CUSTOMER', testEnvironment: 'isolated-test',
    testDatabase: isolation.database, testStore: isolation.storeKey };
  const sign = (payload, expiresIn = 120) => jwt.signAsync(payload, { secret: process.env.JWT_SECRET, algorithm: 'HS256', issuer: isolation.issuer,
    audience: isolation.audience, expiresIn });
  let token = interactive ? undefined : await sign(scope);
  registerCleanup(async () => { token = undefined; });
  // Explicit providers retain the real controllers, JWT/role guards and transaction services.
  class TestApiModule {}
  Module({ controllers: [OrdersController, WalletController], providers: [
    { provide: OrdersService, useValue: orders }, { provide: OrderDraftsService, useValue: forbidden },
    { provide: WalletService, useValue: wallet }, { provide: PrismaService, useValue: prisma },
    { provide: JwtService, useValue: jwt }, { provide: JwtAuthGuard, useValue: new JwtAuthGuard(jwt, prisma) },
    { provide: RolesGuard, useValue: new RolesGuard(new Reflector()) }
  ] })(TestApiModule);
  const app = await NestFactory.create(TestApiModule, { logger: false, abortOnError: false });
  registerCleanup(async () => { app.getHttpServer().closeAllConnections?.(); await app.close(); });
  const session = interactive ? require('./interactive.cjs').createInteractiveSession({ isolation, seconds: interactive.seconds,
    workDeadline: interactive.workDeadline, cancelled: interactive.cancelled, sign: seconds => sign(scope, seconds) }) : null;
  if (session) {
    registerCleanup(async () => session.stop('cleanup'));
    app.use((req, res, next) => { session.middleware(req, res, next).catch(() => {
      session.stop('request-failed'); res.status(503).json({ message: 'TEST session request failed' });
    }); });
    interactive.setCommandHandler(line => session.command(line));
  }
  app.use(isolatedHttpBoundary); app.setGlobalPrefix('api');
  await app.listen(isolation.port, isolation.host);
  assert.equal(app.getHttpServer().address().address, '127.0.0.1');
  result.httpStarted = true; result.apiAddress = { host: isolation.host, port: isolation.port }; result.businessLogin = false;
  if (session) {
    result.interactive = await session.wait({ cancelled: interactive.cancelled, onState: interactive.onState });
    assert.equal(await second.notificationDelivery.count(), 0); assert.equal(notificationCalls, 0);
    result.interactive.notificationCalls = notificationCalls;
    result.interactive.persistedTestOrders = await second.order.count({ where: { customerId: customer.id, isTest: true, storeKey: isolation.storeKey } });
    return;
  }
  const baseUrl = `http://${isolation.host}:${isolation.port}/api`, exchanges = [], posts = [], storage = new Map();
  let dropNextReceipt = false, modalTask = Promise.resolve(), beforeConfirm;
  async function request(method, route, body, bearer = token) {
    check();
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : JSON.stringify(body);
      const req = http.request({ hostname: isolation.host, port: isolation.port, path: '/api' + route, method, agent: false,
        headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}),
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
        let text = '';
        res.on('data', chunk => { text += chunk; if (text.length > 1024 * 1024) req.destroy(Error('Response too large')); });
        res.on('end', () => {
          try { exchanges.push({ method, route, status: res.statusCode }); resolve({ statusCode: res.statusCode, data: JSON.parse(text) }); }
          catch (error) { reject(error); }
        });
        res.on('error', reject);
      });
      req.once('error', reject); req.setTimeout(5000, () => req.destroy(Error('Loopback request timeout'))); req.end(data);
    });
  }
  const wx = {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, structuredClone(value)), removeStorageSync: key => storage.delete(key),
    request(options) {
      assert(options.url.startsWith(baseUrl + '/'));
      assert.equal(options.header.Authorization, 'Bearer ' + token);
      const route = options.url.slice(baseUrl.length);
      if (options.method === 'POST' && route === '/orders') posts.push(structuredClone(options.data));
      request(options.method, route, options.data).then(response => {
        if (dropNextReceipt && route === '/orders' && response.statusCode < 300) { dropNextReceipt = false; options.fail({ errMsg: 'SYNTHETIC_LOST_RESPONSE_AFTER_COMMIT' }); }
        else options.success(response);
      }, () => options.fail({ errMsg: 'Isolated HTTP failed' }));
    },
    showModal(options) {
      assert.match(options.content, /仅使用隔离测试账本/);
      modalTask = Promise.resolve().then(async () => { if (beforeConfirm) { const run = beforeConfirm; beforeConfirm = undefined; await run(); } await options.success({ confirm: true }); });
    }
  };
  const originalPage = path.join(manifest.nativeRoot, 'pages/demo/index.js');
  const nativeRequire = createRequire(originalPage);
  async function page() {
    let current;
    vm.runInNewContext(fs.readFileSync(originalPage, 'utf8'), {
      Page(value) { current = value; }, wx, getApp: () => ({ globalData: { testApiSession: { subject: customer.id, accessToken: token } } }),
      require(name) { return name === '../../api-config.js' ? Object.freeze({ mode: 'isolated-api', environment: 'isolated-test', baseUrl }) : nativeRequire(name); }
    }, { filename: originalPage });
    current.data = structuredClone(current.data); current.setData = values => Object.assign(current.data, values);
    current.onLoad();
    const deadline = Date.now() + 8000;
    while (current.data.busy && Date.now() < deadline) { check(); await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.equal(current.data.busy, false); assert.equal(current.data.message, ''); assert.equal(current.data.simulation, false);
    assert.equal(current.data.selectedId, companionId);
    return current;
  }
  async function pay(current) { await current.pay(); await modalTask; check(); }
  async function persisted(count, frozen) {
    const list = await second.order.findMany({ where: { customerId: customer.id } });
    assert.equal(list.length, count); assert(list.every(row => row.isTest && row.storeKey === isolation.storeKey));
    const row = await second.wallet.findUniqueOrThrow({ where: { userId: customer.id } });
    assert.equal(row.frozenBalance.toString(), String(frozen)); assert.equal(row.availableBalance.toString(), String(1000 - frozen));
    assert.equal(await second.walletTransaction.count({ where: { userId: customer.id, type: 'ORDER_PAYMENT' } }), count);
    assert.equal(await second.notificationDelivery.count(), 0); assert.equal(notificationCalls, 0);
    return list;
  }
  await test('API1 actual HTTP rejects missing/wrong TEST identities and non-flow routes before writes', async () => {
    assert.equal((await request('GET', '/orders/environment', undefined, '')).statusCode, 401);
    const wrong = await sign({ ...scope, testStore: 'TEST_other' });
    assert.equal((await request('GET', '/orders/environment', undefined, wrong)).statusCode, 401);
    assert.equal((await request('POST', '/auth/login', {})).statusCode, 403);
    assert.equal((await request('POST', '/wallet/recharge-requests', {})).statusCode, 403);
    const env = await request('GET', '/orders/environment'); assert.equal(env.statusCode, 200); assert.equal(env.data.storeKey, isolation.storeKey);
    await persisted(0, 0);
  });
  await test('API2 original native Page confirmation -> HTTP controllers/guards -> one persisted TEST order and wallet freeze', async () => {
    const current = await page(); await pay(current);
    assert.equal(current.data.message, ''); assert(current.data.receipt?.id); assert.equal(current.data.receipt.isTest, true);
    const rows = await persisted(1, 50); assert.equal(current.data.receipt.id, rows[0].id);
    await current.refresh(); assert.equal(current.data.store.orders.length, 1); current.onUnload();
  });
  await test('API3 lost HTTP receipt survives native page recreation; same request replay does not debit twice', async () => {
    const current = await page(); dropNextReceipt = true; await pay(current); assert.equal(current.data.pending, true); current.onUnload();
    await persisted(2, 100); assert.equal(storage.size, 1); assert(!JSON.stringify([...storage.values()]).includes(token));
    const replayBody = posts.at(-1), recovered = await page(); assert(recovered.data.receipt?.id); assert.equal(recovered.data.pending, false); assert.equal(storage.size, 0);
    const replay = await request('POST', '/orders', replayBody); assert.equal(replay.statusCode, 201); assert.equal(replay.data.id, recovered.data.receipt.id);
    await persisted(2, 100); recovered.onUnload();
  });
  await test('API4 quote changes before confirmation refuse without a new order or freeze; outbound effects remain absent', async () => {
    const current = await page(); beforeConfirm = () => prisma.companionProfile.update({ where: { userId: companionId }, data: { pricePerHour: '60', entertainmentPricePerHour: '60' } });
    await pay(current); assert.match(current.data.message, /价格已变化/); assert.equal(current.data.pending, false);
    await persisted(2, 100); current.onUnload();
    assert.throws(() => require('node:https').request('https://example.invalid'), /outbound transport blocked/);
    assert.throws(() => globalThis.fetch('https://example.invalid'), /outbound transport blocked/);
  });
  result.nativeEvidence = { page: 'apps/miniapp-native/pages/demo/index.js', originalClient: true, realHttp: true, actualJwtGuard: true,
    actualControllersAndServices: true, independentDatabaseReader: true, committedOrders: 2, walletFreezes: 2, notificationCalls,
    realWxRuntime: false, wechatLogin: false, realPayment: false, tokenPersisted: false, isolatedClaimsVerified: true, exchanges };
};
