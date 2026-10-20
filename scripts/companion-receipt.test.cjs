const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const { test } = require('node:test'), { createRequire } = require('node:module');
const root = process.env.DFC_COMPANION_SOURCE_ROOT || path.resolve(__dirname, '..');
const deps = createRequire(path.join(process.env.DFC_COMPANION_DEPENDENCY_ROOT || root, 'apps/companion-web/package.json'));
const ts = deps('typescript'), React = deps('react'), jsx = deps('react/jsx-runtime'), { renderToStaticMarkup } = deps('react-dom/server');
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const tick = () => new Promise(r => setImmediate(r));
const ok = data => ({ ok: true, json: async () => data });
function elements(node) { return !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(elements) : [node, ...elements(node.props?.children)]; }
function page(fetch) {
  let cursor = 0, refCursor = 0; const state = [], refs = [], effects = [], exports = {};
  const hooks = { ...React, useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial;
    return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
    useRef(initial) { const i = refCursor++; return refs[i] || (refs[i] = { current: initial }); }, useEffect: fn => effects.push(fn), useMemo: fn => fn() };
  const Wrapper = ({ children }) => React.createElement('div', null, children);
  const components = new Proxy({}, { get: (_, name) => name === 'OrderCard' ? props => React.createElement('article', null, props.order.id, props.order.status,
    React.createElement('button', { disabled: props.disabled, onClick: props.onAction }, props.action))
    : name === 'SectionHeader' ? ({ title, desc }) => React.createElement('header', null, title, desc) : Wrapper });
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'apps/companion-web/app/available-orders/page.tsx'), 'utf8')), {
    exports, fetch, document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    // A visible user page must not invalidate its initial queue read. Keep polling synthetic.
    setInterval: () => 1, clearInterval() {}, localStorage: { getItem: () => 'synthetic-session' },
    require: id => id === 'react' ? hooks : id === 'react/jsx-runtime' ? jsx : components
  });
  return { tree() { cursor = refCursor = 0; return exports.default(); }, all() { return elements(this.tree()); },
    html() { return renderToStaticMarkup(this.tree()); }, mount() { this.tree(); effects.splice(0).forEach(fn => fn()); } };
}
const assigned = { id: 'synthetic-order', orderNo: 'SYNTHETIC-ORDER', status: 'ASSIGNED', dispatchVersion: 3, mode: '娱乐', hours: '1', totalAmount: '100' };
const draft = { id: 'synthetic-draft', draftNo: 'SYNTHETIC-DRAFT', status: 'OPEN', canApply: true, game: 'DELTA_FORCE', mode: '娱乐', hours: '1', sourcePlatform: 'KOOK', customerDisplayName: 'Synthetic', estimatedPricePerHour: '100', candidatesCount: 0 };
const queues = url => url.endsWith('/available') ? [assigned] : url.endsWith('/drafts') ? [draft] : [];
const card = p => p.all().find(e => e.props?.order?.id === assigned.orderNo);
const button = (p, label) => p.all().find(e => e.props?.children === label && e.props?.onClick);
test('one click accepts once; confirmed success survives failed refresh and displays the next action', async () => {
  let writes = 0;
  const p = page(async (url, opts) => {
    if (opts?.method) { writes++; assert.equal(JSON.parse(opts.body).dispatchVersion, 3); return ok({ ...assigned, status: 'ACCEPTED' }); }
    if (writes) throw new Error('synthetic refresh failure'); return ok(queues(url));
  });
  p.mount(); await tick(); const accept = card(p).props.onAction; accept(); accept(); await tick();
  assert.equal(writes, 1); assert.match(p.html(), /SYNTHETIC-ORDER：接单成功/); assert.match(p.html(), /本笔操作已成功/);
  assert.equal(card(p).props.action, '开始服务'); assert.equal(button(p, '刷新核对').props.disabled, false);
});
test('lost response disables the old action until successful refresh reconciles the order', async () => {
  let writes = 0, reconciled = false;
  const p = page(async (url, opts) => {
    if (opts?.method) { writes++; throw new Error('synthetic lost response'); }
    return ok(reconciled ? url.endsWith('/my') ? [{ ...assigned, status: 'ACCEPTED' }] : [] : queues(url));
  });
  p.mount(); await tick(); card(p).props.onAction(); await tick();
  assert.equal(card(p).props.disabled, true); card(p).props.onAction(); await tick(); assert.equal(writes, 1);
  assert.match(p.html(), /本笔结果待核对/); assert.doesNotMatch(p.html(), /接单成功/);
  reconciled = true; button(p, '刷新核对').props.onClick(); await tick();
  assert.equal(card(p).props.action, '开始服务'); assert.equal(card(p).props.disabled, false);
});
test('empty or unrelated successful response never reports acceptance success', async () => {
  for (const data of [{}, { id: 'another', status: 'ACCEPTED' }, { id: assigned.id, status: 'COMPLETED' }]) {
    const p = page(async (url, opts) => ok(opts?.method ? data : queues(url))); p.mount(); await tick(); card(p).props.onAction(); await tick();
    assert.match(p.html(), /未收到本笔订单的有效回执/); assert.doesNotMatch(p.html(), /接单成功/); assert.equal(card(p).props.disabled, true);
  }
});
test('common backend conflicts are explained in Chinese with refresh as the next step', async () => {
  const p = page(async (url, opts) => opts?.method ? { ok: false, json: async () => ({ message: 'Order is assigned to another companion' }) } : ok(queues(url)));
  p.mount(); await tick(); card(p).props.onAction(); await tick(); assert.match(p.html(), /订单已由其他陪玩接单/); assert.doesNotMatch(p.html(), /assigned to another companion/);
});
test('draft application has its own receipt and stays submitted after failed refresh', async () => {
  let writes = 0;
  const p = page(async (url, opts) => {
    if (opts?.method) { writes++; return ok({ id: 'synthetic-candidate', draftId: draft.id }); }
    if (writes) throw new Error('synthetic refresh failure'); return ok(queues(url));
  });
  p.mount(); await tick(); const apply = button(p, '报名需求'); assert.ok(apply); apply.props.onClick(); apply.props.onClick(); await tick();
  assert.equal(writes, 1); assert.match(p.html(), /报名已提交/); assert.match(p.html(), /正式订单仍需点击接单/);
  assert.equal(button(p, '已报名').props.disabled, true);
});
test('draft unknown response retains the optional note and prevents immediate resubmission', async () => {
  const p = page(async (url, opts) => { if (opts?.method) throw new Error('synthetic lost response'); return ok(queues(url)); });
  p.mount(); await tick(); p.all().find(e => e.type === 'textarea').props.onChange({ target: { value: 'keep my note' } });
  button(p, '报名需求').props.onClick(); await tick(); assert.equal(p.all().find(e => e.type === 'textarea').props.value, 'keep my note');
  assert.equal(button(p, '报名需求').props.disabled, true); assert.match(p.html(), /报名结果待核对，备注已保留/);
});
test('real OrderCard passes its disabled flag through to the native button', () => {
  const source = fs.readFileSync(path.join(root, 'apps/companion-web/app/components.tsx'), 'utf8'), ast = ts.createSourceFile('c.tsx', source, ts.ScriptTarget.Latest, true), found = [];
  ts.forEachChild(ast, n => { if (ts.isFunctionDeclaration(n) && ['OrderCard', 'ActionButton', 'StatusBadge', 'statusTone', 'toOrderStatus'].includes(n.name?.getText(ast))) found.push(n.getText(ast)); });
  const exports = {}; vm.runInNewContext(compile(found.join('\n')), { exports, require: id => { assert.equal(id, 'react/jsx-runtime'); return jsx; } });
  const tree = exports.OrderCard({ order: { id: 'SYNTHETIC', mode: '娱乐', hours: 1, amount: 100, status: 'ASSIGNED' }, action: '接单', disabled: true });
  assert.match(renderToStaticMarkup(tree), /disabled=""/);
});
