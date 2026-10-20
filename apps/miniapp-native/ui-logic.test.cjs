const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const { test } = require('node:test');
const root = process.env.DFC_NATIVE_SOURCE_ROOT || __dirname;
const fallback = process.env.DFC_NATIVE_FALLBACK_ROOT || root;
const file = name => fs.existsSync(path.join(root, name)) ? path.join(root, name) : path.join(fallback, name);
function pageFixture() {
  let definition; const calls = [];
  const wx = { showModal: options => calls.push(options), request: () => { throw Error('Network forbidden'); } };
  vm.runInNewContext(fs.readFileSync(file('pages/demo/index.js'), 'utf8'), { Page: value => { definition = value; }, wx,
    require: name => require(file(path.normalize(path.join('pages/demo', name)))) });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) };
  page.setData = patch => Object.assign(page.data, patch); page.onLoad();
  return { page, calls };
}
test('cancelled simulation confirmation neither creates an order nor changes balance', async () => {
  const { page, calls } = pageFixture(); await page.pay(); assert.equal(page.data.busy, true);
  await calls[0].success({ confirm: false }); assert.equal(page.data.store.orders.length, 0); assert.equal(page.data.store.availableBalance, 500); assert.equal(page.data.busy, false);
});
test('duplicate click while dialog is open cannot start another confirmation', async () => {
  const { page, calls } = pageFixture(); await page.pay(); await page.pay(); assert.equal(calls.length, 1); assert.match(calls[0].title, /模拟/);
});
test('simulation selection still uses existing model modes and creates the selected amount', async () => {
  const { page, calls } = pageFixture(); page.select({ currentTarget: { dataset: { id: 'fictional-b' } } });
  page.changeHours({ detail: { value: '2' } }); page.changeMode({ detail: { value: '1' } });
  assert.equal(page.data.totalAmount, 240); await page.pay(); await calls[0].success({ confirm: true });
  assert.equal(page.data.store.availableBalance, 260); assert.equal(page.data.store.frozenBalance, 240);
  assert.equal(page.data.store.orders[0].mode, '排位'); assert.equal(page.data.tab, 'orders');
});
test('insufficient simulation balance explains failure without creating an order', async () => {
  const { page, calls } = pageFixture(); page.data.store.availableBalance = 10; await page.pay(); await calls[0].success({ confirm: true });
  assert.match(page.data.message, /余额不足/); assert.equal(page.data.store.orders.length, 0); assert.equal(page.data.store.availableBalance, 10); assert.equal(page.data.busy, false);
});
test('existing after-sales guidance remains explicit about manual refund and unavailable rating', () => {
  const { page, calls } = pageFixture(); page.guide(); const text = calls[0].content;
  for (const expression of [/未连接任何业务API/, /不会直接扣分或判责/, /评价尚未实现/, /退款经客服与管理员人工裁决/, /没有客户自助退款申请按钮/, /\/customer\/orders\//]) assert.match(text, expression);
});
test('unload before simulation confirmation cannot create a hidden order', async () => {
  const { page, calls } = pageFixture(); await page.pay(); page.onUnload(); await calls[0].success({ confirm: true }); assert.equal(page.data.store.orders.length, 0);
});
test('default app preserves simulation flag and keeps the test session empty', () => {
  let app; vm.runInNewContext(fs.readFileSync(file('app.js'), 'utf8'), { App: value => { app = value; }, require: name => require(file(name)) });
  assert.equal(app.globalData.simulation, true); assert.equal(app.globalData.testApiSession, null);
  const config = require(file('api-config.js')); assert.equal(config.mode, 'simulation'); assert.equal(config.baseUrl, '');
});
test('native preview displays Chinese correction without saving or creating an order', async () => {
  const { createClient } = require(file('api-client.js')); const calls = [], store = new Map();
  const wx = { getStorageSync: key => store.get(key), setStorageSync: (key, value) => store.set(key, value), removeStorageSync: key => store.delete(key), request(options) {
    calls.push(options); options.success(options.url.endsWith('/environment') ? { statusCode: 200, data: { environment: 'isolated-test', isTest: true, storeKey: 'TEST_SYNTHETIC' } } : { statusCode: 400, data: { message: '所选陪玩暂不可接此游戏，请刷新后重新选择' } });
  } };
  const client = createClient({ wx, config: { mode: 'isolated-api', baseUrl: 'http://127.0.0.1:4000/api', environment: 'isolated-test' }, getSession: () => ({ subject: 'SYNTHETIC-customer', accessToken: 'SYNTHETIC-memory-only' }) });
  const result = await client.prepare({ companionId: 'SYNTHETIC-companion', mode: '烽火地带', hours: 1 });
  assert.match(result.error, /所选陪玩暂不可接/); assert.equal(result.pending, null); assert.equal(store.size, 0); assert.equal(calls.filter(x => x.url.endsWith('/orders')).length, 0);
});
