const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const jsx = require('react/jsx-runtime');
const tick = () => new Promise(resolve => setImmediate(resolve));
const row = (id, onlineStatus = 'ONLINE') => ({ id, nickname: id, onlineStatus, pricePerHour: '30' });
const ready = () => ({ busy: false, connected: true, pending: false, error: '', companions: [row('off', 'OFFLINE'), row('on'), row('busy', 'BUSY')], preview: null, receipt: null, orders: [], availableBalance: '20' });

function harness(search = '', initial = ready(), config = {}, orders = [], entry = '../app/order/page.tsx') {
  const state = [], refs = [], effects = [], calls = [];
  let cursor = 0, refCursor = 0, view = initial;
  const hooks = { ...React,
    useState(value) { const i = cursor++; if (!(i in state)) state[i] = value; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
    useRef(value) { return refs[refCursor++] ||= { current: value }; },
    useEffect(fn) { effects.push(fn); },
  };
  const client = {
    state: () => view,
    customerSubject: () => view.connected ? 'synthetic-customer' : null,
    refresh: async () => { calls.push('refresh'); return view; },
    cancelPreview: () => (view = { ...view, preview: null }),
    beginNew: () => (view = { ...view, receipt: null, preview: null }),
    prepare: async selection => { calls.push(['prepare', selection]); return view = { ...view, preview: { ...selection, totalAmount: '30.00', unitPrice: '30.00' } }; },
    submit: async () => { calls.push('submit'); return view; },
  };
  const stub = props => React.createElement('div', props);
  const events = { addEventListener() {}, removeEventListener() {} };
  function load(relative) {
    const filename = path.resolve(__dirname, relative), exports = {};
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
    vm.runInNewContext(compiled.outputText, { exports, URLSearchParams, AbortController, setTimeout, clearTimeout,
      fetch: async url => { assert.ok(['/api/auth/public-config', '/api/orders/my'].includes(url)); return { ok: true, json: async () => url === '/api/orders/my' ? orders : config }; },
      localStorage: { getItem: () => 'test-only' }, document: { visibilityState: 'visible', ...events },
      window: { location: { search, origin: 'http://localhost' }, ...events }, require(id) {
      if (id === 'react') return hooks;
      if (id === 'react/jsx-runtime') return jsx;
      if (id === 'next/link') return 'a';
      if (id === 'next/navigation') return { useParams: () => ({ id: 'a&b' }) };
      if (id === './order-client') return { createOrderClient: () => client };
      if (id === './order-entry' || id === '../order/order-entry') return load('../app/order/order-entry.ts');
      if (id === './selection-draft') return load('../app/order/selection-draft.ts');
      if (id === '@dfc/ui') return { ...load('../../../packages/ui/src/order-record-client.ts'), ...load('../../../packages/ui/src/order-escrow.ts'), ...load('../../../packages/ui/src/guarantee.ts') };
      if (id.endsWith('/escrow')) return load('../app/escrow.tsx');
      if (id === '../guarantee-evidence') return load('../app/guarantee-evidence.tsx');
      if (id === './acceptance-countdown') return load('../app/orders/acceptance-countdown.tsx');
      if (id === './review-form') return load('../app/orders/review-form.tsx');
      if (id.endsWith('/components')) return new Proxy({}, { get: () => stub });
      if (id.endsWith('/data')) return { games: [] };
      if (id === './auth-gate') return { CustomerAuthGate: stub };
      if (id === './brand') return { MaycatLogo: stub };
      if (id === './demand-guide') return { default: stub };
      throw Error(`Unexpected import ${id}`);
    } });
    return exports;
  }
  const page = load(entry);
  function tree() { cursor = refCursor = 0; return page.default(); }
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children)];
  }
  const all = () => nodes(tree());
  const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : String(node ?? '');
  return { calls, state, load, nodes, text, all,
    mount() { tree(); effects.splice(0).forEach(fn => fn()); },
    htmlText: () => text(tree()),
    select: () => all().find(n => n.type === 'select' && n.props['aria-label'] === '陪玩'),
    button: label => all().find(n => n.type === 'button' && text(n).startsWith(label)),
    setView(next) { view = next; },
  };
}

test('entry loads once, waits for explicit preview, and preserves manual selection on refresh', async () => {
  const p = harness('?companionId=on'); p.mount(); await tick();
  assert.equal(p.select().props.value, 'on');
  assert.deepEqual(p.calls, ['refresh']);
  p.select().props.onChange({ target: { value: 'busy' } });
  p.button('刷新核对').props.onClick(); await tick();
  assert.equal(p.select().props.value, 'busy');
  p.button('核对订单金额').props.onClick(); await tick();
  assert.equal(p.calls.at(-1)[1].companionId, 'busy');
  assert.ok(p.button('确认提交').props.disabled);
  assert.match(p.htmlText(), /余额还差 ¥10.00，先去充值/);
  assert.ok(p.all().some(n => n.type === 'a' && n.props.href === '/recharge' && p.text(n) === '去充值'));
  p.button('确认提交').props.onClick(); await tick();
  assert.ok(!p.calls.includes('submit'));
});

