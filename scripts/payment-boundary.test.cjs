// All observations below are explicit SYNTHETIC fixtures, not a real signature or payment verification.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { test } = require('node:test'), { createRequire } = require('node:module');
const root = process.env.DFC_PAYMENT_SOURCE_ROOT || path.resolve(__dirname, '..');
const deps = createRequire(path.join(process.env.DFC_PAYMENT_DEPENDENCY_ROOT || root, 'apps/api-server/package.json'));
const ts = deps('typescript');
const modules = new Map(); let externalRequests = 0;
function readModule(relative) {
  const file = path.join(root, relative); if (modules.has(file)) return modules.get(file);
  const exports = {}; modules.set(file, exports);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(js, { exports, fetch: () => { externalRequests++; throw new Error('External network forbidden'); },
    require: name => name.startsWith('.') ? readModule(path.relative(root, path.resolve(path.dirname(file), name + '.ts'))) : deps(name) });
  return exports;
}
const { PaymentBoundary, PaymentQueryUncertain, PaymentProviderUnavailable, rechargeAmountMinor } = readModule('apps/api-server/src/modules/payments/payment-boundary.ts');
const { createPaymentBoundary } = readModule('apps/api-server/src/modules/payments/unconfigured-payment-provider.ts');
const order = { id: 'SYNTHETIC-order-a', entry: 'PROVIDER_RECHARGE', providerId: 'SYNTHETIC-provider', merchantId: 'SYNTHETIC-merchant', merchantOrderId: 'SYNTHETIC-external-a', amountMinor: '10000', currency: 'CNY', state: 'PENDING' };
const paid = { status: 'PAID', merchantId: order.merchantId, merchantOrderId: order.merchantOrderId, amountMinor: '10000', currency: 'CNY', transactionId: 'SYNTHETIC-transaction' };
const notification = { rawBody: new TextEncoder().encode('{"verified":true,"paid":true}'), headers: { 'synthetic-header': 'fixture' } };
function fixture(result = paid) {
  let verified = 0, queried = 0, received;
  const provider = { id: order.providerId, verifyNotification: async input => { verified++; received = input; return result; }, queryPayment: async () => { queried++; return result; } };
  return { boundary: new PaymentBoundary(provider), provider, calls: () => ({ verified, queried, received }) };
}
test('unconfigured adapter rejects forged success callbacks and queries without network activity', async () => {
  const boundary = createPaymentBoundary(order.providerId);
  await assert.rejects(boundary.fromNotification(order, notification), e => e.code === 'PAYMENT_PROVIDER_UNAVAILABLE');
  await assert.rejects(boundary.fromQuery(order), e => e.code === 'PAYMENT_PROVIDER_UNAVAILABLE');
  assert.equal(externalRequests, 0);
});
test('callback preserves raw bytes and only the server-selected adapter produces an observation', async () => {
  const f = fixture({ status: 'PENDING', merchantId: order.merchantId, merchantOrderId: order.merchantOrderId });
  const result = await f.boundary.fromNotification(order, notification);
  assert.equal(result.action, 'PENDING'); assert.equal(f.calls().verified, 1); assert.equal(f.calls().received.rawBody, notification.rawBody);
  assert.equal(result.walletBusinessKey, undefined);
});
test('callback and active query use the same money decision and existing wallet business-key namespace', async () => {
  const f = fixture(), callback = await f.boundary.fromNotification(order, notification), query = await f.boundary.fromQuery(order);
  assert.deepEqual(callback, query); assert.equal(callback.action, 'CREDIT_REQUIRED'); assert.equal(callback.amountMinor, '10000');
  assert.match(callback.walletBusinessKey, /^provider-recharge:[a-f0-9]{64}$/); assert.equal(callback.allowNewPaymentAttempt, false);
});
test('wrong merchant, order, amount, currency or transaction is rejected before credit', async () => {
  for (const patch of [{ merchantId: 'another' }, { merchantOrderId: 'another' }, { amountMinor: '1' }, { amountMinor: '010000' },
    { amountMinor: '1e4' }, { amountMinor: 10000 }, { currency: 'USD' }, { transactionId: '' }, { transactionId: ' with spaces' }]) {
    await assert.rejects(fixture({ ...paid, ...patch }).boundary.fromNotification(order, notification));
  }
});
test('same external transaction on two local orders derives the same unique wallet key', async () => {
  const first = await fixture().boundary.fromQuery(order);
  const secondOrder = { ...order, id: 'SYNTHETIC-order-b', merchantOrderId: 'SYNTHETIC-external-b' };
  const second = await fixture({ ...paid, merchantOrderId: secondOrder.merchantOrderId }).boundary.fromQuery(secondOrder);
  assert.equal(first.walletBusinessKey, second.walletBusinessKey);
});
test('repeated paid notifications are duplicates; conflicting transaction or closed order requires review', async () => {
  assert.equal((await fixture().boundary.fromQuery({ ...order, state: 'PAID', providerTransactionId: paid.transactionId })).action, 'DUPLICATE');
  assert.equal((await fixture().boundary.fromQuery({ ...order, state: 'PAID', providerTransactionId: 'another' })).action, 'REVIEW_REQUIRED');
  assert.equal((await fixture().boundary.fromQuery({ ...order, state: 'CLOSED' })).action, 'REVIEW_REQUIRED');
});
test('pending, missing, timeout and unknown results never authorize a replacement payment', async () => {
  for (const status of ['UNKNOWN', 'NOT_FOUND', 'PENDING']) {
    const result = await fixture({ ...paid, status }).boundary.fromQuery(order);
    assert.equal(result.allowNewPaymentAttempt, false); assert.equal(result.walletBusinessKey, undefined);
    assert.equal(result.action, status === 'PENDING' ? 'PENDING' : 'UNKNOWN');
  }
  const f = fixture(); f.provider.queryPayment = async () => { throw new PaymentQueryUncertain('synthetic timeout'); };
  assert.equal((await f.boundary.fromQuery(order)).action, 'UNKNOWN');
  f.provider.queryPayment = async () => { throw new PaymentProviderUnavailable(); };
  await assert.rejects(f.boundary.fromQuery(order), PaymentProviderUnavailable);
});
test('later pending/closed/unknown observations cannot downgrade terminal local states', async () => {
  for (const state of ['PAID', 'CLOSED']) for (const status of ['PENDING', 'CLOSED', 'UNKNOWN', 'NOT_FOUND']) {
    assert.equal((await fixture({ ...paid, status }).boundary.fromQuery({ ...order, state })).action, 'NO_CHANGE');
  }
});
test('verified closure only proposes closure without any wallet credit', async () => {
  const result = await fixture({ ...paid, status: 'CLOSED' }).boundary.fromQuery(order);
  assert.equal(result.action, 'CLOSE_WITHOUT_CREDIT'); assert.equal(result.walletBusinessKey, undefined);
});
test('manual recharge entry, mismatched provider and malformed server money cannot enter this boundary', async () => {
  for (const patch of [{ entry: 'MANUAL' }, { providerId: 'other' }, { amountMinor: '0' }, { amountMinor: '-1' }, { amountMinor: '100.00' }, { amountMinor: '1000000000000' }, { state: 'fake' }]) {
    const f = fixture(); await assert.rejects(f.boundary.fromQuery({ ...order, ...patch })); assert.equal(f.calls().queried, 0);
  }
});
test('server money conversion keeps the existing financial precision and maximum', () => {
  assert.equal(rechargeAmountMinor('100.01'), '10001'); assert.equal(rechargeAmountMinor('0.01'), '1');
  assert.equal(rechargeAmountMinor('9999999999.99'), '999999999999');
  for (const input of ['0', '-1', '1.001', '1e2', '10000000000', 'NaN']) assert.throws(() => rechargeAmountMinor(input));
});
test('unexpected adapter errors and invalid observation states fail closed', async () => {
  await assert.rejects(fixture({ status: 'FAKE_SUCCESS' }).boundary.fromQuery(order));
  const f = fixture(); f.provider.queryPayment = async () => { throw new Error('synthetic adapter bug'); };
  await assert.rejects(f.boundary.fromQuery(order), /adapter bug/); assert.equal(externalRequests, 0);
});
