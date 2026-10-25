'use strict';
// Direct, single-process offline tests. No child processes, DB, credentials, or network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'apps/api-server/src/modules/auth/wechat-auth.service.ts'), 'utf8');
const syntheticEnv = () => ({ WECHAT_LOGIN_ENABLED: '1', WECHAT_MINIAPP_APP_ID: 'wx0123456789abcdef',
  WECHAT_MINIAPP_APP_SECRET: 'SYNTHETIC-NOT-A-REAL-SECRET', JWT_SECRET: 'SYNTHETIC-NOT-A-REAL-JWT-SECRET-0000' });
class HttpError extends Error {}
class PrismaError extends Error { constructor(code, meta) { super('synthetic DB failure'); this.code = code; this.meta = meta; } }
function backend(options = {}) {
  const calls = [], env = syntheticEnv(); let uuid = 0;
  const mockFetch = async (url, init) => {
    calls.push({ url, init });
    if (options.transportError) throw Error('SYNTHETIC-SECRET-TRANSPORT-ERROR');
    return { ok: options.ok !== false, json: async () => {
      if (options.jsonError) throw Error('SYNTHETIC-BODY-ERROR');
      return options.response === undefined ? { openid: 'synthetic-open-id', session_key: 'SYNTHETIC-SESSION-KEY', unionid: 'ignored-union' } : options.response;
    } };
  };
  const exported = { exports: {} };
  const transpiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: true }, reportDiagnostics: true });
  assert.equal(transpiled.diagnostics.length, 0);
  vm.runInNewContext(transpiled.outputText, { exports: exported.exports, module: exported, process: { env },
    URL, URLSearchParams, AbortSignal, fetch: mockFetch,
    require(name) {
      if (name === '@nestjs/common') return { BadRequestException: HttpError, ServiceUnavailableException: HttpError,
        UnauthorizedException: HttpError, Injectable: () => () => {} };
      if (name === '@nestjs/jwt') return { JwtService: class {} };
      if (name === '@prisma/client') return { Prisma: { PrismaClientKnownRequestError: PrismaError },
        UserRole: { CUSTOMER: 'CUSTOMER' }, UserStatus: { ACTIVE: 'ACTIVE' } };
      if (name === 'node:crypto') return { randomUUID: () => '00000000-0000-4000-8000-' + String(++uuid).padStart(12, '0') };
      if (name === '../prisma/prisma.service') return { PrismaService: class {} };
      throw Error('Unapproved dependency: ' + name);
    }
  });
  const users = [], identities = [], tokens = [], queries = [], sessionQueries = []; let creates = 0, rollbacks = 0;
  const db = {
    async $queryRaw(parts, ...values) {
      queries.push({ sql: parts.join('?'), values });
      const identity = identities.find(x => x.appId === values[0] && x.openId === values[1]);
      return identity ? users.filter(u => u.id === identity.userId) : [];
    },
    async $executeRaw(parts, ...values) {
      assert.match(parts.join('?'), /INSERT INTO "wechat_identities"/);
      identities.push({ appId: values[0], openId: values[1], userId: values[2] });
    },
    user: { async create({ data }) {
      creates++; assert.equal(data.role, 'CUSTOMER'); assert.deepEqual(JSON.parse(JSON.stringify(data.wallet)), { create: {} });
      assert.equal(data.passwordHash, '!wechat-only');
      const user = { id: data.id, email: data.email, role: data.role, status: 'ACTIVE', displayName: data.displayName,
        sessionVersion: options.sessionVersion ?? 0 }; users.push(user); return user;
    }, async findUnique({ where, select }) {
      sessionQueries.push({ where, select });
      assert.deepEqual(JSON.parse(JSON.stringify(select)), { sessionVersion: true });
      const user = users.find(value => value.id === where.id);
      return user ? { sessionVersion: user.sessionVersion ?? 0 } : null;
    } },
    async $transaction(fn) {
      const u = users.length, i = identities.length;
      try { return await fn(db); } catch (e) { users.splice(u); identities.splice(i); rollbacks++; throw e; }
    }
  };
  const jwt = { async signAsync(payload, config) { tokens.push({ payload, config }); return 'SYNTHETIC-MEMORY-JWT'; } };
  return { ...exported.exports, env, calls, db, users, identities, tokens, queries, sessionQueries,
    get creates() { return creates; }, get rollbacks() { return rollbacks; },
    service: new exported.exports.WechatAuthService(db, jwt) };
}