test('invalid entry gives a clear message which clears after manual selection', async () => {
  const p = harness('?companionId=missing'); p.mount(); await tick();
  assert.equal(p.select().props.value, '');
  assert.match(p.htmlText(), /这位陪玩暂时不能下单，请另选/);
  p.select().props.onChange({ target: { value: 'on' } });
  assert.doesNotMatch(p.htmlText(), /这位陪玩暂时不能下单/);
});

test('reorder entry prefills companion, mode and hours but still waits for explicit preview', async () => {
  const p = harness(`?companionId=on&mode=${encodeURIComponent('全面战场')}&hours=3`); p.mount(); await tick();
  const field = label => p.all().find(n => n.type === 'select' && n.props['aria-label'] === label);
  assert.equal(p.select().props.value, 'on');
  assert.equal(field('模式').props.value, '全面战场');
  assert.equal(field('时长').props.value, '3');
  assert.match(p.htmlText(), /已带入上一单的陪玩、模式和时长，请重新核对状态与金额/);
  assert.deepEqual(p.calls, ['refresh']);
  p.button('核对订单金额').props.onClick(); await tick();
  assert.equal(p.calls.at(-1)[1].mode, '全面战场');
  assert.equal(p.calls.at(-1)[1].hours, '3');
  assert.ok(!p.calls.includes('submit'));
});

test('reorder entry keeps valid mode and hours when the companion is unavailable and ignores invalid options', async () => {
  const gone = harness(`?companionId=missing&mode=${encodeURIComponent('全面战场')}&hours=2`); gone.mount(); await tick();
  const field = (p, label) => p.all().find(n => n.type === 'select' && n.props['aria-label'] === label);
  assert.equal(gone.select().props.value, '');
  assert.equal(field(gone, '模式').props.value, '全面战场');
  assert.equal(field(gone, '时长').props.value, '2');
  assert.match(gone.htmlText(), /这位陪玩暂时不能下单，请另选；模式和时长已带入/);
  const bad = harness('?companionId=on&mode=hack&hours=9'); bad.mount(); await tick();
  assert.equal(bad.select().props.value, 'on');
  assert.equal(field(bad, '模式').props.value, '烽火地带');
  assert.equal(field(bad, '时长').props.value, '1');
  assert.match(bad.htmlText(), /已带入当前入口的陪玩，请重新核对状态与金额；链接中的部分选项无效，已忽略。/);
});

test('my orders shows reorder link only on completed orders', async () => {
  const orders = ['COMPLETED', 'AWAITING_ACCEPTANCE', 'REFUNDED'].map((status, i) => ({ id: `o${i}`, orderNo: `n${i}`, status, companionId: 'on', companion: { displayName: '小鹿' }, mode: '烽火地带', hours: '2', totalAmount: '60' }));
  const p = harness('', ready(), {}, orders, '../app/orders/page.tsx'); p.mount(); await tick();
  const links = p.all().filter(n => n.type === 'a' && p.text(n).startsWith('再来一单'));
  assert.equal(links.length, 1);
  assert.equal(p.text(links[0]), '再来一单（小鹿）');
  assert.equal(links[0].props.href, `/order?companionId=on&mode=${encodeURIComponent('烽火地带')}&hours=2`);
});

test('no entry preserves placeholder and pending recovery never auto-selects later', async () => {
  const normal = harness(); normal.mount(); await tick(); assert.equal(normal.select().props.value, '');
  const p = harness('?companionId=on', { ...ready(), pending: true }); p.mount(); await tick();
  assert.equal(p.select().props.value, ''); assert.equal(p.select().props.disabled, true);
  p.setView(ready()); p.button('刷新核对').props.onClick(); await tick();
  assert.equal(p.select().props.value, '');
});

test('failed initial load can refresh successfully before applying entry', async () => {
  const p = harness('?companionId=on', { ...ready(), error: '加载失败', companions: [] }); p.mount(); await tick();
  assert.equal(p.select().props.value, '');
  assert.doesNotMatch(p.htmlText(), /这位陪玩暂时不能下单/);
  p.setView(ready()); p.button('刷新核对').props.onClick(); await tick();
  assert.equal(p.select().props.value, 'on');
});

test('dropdown is sorted with Chinese states; busy/offline warning does not block preview', async () => {
  const p = harness(); p.mount(); await tick();
  const options = p.nodes(p.select()).filter(n => n.type === 'option');
  assert.deepEqual(options.map(n => n.props.value), ['', 'on', 'busy', 'off']);
  assert.match(p.text(options), /on · 在线.*busy · 忙碌.*off · 离线/);
  for (const id of ['busy', 'off']) {
    p.select().props.onChange({ target: { value: id } });
    assert.match(p.htmlText(), /这位陪玩现在不在线，接单可能较慢/);
    assert.equal(p.button('核对订单金额').props.disabled, false);
  }
  p.select().props.onChange({ target: { value: 'on' } });
  assert.doesNotMatch(p.htmlText(), /这位陪玩现在不在线/);
});

