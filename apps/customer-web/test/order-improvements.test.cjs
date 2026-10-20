const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const ok = data => ({ ok: true, json: async () => data });
const order = id => ({ id, orderNo: id, status: 'ASSIGNED', hours: '1', totalAmount: '30' });
const recordModule = { exports: {} };
const ts = require('typescript');
vm.runInNewContext(ts.transpileModule(read('packages/ui/src/order-record-client.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, { exports: recordModule.exports, AbortController, setTimeout, clearTimeout });

// Execute the actual page's hooks and handlers, excluding only its JSX render.
function harness(kind, fetch) {
  const file = kind === 'queue' ? 'apps/companion-web/app/available-orders/page.tsx' : 'apps/customer-web/app/orders/page.tsx';
  const source = read(file);
  const exposed = kind === 'queue' ? 'loadQueues, refreshQueues, patchOrder, applyDraft, availableOrders, error, newOrderNotice, uncertainIds' : 'orders, refresh, error, kookUrl, nextSteps, labels';
  const code = source.slice(0, source.indexOf('\n  return (')).replace(/^import .*;\r?\n/gm, '').replace('export default function', 'function') + `\n return {${exposed}};\n}\nresult = ${kind === 'queue' ? 'AvailableOrdersPage' : 'OrdersPage'};`;
  let index = 0, refIndex = 0, mounted = false;
  const states = [], refs = [], effects = [], cleanups = [], timers = new Map(), listeners = new Set();
  let serial = 0;
  const document = { visibilityState: 'visible', addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
  const context = { Error, fetch, document, localStorage: { getItem: () => 'test-only' }, result: null,
    window: { location: { search: '' }, addEventListener() {}, removeEventListener() {} },
    URLSearchParams, ...recordModule.exports,
    useState(initial) { const i = index++; if (!(i in states)) states[i] = initial; return [states[i], next => states[i] = typeof next === 'function' ? next(states[i]) : next]; },
    useRef(initial) { return refs[refIndex++] ||= { current: initial }; },
    useEffect(fn) { if (!mounted) effects.push(fn); }, useMemo: fn => fn(),
    setInterval(fn, delay) { assert.equal(delay, 20000); timers.set(++serial, fn); return serial; }, clearInterval(id) { timers.delete(id); }
  };
  vm.runInNewContext(stripTypeScriptTypes(code), context);
  const render = () => { index = refIndex = 0; return context.result(); };
  return { render, timers, listeners,
    mount() { render(); mounted = true; effects.forEach(fn => cleanups.push(fn())); },
    async pulse() { render(); timers.forEach(fn => fn()); await tick(); },
    visible(value) { document.visibilityState = value ? 'visible' : 'hidden'; listeners.forEach(fn => fn()); },
    unmount() { cleanups.forEach(fn => fn?.()); }
  };
}

for (const [status, expected] of Object.entries({ PAID: '等待客服', ASSIGNED: '等待陪玩', ACCEPTED: '开始时间', IN_PROGRESS: '正在服务', AWAITING_ACCEPTANCE: '确认验收', COMPLETED: '已完成', DISPUTED: '等待客服', REFUND_REQUESTED: '等待人工核对退款申请', REFUNDED: '核对流水', CANCELLED: '已取消' })) test(`4: next step for ${status}`, () => {
  const p = harness('orders', async () => ok([]));
  assert.match(p.render().nextSteps[status], new RegExp(expected));
  assert.equal(Object.keys(p.render().labels).length, 10);
});
test('4: existing companion name, unassigned and unknown status fallback are rendered', () => {
  const source = read('apps/customer-web/app/orders/page.tsx');
  assert.match(source, /order\.companion\?\.displayName \|\| "待分配"/);
  assert.match(source, /nextSteps\[order.status\] \|\| "订单状态待核对，请刷新；仍不明确请联系客服。"/);
  assert.match(source, /onClick=\{\(\) => void refresh\(\)\}/);
});
test('4: manual refresh replaces list and recovers from failure', async () => {
  let rows = [order('old')], fail = false;
  const p = harness('orders', async url => { if (url.includes('public-config')) return ok({}); if (fail) throw Error('加载失败'); return ok(rows); });
  p.mount(); await tick(); assert.equal(p.render().orders[0].id, 'old');
  fail = true; await p.render().refresh(); assert.equal(p.render().error, '加载失败'); assert.equal(p.render().orders[0].id, 'old');
  fail = false; rows = [order('new')]; await p.render().refresh(); assert.equal(p.render().orders[0].id, 'new'); assert.equal(p.render().error, '');
});
function queueFixture() {
  let available = [order('first')], mine = [], drafts = [], failure = false, writes = false, reads = 0, pending;
  const p = harness('queue', async (url, options) => {
    if (options?.method) { writes = true; if (pending) await pending; throw Error('结果未知'); }
    reads++; if (failure) throw Error('网络错误');
    return ok(url.endsWith('/available') ? available : url.endsWith('/my') ? mine : drafts);
  });
  return { p, get reads() { return reads; }, set available(value) { available = value; }, set mine(value) { mine = value; }, set drafts(value) { drafts = value; }, set failure(value) { failure = value; }, set pending(value) { pending = value; } };
}
test('5: 20 second timer pauses when hidden, resumes once and cleans up on unmount', async () => {
  const f = queueFixture(); f.p.mount(); await tick(); assert.equal(f.p.timers.size, 1);
  const count = f.reads; await f.p.pulse(); assert.equal(f.reads, count + 3);
  f.p.visible(false); assert.equal(f.p.timers.size, 0); await f.p.pulse(); assert.equal(f.reads, count + 3);
  f.p.visible(true); f.p.visible(true); assert.equal(f.p.timers.size, 1);
  f.p.unmount(); assert.equal(f.p.timers.size, 0); assert.equal(f.p.listeners.size, 0);
});
test('5: baseline is silent; only newly available formal ids notify', async () => {
  const f = queueFixture(); f.p.mount(); await tick(); assert.equal(f.p.render().newOrderNotice, '');
  f.drafts = [{ id: 'draft' }]; await f.p.pulse(); assert.equal(f.p.render().newOrderNotice, '');
  f.available = [order('first'), order('already-active')]; f.mine = [{ ...order('already-active'), status: 'ACCEPTED' }];
  await f.p.pulse(); assert.equal(f.p.render().newOrderNotice, '');
  f.available = [order('first'), order('new')]; await f.p.pulse(); assert.match(f.p.render().newOrderNotice, /有 1 笔新订单/);
});
test('5: operation in flight and uncertain results skip polling; manual reconciliation clears protection', async () => {
  const f = queueFixture(); f.p.mount(); await tick(); let release;
  f.pending = new Promise(resolve => release = resolve);
  const action = f.p.render().patchOrder('first', 'accept', '接单成功');
  const count = f.reads; await f.p.pulse(); assert.equal(f.reads, count);
  release(); await action; assert.equal(f.p.render().uncertainIds.length, 1);
  const error = f.p.render().error; await f.p.pulse(); assert.equal(f.reads, count); assert.equal(f.p.render().error, error);
  await f.p.render().refreshQueues(); assert.equal(f.p.render().uncertainIds.length, 0); assert.equal(f.p.render().error, '');
  await f.p.pulse(); assert.equal(f.reads, count + 6);
});
test('5: failed automatic refresh preserves list and existing error; success does not erase error', async () => {
  const f = queueFixture(); f.p.mount(); await tick(); f.failure = true;
  await f.p.render().refreshQueues(); const error = f.p.render().error;
  await f.p.pulse(); assert.equal(f.p.render().error, error); assert.equal(f.p.render().availableOrders[0].id, 'first');
  f.failure = false; await f.p.pulse(); assert.equal(f.p.render().error, error);
});
test('5: overlapping timer ticks do not duplicate in-flight requests', async () => {
  let release, calls = 0, block = false;
  const pending = new Promise(resolve => release = resolve);
  const p = harness('queue', async () => { calls++; if (block) await pending; return ok([]); });
  p.mount(); await tick(); block = true; await p.pulse(); await p.pulse(); assert.equal(calls, 6); release(); await tick();
});
test('5: hidden/unmounted pending responses never replace queue', async () => {
  for (const action of ['hide', 'unmount']) {
    let release, block = false;
    const pending = new Promise(resolve => release = resolve);
    const p = harness('queue', async url => { if (block) await pending; return ok(url.endsWith('/available') ? [order(block ? 'later' : 'first')] : []); });
    p.mount(); await tick(); block = true; await p.pulse(); action === 'hide' ? p.visible(false) : p.unmount(); release(); await tick();
    assert.equal(p.render().availableOrders[0].id, 'first');
  }
});
test('6: public configuration trims configured values and has no legacy invite fallback', () => {
  const source = read('apps/api-server/src/modules/auth/auth.service.ts');
  const method = source.slice(source.indexOf('  getPublicConfig() {'), source.indexOf('  async createPlatformBindingCode'));
  for (const value of [undefined, '', '   ', 'https://example.com/configured']) {
    const context = { process: { env: { SUPPORT_KOOK_URL: value } }, output: null };
    vm.runInNewContext(`output = ({${method}}).getPublicConfig()`, context);
    assert.equal(context.output.support.orderKookUrl, value?.trim() || null);
    assert.equal(context.output.support.kookUrl, value?.trim() || null);
  }
});
test('6: orders fetch independent configured entry, empty configuration stays hidden', async () => {
  for (const value of [undefined, '', '   ', 'https://example.com/configured']) {
    const p = harness('orders', async url => ok(url.includes('public-config') ? { support: { orderKookUrl: value, kookUrl: 'https://example.com/legacy' } } : []));
    p.mount(); await tick(); assert.equal(p.render().kookUrl, value?.trim() || '');
  }
});
test('6: both rendered entries require configuration and exclude all three terminal statuses', () => {
  for (const file of ['apps/customer-web/app/orders/page.tsx', 'apps/customer-web/app/order/page.tsx']) {
    const source = read(file);
    assert.match(source, /kookUrl && !\["COMPLETED", "REFUNDED", "CANCELLED"\]\.includes\((?:order|view.receipt).status\)/);
    assert.match(source, /href=\{kookUrl\}[^>]+>去 KOOK 找陪玩<\/a>/);
  }
});
