// Offline HTTP-boundary/client fixtures only; no database, server or external request is started.
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { createRequire } = require('node:module');
const root = process.env.DFC_FEEDBACK_ROOT || path.resolve(__dirname, '..');
const source = process.env.DFC_FEEDBACK_SOURCE_ROOT || root;
const deps = createRequire(path.join(root, 'apps/api-server/package.json')), ts = deps('typescript'), cache = new Map();
function load(relative) {
  if (cache.has(relative)) return cache.get(relative);
  const overlay = path.join(source, relative), file = fs.existsSync(overlay) ? overlay : path.join(root, relative), exports = {};
  cache.set(relative, exports);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
  const local = name => name.startsWith('.') ? load(path.posix.normalize(path.posix.join(path.posix.dirname(relative), name + '.ts'))) : name === '@dfc/shared' ? load('packages/shared/src/index.ts') : deps(name);
  vm.runInNewContext(js, { exports, require: local, process: { env: {} }, Buffer, Date, Error, AbortController, setTimeout, clearTimeout });
  return exports;
}
const { OrdersController } = load('apps/api-server/src/modules/orders/orders.controller.ts');
const { customerOrderAction } = load('apps/api-server/src/modules/orders/customer-order-input.ts');
const { createOrderClient } = load('apps/customer-web/app/order/order-client.ts');
const { BadRequestException, ConflictException } = deps('@nestjs/common');
const selection = { mode: '烽火地带', hours: '2', companionId: 'SYNTHETIC-companion', game: 'DELTA_FORCE' };
const input = { ...selection, requestId: 'SYNTHETIC-request-0001', expectedTotalAmount: '40.20' };
const identity = { id: 'SYNTHETIC-customer' };

test('malformed customer preview and create input yield Chinese 400 before calling business services', async () => {
  let called = 0;
  const ctrl = new OrdersController({ previewCustomerOrder: () => { called++; }, createOrder: () => { called++; } }, {});
  for (const bad of [null, [], { ...input, mode: 3 }, { ...input, mode: ' ' }, { ...input, companionId: {} },
    { ...input, hours: 2 }, { ...input, hours: '0' }, { ...input, hours: '2.123' }, { ...input, game: 'UNKNOWN_GAME' },
    { ...input, expectedTotalAmount: 'NaN' }, { ...input, notes: [] }, { ...input, voiceTrialRequested: 'false' }]) {
    for (const method of ['previewOrder', 'createOrder']) await assert.rejects(ctrl[method](identity, bad), error => {
      assert.equal(error.getStatus(), 400); assert.match(error.message, /[\u4e00-\u9fff]/); return true;
    });
  }
  assert.equal(called, 0);
});

test('valid decimal selection reaches the existing service unchanged and ignores client authority flags', async () => {
  let sent;
  const ctrl = new OrdersController({ createOrder: (customer, body) => { sent = { customer, body }; return { id: 'SYNTHETIC-order' }; } }, {});
  await ctrl.createOrder(identity, { ...input, isTest: true, storeKey: 'ATTACKER', expectedTotalAmount: '40.20' });
  assert.equal(sent.customer, identity.id); assert.equal(sent.body.expectedTotalAmount, '40.20'); assert.equal(sent.body.hours, '2');
  assert.equal(sent.body.isTest, undefined); assert.equal(sent.body.storeKey, undefined);
});

test('known post-rollback errors become useful Chinese messages and preserve NOT_COMMITTED', async () => {
  for (const [message, text] of [['Insufficient balance', /余额不足/], ['Customer wallet does not exist', /钱包未就绪/],
    ['Companion is not listed for selected game or does not exist', /陪玩暂不可接/], ['hours cannot be greater than 8', /不能超过 8 小时/]]) {
    const ctrl = new OrdersController({ createOrder: async () => { throw new BadRequestException({ message, requestOutcome: 'NOT_COMMITTED', statusCode: 400 }); } }, {});
    await assert.rejects(ctrl.createOrder(identity, input), error => {
      assert.equal(error.getStatus(), 400); assert.match(error.message, text); assert.equal(error.getResponse().requestOutcome, 'NOT_COMMITTED'); return true;
    });
  }
});