for (const balance of ['30', '31', '']) test(`confirmation remains available with balance ${balance || 'unknown'}`, async () => {
  const p = harness('?companionId=on', { ...ready(), availableBalance: balance }); p.mount(); await tick();
  p.button('核对订单金额').props.onClick(); await tick();
  assert.equal(p.button('确认提交').props.disabled, false);
  assert.doesNotMatch(p.htmlText(), /余额还差/);
  p.button('确认提交').props.onClick(); await tick();
  assert.ok(p.calls.includes('submit'));
});

test('both card and detail order links encode the actual companion id', () => {
  const p = harness();
  const companion = { ...row('a&b'), modes: [], tags: [], skillModes: [], games: [], game: 'DELTA_FORCE', voicePreference: 'TEXT_ONLY' };
  const card = p.load('../app/components.tsx').CompanionCard({ companion });
  assert.ok(p.nodes(card).some(n => n.props?.href === '/order?companionId=a%26b'));
  p.state[0] = companion; p.state[1] = {}; p.state[2] = '';
  const detail = p.load('../app/companions/[id]/page.tsx').default();
  assert.ok(p.nodes(detail).some(n => n.props?.href === '/order?companionId=a%26b'));
});

for (const status of ['PAID', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'AWAITING_ACCEPTANCE', 'DISPUTED', 'COMPLETED', 'REFUNDED', 'CANCELLED']) {
  test(`receipt KOOK entry respects status ${status} and configured address`, async () => {
    const p = harness('', { ...ready(), receipt: { orderNo: 'demo', status, totalAmount: '30' } }, { support: { orderKookUrl: 'https://example.com/order-room' } });
    p.mount(); await tick();
    const links = p.all().filter(n => n.type === 'a' && p.text(n) === '去 KOOK 找陪玩');
    assert.equal(links.length, ['COMPLETED', 'REFUNDED', 'CANCELLED'].includes(status) ? 0 : 1);
    if (links.length) assert.equal(links[0].props.href, 'https://example.com/order-room');
  });
}
for (const orderKookUrl of [undefined, null, '', '   ']) test(`receipt hides unconfigured KOOK entry (${orderKookUrl})`, async () => {
  const p = harness('', { ...ready(), receipt: { orderNo: 'demo', status: 'PAID', totalAmount: '30' } }, { support: { orderKookUrl, kookUrl: 'https://example.com/legacy' } });
  p.mount(); await tick(); assert.doesNotMatch(p.htmlText(), /去 KOOK 找陪玩/);
});

for (const status of ['PAID', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'AWAITING_ACCEPTANCE', 'DISPUTED', 'COMPLETED', 'REFUND_REQUESTED', 'REFUNDED', 'CANCELLED', 'UNKNOWN']) test(`my orders renders companion, next step and KOOK entry for ${status}`, async () => {
  const orders = [{ id: 'one', orderNo: 'demo', status, companion: { displayName: '小鹿' }, hours: '1', totalAmount: '30' }];
  const p = harness('', ready(), { support: { orderKookUrl: 'https://example.com/order-room' } }, orders, '../app/orders/page.tsx');
  p.mount(); await tick(); assert.match(p.htmlText(), /陪玩：小鹿/);
  const expected = { PAID: '等待客服', ASSIGNED: '等待陪玩', ACCEPTED: '开始时间', IN_PROGRESS: '正在服务', AWAITING_ACCEPTANCE: '确认验收', DISPUTED: '等待客服处理', COMPLETED: '订单已完成', REFUND_REQUESTED: '等待人工核对退款申请', REFUNDED: '已退回站内余额', CANCELLED: '订单已取消', UNKNOWN: '订单状态待核对' };
  assert.match(p.htmlText(), new RegExp(expected[status]));
  const links = p.all().filter(n => n.type === 'a' && p.text(n) === '去 KOOK 找陪玩');
  assert.equal(links.length, ['COMPLETED', 'REFUNDED', 'CANCELLED'].includes(status) ? 0 : 1);
  if (links.length) assert.equal(links[0].props.href, 'https://example.com/order-room');
  assert.ok(p.button('刷新订单'));
});
for (const orderKookUrl of [undefined, null, '', '   ']) test(`my orders hides missing KOOK config (${orderKookUrl}) and shows unassigned`, async () => {
  const orders = [{ id: 'one', orderNo: 'demo', status: 'PAID', companion: null, hours: '1', totalAmount: '30' }];
  const p = harness('', ready(), { support: { orderKookUrl, kookUrl: 'https://example.com/legacy' } }, orders, '../app/orders/page.tsx');
  p.mount(); await tick(); assert.match(p.htmlText(), /陪玩：待分配/); assert.doesNotMatch(p.htmlText(), /去 KOOK 找陪玩/);
  orders.push({ ...orders[0], id: 'two', orderNo: 'refreshed' });
  p.button('刷新订单').props.onClick(); await tick(); assert.match(p.htmlText(), /refreshed/);
});
