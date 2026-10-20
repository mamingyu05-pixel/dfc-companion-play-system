'use strict';
// Bounded in-memory tests: no listener, PG, credential generation, IDE or network.
const assert = require('node:assert/strict'), path = require('node:path');
const { createInteractiveSession } = require('./interactive.cjs');
const { createTestSession } = require('../../apps/miniapp-native/test-session.js');
const subject = '11111111-1111-4111-8111-111111111111', requestId = '22222222-2222-4222-8222-222222222222';
const isolation = { host: '127.0.0.1', port: 41001, database: 'dfc_test_fixture', storeKey: 'TEST_fixture', subject };
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
function fixture(overrides = {}) {
  let time = 100000, signed = 0;
  const session = createInteractiveSession({ isolation, seconds: 60, workDeadline: 200000, now: () => time,
    newId: () => requestId, newCode: () => '123456', sign: async seconds => { signed++; assert(seconds > 0 && seconds <= 60); return 'NON_SECRET_FIXTURE_TOKEN'; }, ...overrides });
  async function call(url, changes = {}) {
    let status, body, next = false;
    await session.middleware({ method: 'POST', url, socket: { remoteAddress: '127.0.0.1' },
      headers: { host: '127.0.0.1:41001', 'x-dfc-test-session': '1' }, ...changes },
    { status(value) { status = value; return this; }, json(value) { body = value; } }, () => { next = true; });
    return { status, body, next };
  }
  return { session, call, advance(ms) { time += ms; }, get time() { return time; }, get signed() { return signed; } };
}
(async () => {
  await test('Reject unsafe host/scope/duration and insufficient remaining resource window', () => {
    for (const change of [{ seconds: 0 }, { seconds: 91 }, { seconds: 15.5 }, { workDeadline: 110000 }, { cancelled: true },
      { isolation: { ...isolation, host: '0.0.0.0' } }, { isolation: { ...isolation, storeKey: 'PRODUCTION' } },
      { isolation: { ...isolation, subject: 'real-customer' } }]) assert.throws(() => fixture(change), /rejected|Insufficient/);
  });
  await test('Session route rejects external/mapped peers, host overrides and browser-simple requests', async () => {
    const f = fixture();
    for (const changes of [{ method: 'GET' }, { socket: { remoteAddress: '::ffff:127.0.0.1' } }, { socket: { remoteAddress: '192.168.1.5' } },
      { headers: { host: 'localhost:41001', 'x-dfc-test-session': '1' } }, { headers: { host: '127.0.0.1:41001' } }]) {
      assert.equal((await f.call('/api/test-session/request', changes)).status, 403);
    }
    assert.equal((await f.call('/api/test-session/request?extra=1')).status, 403);
    assert.equal((await f.call('/api/orders/environment')).next, true); assert.equal(f.signed, 0);
  });
  await test('Only explicit matching operator approval issues one scoped temporary session', async () => {
    const f = fixture(), begin = await f.call('/api/test-session/request'); assert.equal(begin.status, 202);
    assert.equal((await f.call('/api/test-session/claim/' + requestId)).status, 202); assert.equal(f.signed, 0);
    assert.equal(f.session.command('APPROVE 111111'), false); assert.equal(f.session.command('APPROVE 123456'), true);
    const grant = await f.call('/api/test-session/claim/' + requestId);
    assert.equal(grant.status, 200); assert.equal(grant.body.subject, subject); assert.equal(grant.body.storeKey, isolation.storeKey);
    assert.equal(grant.body.realWxLogin, false); assert.equal(f.signed, 1);
    assert.equal((await f.call('/api/test-session/claim/' + requestId)).status, 404);
    assert.equal((await f.call('/api/test-session/request')).status, 409);
    const state = JSON.stringify(f.session.info()); for (const secret of ['123456', requestId, 'NON_SECRET_FIXTURE_TOKEN', subject]) assert(!state.includes(secret));
  });
  await test('Concurrent claims are consumed before signing; stop during signing releases no token', async () => {
    let finish; const f = fixture({ sign: () => new Promise(resolve => { finish = resolve; }) });
    await f.call('/api/test-session/request'); f.session.command('APPROVE 123456');
    const first = f.call('/api/test-session/claim/' + requestId);
    assert.equal((await f.call('/api/test-session/claim/' + requestId)).status, 404);
    f.session.command('STOP'); finish('NON_SECRET_FIXTURE_TOKEN');
    const response = await first; assert.equal(response.status, 410); assert(!response.body.accessToken);
  });
  await test('Expired requests, wrong-code budget and bounded request quota fail closed', async () => {
    let f = fixture(); await f.call('/api/test-session/request'); f.advance(30001);
    assert.equal(f.session.command('APPROVE 123456'), false); assert.equal((await f.call('/api/test-session/claim/' + requestId)).status, 410);
    f = fixture(); await f.call('/api/test-session/request'); for (let i = 0; i < 3; i++) f.session.command('APPROVE 000000');
    assert.equal(f.session.info().stopReason, 'approval-attempt-limit'); assert.equal((await f.call('/api/test-session/request')).status, 410);
    f = fixture({ seconds: 90, workDeadline: 250000 });
    for (let i = 0; i < 3; i++) { assert.equal((await f.call('/api/test-session/request')).status, 202); f.advance(10001);
      // Expire this request while retaining enough overall time for the quota check.
      if (i < 2) f.advance(20000);
    }
    f.advance(20000); assert.equal((await f.call('/api/test-session/request')).status, 410); // Overall bound wins.
  });
  await test('Deadline, operator and guardian cancellation stop the wait without a real timer or listener', async () => {
    for (const mode of ['deadline', 'operator', 'guard-stop']) {
      const f = fixture(); let steps = 0;
      const state = await f.session.wait({ cancelled: () => mode === 'guard-stop' && steps > 0,
        pause: async () => { steps++; if (mode === 'operator') f.session.command('STOP'); else f.advance(10000); } });
      assert.equal(state.stage, 'stopped'); assert.equal(state.stopReason, mode); assert(steps <= 6);
    }
  });
  await test('Active TEST business requests still reach downstream guards without consuming pairing', async () => {
    const f = fixture();
    for (const [method, route] of [['POST', '/api/orders'], ['POST', '/api/orders/preview'], ['GET', '/api/orders/environment']]) {
      const response = await f.call(route, { method });
      assert.equal(response.next, true); assert.equal(response.status, undefined);
    }
    assert.equal(f.signed, 0); assert.equal(f.session.info().requested, 0);
    // Passing this middleware is not authentication or a persisted business write.
  });
  await test('STOP rejects all new TEST routes and repeats even with a previously granted session', async () => {
    const f = fixture(); await f.call('/api/test-session/request'); f.session.command('APPROVE 123456');
    const grant = await f.call('/api/test-session/claim/' + requestId); assert.equal(grant.status, 200);
    const changes = { headers: { host: '127.0.0.1:41001', authorization: 'Bearer ' + grant.body.accessToken, 'x-dfc-test-session': '1' } };
    assert.equal((await f.call('/api/orders', changes)).next, true);
    f.session.command('STOP');
    for (const route of ['/api/orders', '/api/orders', '/api/orders/preview', '/api/orders?retry=1', '/api/orders/environment',
      '/api/test-session/request', '/api/test-session/claim/' + requestId]) {
      const response = await f.call(route, { ...changes, method: route.endsWith('/environment') ? 'GET' : 'POST' });
      assert.equal(response.status, 410); assert.equal(response.next, false); assert(!response.body.accessToken);
    }
    assert.equal(f.session.command('APPROVE 123456'), false); f.session.command('STOP');
    assert.equal(f.session.info().stopReason, 'operator'); assert.equal(f.signed, 1);
  });
  await test('EOF or guardian cancellation closes admission before the wait poll and stays latched', async () => {
    // runner exposes EOF/controlStopped and stop-request.json through this same predicate.
    // This is an in-memory cancellation fixture, not an actual stdin/guardian run.
    for (const granted of [false, true]) {
      let cancelled = false;
      const f = fixture({ cancelled: () => cancelled });
      await f.call('/api/test-session/request');
      if (granted) { f.session.command('APPROVE 123456'); assert.equal((await f.call('/api/test-session/claim/' + requestId)).status, 200); }
      cancelled = true; // No wait(), timer or command delivery before the business request.
      const stopped = await f.call('/api/orders'); assert.equal(stopped.status, 410); assert.equal(stopped.next, false);
      cancelled = false; // Clearing the external signal must not reopen the same window.
      for (const route of ['/api/orders', '/api/orders', '/api/test-session/request', '/api/test-session/claim/' + requestId]) {
        const response = await f.call(route); assert.equal(response.status, 410); assert.equal(response.next, false);
      }
      assert.equal(f.session.command('APPROVE 123456'), false);
      const state = await f.session.wait({ cancelled: () => false, pause: async () => assert.fail('Stopped window must not wait') });
      assert.equal(state.stopReason, 'guard-stop'); assert.equal(f.signed, granted ? 1 : 0);
    }
  });
  await test('Exact session and guarded deadlines close business admission without a timer tick', async () => {
    for (const [options, duration] of [[{}, 60000], [{ workDeadline: 147000 }, 45000]]) {
      const f = fixture(options); await f.call('/api/test-session/request'); f.session.command('APPROVE 123456');
      assert.equal((await f.call('/api/test-session/claim/' + requestId)).status, 200);
      f.advance(duration - 1); assert.equal((await f.call('/api/orders')).next, true);
      f.advance(1);
      for (const route of ['/api/orders', '/api/orders', '/api/test-session/request', '/api/test-session/claim/' + requestId]) {
        const response = await f.call(route); assert.equal(response.status, 410); assert.equal(response.next, false);
      }
      assert.equal(f.session.info().stopReason, 'deadline'); assert.equal(f.signed, 1);
    }
  });
  await test('Cancellation or expiry during signing never releases the grant or reopens business routes', async () => {
    for (const reason of ['guard-stop', 'deadline']) {
      let cancelled = false, finish;
      const f = fixture({ cancelled: () => cancelled, sign: () => new Promise(resolve => { finish = resolve; }) });
      await f.call('/api/test-session/request'); f.session.command('APPROVE 123456');
      const claim = f.call('/api/test-session/claim/' + requestId);
      assert.equal((await f.call('/api/test-session/claim/' + requestId)).status, 404);
      if (reason === 'guard-stop') cancelled = true; else f.advance(60000);
      finish('NON_SECRET_FIXTURE_TOKEN');
      const response = await claim; assert.equal(response.status, 410); assert(!response.body.accessToken);
      assert.equal((await f.call('/api/orders')).next, false); assert.equal(f.session.info().stopReason, reason);
    }
  });
  await test('Repeated pending requests retain the original pairing and issue only once', async () => {
    const f = fixture(); assert.equal((await f.call('/api/test-session/request')).status, 202);
    for (let i = 0; i < 3; i++) assert.equal((await f.call('/api/test-session/request')).status, 409);
    assert.equal(f.session.info().requested, 1); assert.equal(f.signed, 0);
    assert.equal((await f.call('/api/test-session/claim/33333333-3333-4333-8333-333333333333')).status, 404);
    assert.equal((await f.call('/api/test-session/claim/' + requestId)).status, 202);
    assert.equal(f.session.command('APPROVE 123456'), true);
    assert.equal((await f.call('/api/test-session/claim/' + requestId)).status, 200);
    assert.equal((await f.call('/api/test-session/claim/' + requestId)).status, 404);
    assert.equal((await f.call('/api/test-session/request')).status, 409); assert.equal(f.signed, 1);
  });
  await test('Original native session client carries no WeChat ticket and persists no credentials', async () => {
    const f = fixture(), calls = []; let writes = 0;
    const wx = { setStorageSync() { writes++; }, request(options) { calls.push(options);
      f.call(options.url.slice('http://127.0.0.1:41001'.length)).then(r => options.success({ statusCode: r.status, data: r.body })); } };
    const client = createTestSession({ wx, baseUrl: 'http://127.0.0.1:41001/api', now: () => f.time });
    assert.equal((await client.begin()).pairingCode, '123456'); assert.equal(await client.claim(), null);
    f.session.command('APPROVE 123456'); const session = await client.claim(); assert.equal(session.subject, subject);
    assert.equal(writes, 0); assert(calls.every(c => !c.header.Authorization && c.header['X-DFC-Test-Session'] === '1'));
    assert.equal(client.config.mode, 'isolated-api'); client.close(); await assert.rejects(client.claim());
  });
  await test('Native client rejects production/alias URLs, stale grants and callbacks after page close', async () => {
    for (const baseUrl of ['https://example.invalid/api', 'http://localhost:41001/api', 'http://127.0.0.1:0/api', 'http://[::1]:41001/api', 'http://127.0.0.1:65536/api']) {
      assert.throws(() => createTestSession({ wx: {}, baseUrl }), /127.0.0.1/);
    }
    let response;
    const client = createTestSession({ wx: { request(o) { response = o; } }, baseUrl: 'http://127.0.0.1:41001/api', now: () => 100000 });
    const begin = client.begin(); client.close(); response.success({ statusCode: 202, data: { status: 'pending', requestId, pairingCode: '123456', expiresAt: 120000, environment: 'isolated-test', realWxLogin: false } });
    await assert.rejects(begin, /断开/);
  });
  await test('Actual native Page connects only after operator approval and clears its memory session on unload', async () => {
    const fs = require('node:fs'), vm = require('node:vm');
    const native = path.resolve(__dirname, '../../apps/miniapp-native');
    const fallback = path.join(process.env.DFC_TEST_SOURCE_ROOT || path.resolve(__dirname, '../..'), 'apps/miniapp-native');
    const file = name => fs.existsSync(path.join(native, name)) ? path.join(native, name) : path.join(fallback, name);
    const f = fixture(), app = { globalData: { testApiSession: null } }; let page, storageWrites = 0;
    const wx = { getStorageSync() { return ''; }, setStorageSync() { storageWrites++; }, request(options) {
      const route = options.url.slice('http://127.0.0.1:41001'.length);
      if (route.startsWith('/api/test-session/')) return f.call(route).then(r => options.success({ statusCode: r.status, data: r.body }));
      assert(app.globalData.testApiSession); assert.equal(options.header.Authorization, 'Bearer NON_SECRET_FIXTURE_TOKEN');
      const data = route.endsWith('/environment') ? { environment: 'isolated-test', isTest: true, storeKey: isolation.storeKey } :
        route.includes('/companions') ? [{ id: 'fixture-companion', nickname: 'TEST', pricePerHour: '50' }] :
        route.endsWith('/customer-summary') ? { wallet: { availableBalance: '1000', frozenBalance: '0' } } : [];
      options.success({ statusCode: 200, data });
    } };
    vm.runInNewContext(fs.readFileSync(file('pages/demo/index.js'), 'utf8'), {
      Page(value) { page = value; }, wx, getApp: () => app, Date: { now: () => f.time },
      require(name) {
        const loaded = require(file(path.normalize(path.join('pages/demo', name))));
        return name === '../../test-session.js' ? { createTestSession: options => loaded.createTestSession({ ...options, now: () => f.time }) } : loaded;
      }
    });
    page.data = structuredClone(page.data); page.setData = value => Object.assign(page.data, value); page.onLoad();
    page.changeTestAddress({ detail: { value: 'http://127.0.0.1:41001/api' } }); await page.connectTest();
    assert.equal(page.data.simulation, false); assert.equal(page.data.sessionStage, 'pending'); assert.equal(app.globalData.testApiSession, null);
    await page.claimTest(); assert.equal(app.globalData.testApiSession, null);
    f.session.command('APPROVE 123456'); await page.claimTest(); assert.equal(page.data.sessionStage, 'connected');
    assert.equal(app.globalData.testApiSession.subject, subject); assert.equal(page.data.companions.length, 1);
    assert(!JSON.stringify(page.data).includes('NON_SECRET_FIXTURE_TOKEN')); assert.equal(storageWrites, 0);
    page.onUnload(); assert.equal(app.globalData.testApiSession, null);
  });
  console.log(JSON.stringify({ success: true, tests: passed, networkRequests: 0, pgStarted: false, ideStarted: false, credentialsGenerated: false }));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