test('read-only preview error never gains a committed/uncommitted receipt claim', async () => {
  const ctrl = new OrdersController({ previewCustomerOrder: async () => { throw new BadRequestException('Companion is not listed for selected game or does not exist'); } }, {});
  await assert.rejects(ctrl.previewOrder(identity, selection), error => {
    assert.match(error.message, /刷新后重新选择/); assert.equal(error.getResponse().requestOutcome, undefined); return true;
  });
});

test('request conflict stays 409 and unknown database/commit failures retain their original identity', async () => {
  await assert.rejects(customerOrderAction(() => { throw new ConflictException('requestId already belongs to a different order request; restore the original request'); }), error => {
    assert.equal(error.getStatus(), 409); assert.match(error.message, /核对原申请/); assert.equal(error.getResponse().requestOutcome, undefined); return true;
  });
  const unknown = new Error('SYNTHETIC commit outcome unknown');
  await assert.rejects(customerOrderAction(() => { throw unknown; }), error => error === unknown);
});

function clientFixture() {
  const journal = new Map(), calls = [];
  let previewError, submitError;
  const client = createOrderClient({ scope: 'SYNTHETIC-OFFLINE', getToken: () => 'SYNTHETIC-memory-session', makeRequestId: () => input.requestId,
    storage: { getItem: key => journal.get(key) ?? null, setItem: (key, value) => journal.set(key, value), removeItem: key => journal.delete(key) },
    fetcher: async (route, init) => {
      calls.push([route, init.method]);
      const response = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
      if (route === '/api/auth/me') return response(200, { user: { id: identity.id, role: 'CUSTOMER' } });
      if (route === '/api/orders/preview') return previewError ? response(...previewError) : response(200, { ...selection, customerId: identity.id, unitPrice: '20.10', totalAmount: '40.20' });
      if (route === '/api/orders') return response(...submitError);
      throw Error('Unexpected offline route');
    } });
  return { client, journal, calls, rejectPreview: (...args) => { previewError = args; }, rejectSubmit: (...args) => { submitError = args; } };
}

test('customer sees the specific Chinese preview correction without a pending order or journal', async () => {
  const f = clientFixture(); f.rejectPreview(400, { message: '所选陪玩暂不可接此游戏，请刷新后重新选择' });
  const result = await f.client.prepare(selection);
  assert.match(result.error, /所选陪玩暂不可接/); assert.equal(result.pending, false); assert.equal(result.preview, null);
  assert.equal(f.journal.size, 0); assert.equal(f.calls.filter(([route]) => route === '/api/orders').length, 0);
});

test('unknown submit remains locked even with Chinese error text; preview 500 remains uncertain', async () => {
  const f = clientFixture(); await f.client.prepare(selection); f.rejectSubmit(400, { message: '余额不足，但结果未知' });
  const result = await f.client.submit(); assert.equal(result.pending, true); assert.equal(f.journal.size, 1); assert.match(result.error, /核对原申请/);
  await f.client.prepare(selection); assert.equal(f.calls.filter(([route]) => route === '/api/orders').length, 1);
  const preview = clientFixture(); preview.rejectPreview(500, { message: '临时异常' });
  assert.match((await preview.client.prepare(selection)).error, /未返回可靠结果/);
});

test('explicit NOT_COMMITTED shows balance correction, clears pending and requires a new quote', async () => {
  const f = clientFixture(); await f.client.prepare(selection); f.rejectSubmit(400, { message: '可用余额不足，请核对钱包余额或调整服务时长后重新确认', requestOutcome: 'NOT_COMMITTED' });
  const result = await f.client.submit(); assert.equal(result.pending, false); assert.equal(f.journal.size, 0); assert.equal(result.preview, null); assert.match(result.error, /可用余额不足/);
  await f.client.submit(); assert.equal(f.calls.filter(([route]) => route === '/api/orders').length, 1);
});
