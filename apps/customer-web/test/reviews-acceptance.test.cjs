const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const jsx = require('react/jsx-runtime');
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(file, fetch = async () => ({ ok: true, json: async () => ({}) })) {
  let cursor = 0, refCursor = 0;
  const state = [], refs = [], effects = [], cleanups = [], timers = new Map();
  const hooks = { ...React,
    useState(value) { const i = cursor++; if (!(i in state)) state[i] = value; return [state[i], next => state[i] = typeof next === 'function' ? next(state[i]) : next]; },
    useEffect(fn) { effects.push(fn); },
    useRef(value) { return refs[refCursor++] ||= { current: value }; }
  };
  const filename = path.resolve(__dirname, file), exports = {};
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const recordExports = {};
  const recordCode = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../../../packages/ui/src/order-record-client.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  vm.runInNewContext(recordCode, { exports: recordExports, AbortController, setTimeout, clearTimeout });
  const events = { addEventListener() {}, removeEventListener() {} };
  vm.runInNewContext(code, { exports, Date, Number, fetch, process: { env: {} }, localStorage: { getItem: () => 'synthetic' },
    window: { location: { search: '' }, ...events }, document: { visibilityState: 'visible', ...events }, URLSearchParams,
    setInterval(fn, delay) { timers.set(1, { fn, delay }); return 1; }, clearInterval(id) { timers.delete(id); },
    require(id) {
      if (id === 'react') return hooks;
      if (id === 'react/jsx-runtime') return jsx;
      if (id === '@dfc/ui') return recordExports;
      if (id === 'next/navigation') return { useParams: () => ({ id: 'companion' }) };
      if (id.endsWith('/data')) return { games: [] };
      return new Proxy(function Stub(props) { return props.children; }, { get: () => props => props.children });
    }
  });
  return { exports, timers,
    render(name, props) { cursor = refCursor = 0; return exports[name](props); },
    mount() { effects.splice(0).forEach(fn => cleanups.push(fn())); },
    unmount() { cleanups.forEach(fn => fn?.()); }
  };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree === null || tree === undefined || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  return text(tree.props?.children);
}

test('7: review form requires stars, sends selected integer and optional comment once successful', async () => {
  const calls = []; let reloads = 0;
  const p = harness('../app/orders/review-form.tsx', async (url, init) => { calls.push([url, JSON.parse(init.body)]); return { ok: true, json: async () => ({ id: 'review' }) }; });
  const render = () => p.render('ReviewForm', { orderId: 'order', onSubmitted: async () => { reloads++; } });
  assert.equal(nodes(render()).find(n => n.type === 'button').props.disabled, true);
  nodes(render()).find(n => n.type === 'select').props.onChange({ target: { value: '4' } });
  render().props.onSubmit({ preventDefault() {} }); await tick();
  assert.deepEqual(calls, [['/api/orders/order/review', { stars: 4, comment: '' }]]);
  assert.equal(reloads, 1); assert.match(text(render()), /已评价/);
});

test('7: review form blocks 201 characters, accepts 200 Unicode characters', () => {
  const p = harness('../app/orders/review-form.tsx');
  const render = () => p.render('ReviewForm', { orderId: 'order', onSubmitted: async () => {} });
  nodes(render()).find(n => n.type === 'select').props.onChange({ target: { value: '5' } });
  nodes(render()).find(n => n.type === 'textarea').props.onChange({ target: { value: '😀'.repeat(201) } });
  assert.equal(nodes(render()).find(n => n.type === 'button').props.disabled, true);
  nodes(render()).find(n => n.type === 'textarea').props.onChange({ target: { value: '😀'.repeat(200) } });
  assert.equal(nodes(render()).find(n => n.type === 'button').props.disabled, false);
});