test('backend disabled/missing/malformed/test settings fail closed without network or DB', async () => {
  const changes = [{ WECHAT_LOGIN_ENABLED: '0' }, { WECHAT_LOGIN_ENABLED: '' }, { WECHAT_MINIAPP_APP_ID: 'wrong' },
    { WECHAT_MINIAPP_APP_SECRET: '' }, { JWT_SECRET: 'short' }, { JWT_SECRET: 'a'.repeat(32) + ' ' },
    { DFC_ISOLATED_API: '1' }, { DFC_ISOLATED_API: 'invalid' }, { DFC_TEST_MODE: '1' }, { NODE_ENV: 'test' },
    { DFC_ISOLATED_DATABASE: 'synthetic' }, { DFC_TEST_SUBJECT: 'synthetic' }, { DFC_OUTBOUND_POLICY: 'deny' }];
  for (const change of changes) {
    const b = backend(); Object.assign(b.env, change);
    assert.equal(b.service.publicConfig().enabled, false);
    await assert.rejects(b.service.login({ code: 'synthetic-code' }), /禁止真实登录/);
    assert.equal(b.calls.length + b.queries.length + b.tokens.length, 0);
  }
});
test('only code accepted; identity/role/appId injection and malformed bodies rejected before upstream', async () => {
  for (const body of [null, [], '', {}, { code: '' }, { code: 123 }, { code: 'a b' }, { code: 'a'.repeat(513) },
    { code: 'synthetic', userId: 'admin' }, { code: 'synthetic', openid: 'other' }, { code: 'synthetic', role: 'ADMIN' },
    { code: 'synthetic', email: 'someone@synthetic.invalid' }, { code: 'synthetic', appId: 'other' }]) {
    const b = backend(); await assert.rejects(b.service.login(body), /仅接受/); assert.equal(b.calls.length, 0);
  }
});
test('official code exchange is fixed HTTPS GET with encoded parameters, redirect refusal and bounded timeout', async () => {
  const b = backend(); await b.service.login({ code: 'synthetic-code' });
  const { url, init } = b.calls[0]; assert.equal(url.origin + url.pathname, 'https://api.weixin.qq.com/sns/jscode2session');
  assert.equal(url.searchParams.get('appid'), b.env.WECHAT_MINIAPP_APP_ID);
  assert.equal(url.searchParams.get('js_code'), 'synthetic-code');
  assert.equal(url.searchParams.get('grant_type'), 'authorization_code');
  assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert(init.signal instanceof AbortSignal);
});
test('new verified identity creates one customer plus wallet and later login uses same identity', async () => {
  const b = backend(); const first = await b.service.login({ code: 'synthetic-one' });
  const second = await b.service.login({ code: 'synthetic-two' });
  assert.equal(first.user.id, second.user.id); assert.equal(b.creates, 1); assert.equal(b.identities.length, 1);
  assert.equal(b.identities[0].appId, b.env.WECHAT_MINIAPP_APP_ID);
  assert.equal(b.identities[0].openId, 'synthetic-open-id');
  assert.equal(first.expiresIn, 3600); assert.equal(first.payment, 'NOT_CONNECTED');
  assert.equal(first.nativeOrdering, 'NOT_CONNECTED');
  assert.equal(b.tokens[0].payload.role, 'CUSTOMER'); assert.equal(b.tokens[0].config.algorithm, 'HS256');
  assert.equal(b.tokens[0].payload.sv, 0); assert.equal(b.sessionQueries[0].where.id, first.user.id);
  assert.equal(b.tokens[0].config.expiresIn, 3600);
  assert(!/session_key|unionid|synthetic-open-id|SYNTHETIC-SESSION-KEY|SECRET/.test(JSON.stringify(first)));
  assert(!/SECRET|jwtSecret|appSecret/.test(JSON.stringify(b.service.publicConfig())));
  assert(b.queries.every(q => q.values.length === 2 && /w\."appId" = \? AND w\."openId" = \?/.test(q.sql)));
});
test('same openId under another appId is an independent customer, never an email merge', async () => {
  const b = backend(); const first = await b.service.login({ code: 'synthetic-one' });
  b.env.WECHAT_MINIAPP_APP_ID = 'wxfedcba9876543210';
  const second = await b.service.login({ code: 'synthetic-two' });
  assert.notEqual(first.user.id, second.user.id); assert.equal(b.creates, 2);
});
test('wechat JWT uses the current stored session version after account sessions are revoked', async () => {
  const b = backend({ sessionVersion: 3 });
  const first = await b.service.login({ code: 'synthetic-first' });
  assert.equal(b.tokens[0].payload.sv, 3);
  b.users[0].sessionVersion = 4;
  const second = await b.service.login({ code: 'synthetic-second' });
  assert.equal(second.user.id, first.user.id); assert.equal(b.creates, 1);
  assert.equal(b.tokens[1].payload.sv, 4); assert.equal(b.sessionQueries.length, 2);
});
test('banned and non-customer linked users receive no JWT', async () => {
  for (const change of [{ status: 'BANNED' }, { role: 'ADMIN' }, { role: 'COMPANION' }]) {
    const b = backend(); await b.service.login({ code: 'synthetic-first' }); Object.assign(b.users[0], change); b.tokens.length = 0;
    await assert.rejects(b.service.login({ code: 'synthetic-second' }), /客户账户/); assert.equal(b.tokens.length, 0);
  }
});
test('upstream transport/HTTP/JSON/error-code/shape failures are sanitized and never create users', async () => {
  for (const options of [{ transportError: true }, { ok: false }, { jsonError: true }, { response: null },
    { response: { errcode: 40029, errmsg: 'SYNTHETIC-SECRET' } }, { response: { errcode: -1 } },
    { response: { openid: 'safe', session_key: '' } }, { response: { openid: 'bad space', session_key: 'synthetic' } },
    { response: { openid: 'safe', session_key: 'synthetic', errcode: '0' } }]) {
    const b = backend(options); await assert.rejects(b.service.login({ code: 'synthetic' }), e => !/SECRET|BODY|TRANSPORT/.test(e.message));
    assert.equal(b.creates + b.tokens.length + b.queries.length, 0);
  }
});
test('failed identity insert rolls back user/wallet creation with no token', async () => {
  const b = backend(); b.db.$executeRaw = async () => { throw new PrismaError('P2010', { code: '23503' }); };
  await assert.rejects(b.service.login({ code: 'synthetic' }));
  assert.equal(b.users.length + b.identities.length + b.tokens.length, 0); assert.equal(b.rollbacks, 1);
});
test('concurrent unique identity conflict uses winner after rolling back losing account', async () => {
  for (const conflict of [new PrismaError('P2010', { code: '23505' }), new PrismaError('P2002')]) {
  const b = backend(); const normal = b.db.$transaction;
  b.db.$executeRaw = async () => { throw conflict; };
  b.db.$transaction = async fn => {
    try { return await normal(fn); } catch (e) {
      b.users.push({ id: 'synthetic-winner', email: 'winner@synthetic.invalid', role: 'CUSTOMER', status: 'ACTIVE', displayName: 'winner' });
      b.identities.push({ appId: b.env.WECHAT_MINIAPP_APP_ID, openId: 'synthetic-open-id', userId: 'synthetic-winner' }); throw e;
    }
  };
  const result = await b.service.login({ code: 'synthetic' });
  assert.equal(result.user.id, 'synthetic-winner'); assert.equal(b.users.length, 1); assert.equal(b.rollbacks, 1);
  }
});
test('unique conflict without verified winner fails closed', async () => {
  const b = backend(); b.db.$executeRaw = async () => { throw new PrismaError('P2002'); };
  await assert.rejects(b.service.login({ code: 'synthetic' }), /暂未完成/);
  assert.equal(b.users.length + b.tokens.length, 0);
});
test('wechat-only password marker is rejected by the installed password library', async () => {
  const bcrypt = require(path.join(root, 'apps/api-server/node_modules/bcryptjs'));
  assert.equal(await bcrypt.compare('SYNTHETIC-PASSWORD', '!wechat-only'), false);
});
test('route wiring uses auth rate guard; schema/migration declare identity and user uniqueness', () => {
  const controller = fs.readFileSync(path.join(root, 'apps/api-server/src/modules/auth/auth.controller.ts'), 'utf8');
  assert.match(controller, /@Post\("wechat\/login"\)\s+@UseGuards\(AuthRateLimitGuard\)/);
  assert.match(fs.readFileSync(path.join(root, 'apps/api-server/src/modules/auth/auth.module.ts'), 'utf8'), /providers: \[AuthService, WechatAuthService,/);
  const sql = fs.readFileSync(path.join(root, 'packages/database/prisma/migrations/20261017090000_wechat_customer_identity/migration.sql'), 'utf8');
  assert.match(sql, /PRIMARY KEY \("appId", "openId"\)/); assert.match(sql, /UNIQUE INDEX.*\("appId", "userId"\)/);
  assert.match(sql, /FOREIGN KEY \("userId"\) REFERENCES "users"\("id"\) ON DELETE RESTRICT/);
  const schema = fs.readFileSync(path.join(root, 'packages/database/prisma/schema.prisma'), 'utf8');
  assert.match(schema, /@@id\(\[appId, openId\]\)/); assert.match(schema, /@@unique\(\[appId, userId\]\)/);
});

const { createWechatSession, validateWechatConfig } = require('../apps/miniapp-native/wechat-session');
const nativeConfig = () => ({ mode: 'wechat-api', environment: 'wechat', baseUrl: 'https://api.synthetic.example/api', appId: 'wx0123456789abcdef' });
function native(options = {}) {
  const calls = []; let loginCalls = 0, now = 1000;
  const config = nativeConfig();
  const capability = { mode: 'wechat-api', enabled: true, appId: config.appId, payment: 'NOT_CONNECTED', nativeOrdering: 'NOT_CONNECTED' };
  const result = { mode: 'wechat-api', accessToken: 'SYNTHETIC-MEMORY-JWT', expiresIn: 3600,
    user: { id: 'synthetic-user', role: 'CUSTOMER', displayName: 'synthetic' }, payment: 'NOT_CONNECTED', nativeOrdering: 'NOT_CONNECTED' };
  const wx = {
    getAccountInfoSync: () => ({ miniProgram: { appId: options.appId || config.appId } }),
    login(call) { loginCalls++; calls.push({ kind: 'wx.login', call });
      if (options.loginThrows) throw Error('SYNTHETIC-INTERNAL');
      if (options.hold === 'code') return;
      if (options.loginFailure) call.fail({ errMsg: 'SYNTHETIC-INTERNAL' });
      else call.success({ code: options.code === undefined ? 'synthetic-code-' + loginCalls : options.code });
    },
    request(call) { calls.push({ kind: 'request', call });
      if (options.requestThrows) throw Error('SYNTHETIC-INTERNAL');
      const route = call.url.slice(config.baseUrl.length);
      if (options.hold === route) return;
      if (options.transport === route) { call.fail({ errMsg: 'SYNTHETIC-INTERNAL' }); return; }
      const data = route === '/auth/wechat/config' ? { ...capability, ...options.capability }
        : route === '/auth/wechat/login' ? { ...result, ...options.result } : { user: { id: 'synthetic-user', role: 'CUSTOMER', ...options.me } };
      call.success({ statusCode: options.status || 200, data });
    },
    setStorageSync() { throw Error('Token persistence forbidden'); }, getStorageSync() { throw Error('Storage forbidden'); },
    requestPayment() { throw Error('Payment forbidden'); }
  };
  const client = createWechatSession({ wx, config, now: () => now });
  return { client, calls, wx, config, result, capability, advance: ms => { now += ms; }, get loginCalls() { return loginCalls; } };
}
test('real-mode configuration rejects TEST, simulation, HTTP, localhost, IP, credentials, alternate paths and ports', () => {
  for (const change of [{ mode: 'simulation' }, { mode: 'isolated-api' }, { environment: 'isolated-test' }, { appId: '' },
    ...['http://api.synthetic.example/api', 'https://localhost/api', 'https://127.0.0.1/api', 'https://api.local/api',
      'https://user@api.synthetic.example/api', 'https://api.synthetic.example:444/api', 'https://api.synthetic.example/api?x=1',
      'https://api.synthetic.example/other', 'https://api.synthetic.example/api#x'].map(baseUrl => ({ baseUrl }))]) {
    assert.throws(() => validateWechatConfig({ ...nativeConfig(), ...change }));
  }
  assert.equal(validateWechatConfig(nativeConfig()), nativeConfig().baseUrl);
});
test('native login validates config, obtains fresh wx code, exchanges once and verifies JWT /me', async () => {
  const n = native(); assert.equal(n.calls.length, 0); const result = await n.client.login();
  assert.deepEqual(n.calls.map(x => x.kind === 'wx.login' ? x.kind : x.call.method + ' ' + x.call.url.slice(n.config.baseUrl.length)),
    ['GET /auth/wechat/config', 'wx.login', 'POST /auth/wechat/login', 'GET /auth/me']);
  assert.deepEqual(n.calls[2].call.data, { code: 'synthetic-code-1' });
  assert.equal(n.calls[3].call.header.Authorization, 'Bearer SYNTHETIC-MEMORY-JWT');
  assert(!('accessToken' in result)); assert.equal(n.client.getSession().subject, 'synthetic-user');
  n.client.getSession().user.id = 'mutated'; assert.equal(n.client.getSession().user.id, 'synthetic-user');
  n.client.logout(); assert.equal(n.client.getSession(), null); await n.client.login();
  assert.equal(n.loginCalls, 2); assert.deepEqual(n.calls[6].call.data, { code: 'synthetic-code-2' });
});
test('native identity mismatch or unavailable backend prevents wx.login', async () => {
  for (const options of [{ appId: 'wxfedcba9876543210' }, { capability: { enabled: false } },
    { capability: { appId: 'wxfedcba9876543210' } }, { capability: { mode: 'isolated-api' } },
    { capability: { nativeOrdering: 'CONNECTED' } }, { status: 503 }]) {
    const n = native(options); await assert.rejects(n.client.login()); assert.equal(n.loginCalls, 0); assert.equal(n.client.getSession(), null);
  }
});
test('native rejects empty code, login refusal, invalid response, expired duration, wrong role and /me mismatch', async () => {
  for (const options of [{ code: '' }, { code: 42 }, { loginFailure: true }, { loginThrows: true }, { requestThrows: true }, { result: { accessToken: '' } },
    { result: { expiresIn: 0 } }, { result: { expiresIn: 3601 } }, { result: { user: { id: 'admin', role: 'ADMIN', displayName: 'synthetic' } } },
    { result: { payment: 'CONNECTED' } }, { me: { id: 'other-user' } }, { me: { role: 'ADMIN' } },
    { transport: '/auth/wechat/login' }, { transport: '/auth/me' }]) {
    const n = native(options); await assert.rejects(n.client.login(), e => !/SYNTHETIC-INTERNAL/.test(e.message)); assert.equal(n.client.getSession(), null);
  }
});
test('native session expires from memory', async () => {
  const n = native(); await n.client.login(); n.advance(3600000); assert.equal(n.client.getSession(), null);
});
test('logout during each asynchronous stage cannot resurrect a session', async () => {
  for (const hold of ['/auth/wechat/config', 'code', '/auth/wechat/login', '/auth/me']) {
    const n = native({ hold }); const pending = n.client.login();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const last = n.calls.at(-1); n.client.logout();
    if (hold === 'code') last.call.success({ code: 'synthetic-late' });
    else last.call.success({ statusCode: 200, data: hold.endsWith('config') ? n.capability : hold.endsWith('login') ? n.result : { user: { id: 'synthetic-user', role: 'CUSTOMER' } } });
    await assert.rejects(pending, /取消/); assert.equal(n.client.getSession(), null);
  }
});
test('duplicate login does not exchange a second code', async () => {
  const n = native({ hold: 'code' }); const pending = n.client.login();
  for (let i = 0; i < 4; i++) await Promise.resolve();
  await assert.rejects(n.client.login(), /正在登录/); assert.equal(n.loginCalls, 1);
  n.client.logout(); n.calls.at(-1).call.success({ code: 'synthetic-late' }); await assert.rejects(pending);
});
test('real page loads without login/network, blocks TEST/payment handlers and clears session on unload', async () => {
  const n = native(); let definition;
  const file = path.join(root, 'apps/miniapp-native/pages/demo/index.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { wx: n.wx, Page: value => { definition = value; },
    require(name) { if (name === '../../api-config.js') return n.config; return require(path.resolve(path.dirname(file), name)); } });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }; page.setData = data => Object.assign(page.data, data);
  page.onLoad(); assert.equal(n.calls.length, 0); assert.equal(page.data.simulation, false); assert.equal(page.data.companions.length, 0);
  await page.connectTest(); await page.claimTest(); await page.pay(); await page.refresh(); assert.equal(n.calls.length, 0);
  assert.match(page.data.wechatMessage, /尚未接通/); await page.loginWechat(); assert.equal(page.data.wechatUser.id, 'synthetic-user');
  page.onUnload(); assert.equal(page.wechatClient.getSession(), null);
});