test('7: failed submission shows error without claiming success', async () => {
  const p = harness('../app/orders/review-form.tsx', async () => ({ ok: false, json: async () => ({ message: '该订单已经评价' }) }));
  const render = () => p.render('ReviewForm', { orderId: 'order', onSubmitted: async () => assert.fail('must not reload on rejection') });
  nodes(render()).find(n => n.type === 'select').props.onChange({ target: { value: '1' } });
  render().props.onSubmit({ preventDefault() {} }); await tick();
  assert.match(text(render()), /该订单已经评价/);
  assert.equal(nodes(render()).some(n => n.type === 'button'), true);
});

test('7: companion cards show real rating/count and no-review wording', () => {
  const p = harness('../app/components.tsx');
  const companion = { id: 'c', nickname: 'synthetic', modes: [], tags: [], price: 10, orders: 2, rating: '4.5' };
  assert.match(text(p.render('CompanionCard', { companion })), /4.5 \/ 2条评价/);
  assert.match(text(p.render('CompanionCard', { companion: { ...companion, orders: 0, rating: '暂无评价' } })), /暂无评价/);
});

test('7: detail page renders fetched review summary and visible comments', async () => {
  const companion = { id: 'companion', nickname: 'synthetic', skillModes: [], averageRating: 4.5, reviewCount: 2, reviews: [{ stars: 5, comment: 'visible', createdAt: '2026-10-13T00:00:00Z' }] };
  const p = harness('../app/companions/[id]/page.tsx', async url => ({ ok: true, json: async () => url.includes('companions') ? [companion] : {} }));
  p.render('default'); p.mount(); await tick();
  const tree = p.render('default');
  assert.ok(nodes(tree).some(n => n.props?.value === '4.5分 / 2条评价'));
  assert.match(text(tree), /visible/);
});

test('8: countdown shows remaining time, exact deadline processing and safe missing timestamp', () => {
  const { countdownText } = harness('../app/orders/acceptance-countdown.tsx').exports;
  const now = Date.parse('2026-10-13T00:00:00Z');
  assert.equal(countdownText('2026-10-15T00:00:00Z', now), '还有48小时0分钟自动验收');
  assert.match(countdownText('2026-10-13T00:00:01Z', now), /0小时1分钟/);
  assert.match(countdownText('2026-10-13T00:00:00Z', now), /系统处理中/);
  assert.match(countdownText(null, now), /暂不可用/);
  assert.match(countdownText('invalid', now), /暂不可用/);
});

test('8: countdown refreshes every 15 seconds and clears timer on unmount', () => {
  const p = harness('../app/orders/acceptance-countdown.tsx');
  p.render('AcceptanceCountdown', { dueAt: new Date(Date.now() + 3600000).toISOString() }); p.mount();
  assert.equal(p.timers.get(1).delay, 15000);
  p.timers.get(1).fn();
  p.unmount(); assert.equal(p.timers.size, 0);
});

test('7/8: actual orders page gates review and countdown by order status; receipt guidance matches', async () => {
  const rows = [{ id: 'a', status: 'AWAITING_ACCEPTANCE', totalAmount: '1', autoAcceptanceDueAt: '2026-10-15T00:00:00Z' },
    { id: 'b', status: 'COMPLETED', totalAmount: '1', hasReview: false }, { id: 'c', status: 'COMPLETED', totalAmount: '1', hasReview: true }, { id: 'd', status: 'CANCELLED', totalAmount: '1' }];
  const p = harness('../app/orders/page.tsx', async url => ({ ok: true, json: async () => url.includes('public-config') ? {} : rows }));
  p.render('default'); p.mount(); await tick();
  const tree = p.render('default');
  // ReviewForm is the node carrying both orderId and onSubmitted; evidence panels also receive orderId.
  assert.deepEqual(nodes(tree).filter(n => n.props?.orderId && n.props?.onSubmitted).map(n => n.props.orderId), ['b']);
  assert.equal(nodes(tree).filter(n => n.props?.dueAt).length, 1);
  assert.match(text(tree), /已评价/);
  const receipt = fs.readFileSync(path.resolve(__dirname, '../app/order/page.tsx'), 'utf8');
  assert.match(receipt, /自动验收倒计时/); assert.match(receipt, /未处理投诉会阻止自动验收/); assert.match(receipt, /每单只能评价一次/);
});
