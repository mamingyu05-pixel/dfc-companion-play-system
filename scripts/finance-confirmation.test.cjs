const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const root = process.env.DFC_FINANCE_SOURCE_ROOT || path.resolve(__dirname, '..');
const deps = createRequire(path.join(process.env.DFC_FINANCE_DEPENDENCY_ROOT || root, 'apps/admin-web/package.json'));
const ts = deps('typescript'), React = deps('react'), jsx = deps('react/jsx-runtime');
const { renderToStaticMarkup } = deps('react-dom/server');
const compile = s => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
const ok = value => ({ ok: true, json: async () => value });
function elements(node) { return !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(elements)
  : [node, ...elements(node.props?.children), ...elements(node.props?.rows)]; }
function page(name, fetch, confirm = () => true) {
  const state = [], refs = [], effects = []; let cursor = 0, refCursor = 0;
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }]; },
    useMemo: fn => fn(), useEffect: fn => effects.push(fn), useRef(initial) { const i = refCursor++; return refs[i] || (refs[i] = { current: initial }); }
  };
  const Wrapper = ({ children }) => React.createElement('div', null, children);
  const components = new Proxy({}, { get: (_, name) => name === 'DataTable' ? ({ rows }) => React.createElement('div', null, ...rows.flat())
    : name === 'SectionHeader' ? ({ title }) => React.createElement('header', null, title) : Wrapper });
  const modules = new Map();
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative);
    const exports = {}; modules.set(relative, exports);
    vm.runInNewContext(compile(fs.readFileSync(path.join(root, relative), 'utf8')), {
      exports, fetch, localStorage: { getItem: () => 'synthetic-session' }, window: { confirm },
      require(id) {
        if (id === 'react') return hooks;
        if (id === 'react/jsx-runtime') return jsx;
        if (id === 'next/link') return Wrapper;
        if (id === '../components') return components;
        if (id.startsWith('.')) {
          const target = path.join(path.dirname(relative), id);
          const found = [target, target + '.ts', target + '.tsx'].find(file => fs.existsSync(path.join(root, file)));
          if (found) return load(found);
        }
        throw new Error(`Unexpected finance fixture import: ${id}`);
      }
    });
    return exports;
  }
  const exports = load(`apps/admin-web/app/${name}/page.tsx`);
  return { tree() { cursor = refCursor = 0; return exports.default(); }, all() { return elements(this.tree()); },
    html() { return renderToStaticMarkup(this.tree()); }, mount() { this.tree(); effects.splice(0).forEach(fn => fn()); } };
}
const recharges = ['a', 'b'].map((id, i) => ({ id, status: 'PENDING', amount: String(100 + i * 50), screenshotUrl: '', createdAt: '2026-01-01',
  customer: { id: `customer-${id}`, displayName: `客户${id}`, email: `${id}@example.invalid`, availableBalance: '0' } }));
const withdrawals = ['a', 'b'].map((id, i) => ({ id, status: 'APPROVED', amount: String(50 + i * 20), payoutAccount: `synthetic-account-${id}`, createdAt: '2026-01-01',
  companion: { displayName: `陪玩${id}`, email: `${id}@example.invalid`, availableIncome: '100', frozenIncome: '50' } }));
const input = (p, label, value) => { const e = p.all().find(e => e.props?.['aria-label'] === label); assert.ok(e, label); e.props.onChange({ target: { value } }); };
const button = (p, label, index = 0) => p.all().filter(e => e.props?.children === label && e.props?.onClick)[index];
test('recharge confirmation uses this row identity/amount/note; cancel sends no request', async () => {
  let writes = 0, confirmation = '';
  const p = page('recharges', async (_, o) => { if (o?.method) writes++; return ok(recharges); }, message => { confirmation = message; return false; });
  p.mount(); await tick(); input(p, '审核备注 a', 'a备注'); input(p, '审核备注 b', 'b备注');
  button(p, '通过', 1).props.onClick(); await tick();
  assert.equal(writes, 0); assert.match(confirmation, /客户b/); assert.match(confirmation, /150.00/); assert.match(confirmation, /b备注/); assert.doesNotMatch(confirmation, /a备注/);
});
test('recharge success then failed list refresh stays committed and does not clear another row note', async () => {
  let reads = 0, writes = 0, sent;
  const p = page('recharges', async (_, opts) => {
    if (opts?.method) { writes++; sent = JSON.parse(opts.body); return ok({ id: 'b', status: 'APPROVED' }); }
    if (++reads > 1) throw new Error('synthetic refresh failure'); return ok(recharges);
  });
  p.mount(); await tick(); input(p, '审核备注 a', 'preserve-a'); input(p, '审核备注 b', 'only-b');
  const action = button(p, '通过', 1); action.props.onClick(); action.props.onClick(); await tick();
  assert.equal(writes, 1); assert.equal(sent.note, 'only-b'); assert.match(p.html(), /本笔操作已成功/);
  assert.equal(p.all().find(e => e.props?.['aria-label'] === '审核备注 a').props.value, 'preserve-a');
  assert.equal(p.all().filter(e => e.props?.children === '通过' && e.props?.onClick).length, 1);
});
test('unknown recharge response retains note and blocks that row until a successful refresh', async () => {
  let writes = 0;
  const p = page('recharges', async (_, opts) => { if (opts?.method) { writes++; throw new Error('lost response'); } return ok(recharges); });
  p.mount(); await tick(); input(p, '审核备注 a', 'keep'); button(p, '通过').props.onClick(); await tick();
  assert.equal(button(p, '通过').props.disabled, true); button(p, '通过').props.onClick(); await tick(); assert.equal(writes, 1);
  assert.equal(p.all().find(e => e.props?.['aria-label'] === '审核备注 a').props.value, 'keep');
  button(p, '刷新').props.onClick(); await tick(); assert.equal(button(p, '通过').props.disabled, false);
});
test('withdrawal requires this row transfer reference, then confirms this recipient and amount', async () => {
  let writes = 0, confirmation = '', sent;
  const p = page('withdrawals', async (_, opts) => { if (opts?.method) { writes++; sent = JSON.parse(opts.body); return ok({ id: 'b', status: 'PAID' }); } return ok(withdrawals); }, m => { confirmation = m; return true; });
  p.mount(); await tick(); input(p, '打款流水号 a', 'synthetic-ref-a'); input(p, '审核备注 b', 'only-b');
  button(p, '确认打款', 1).props.onClick(); await tick(); assert.equal(writes, 0);
  input(p, '打款流水号 b', 'synthetic-ref-b'); button(p, '确认打款', 1).props.onClick(); await tick();
  assert.equal(writes, 1); assert.equal(sent.payoutReference, 'synthetic-ref-b'); assert.equal(sent.note, 'only-b');
  assert.match(confirmation, /陪玩b/); assert.match(confirmation, /70.00/); assert.match(confirmation, /synthetic-account-b/); assert.match(confirmation, /synthetic-ref-b/);
});
test('cancel withdrawal confirmation makes no payment-review request and retains fields', async () => {
  let writes = 0;
  const p = page('withdrawals', async (_, opts) => { if (opts?.method) writes++; return ok(withdrawals); }, () => false);
  p.mount(); await tick(); input(p, '打款流水号 b', 'keep-b'); button(p, '确认打款', 1).props.onClick(); await tick();
  assert.equal(writes, 0); assert.equal(p.all().find(e => e.props?.['aria-label'] === '打款流水号 b').props.value, 'keep-b');
});
test('empty or mismatched successful response cannot report a finance operation as successful', async () => {
  for (const response of [{}, { id: 'another', status: 'APPROVED' }, { id: 'a', status: 'REJECTED' }]) {
    const p = page('recharges', async (_, opts) => ok(opts?.method ? response : recharges));
    p.mount(); await tick(); button(p, '通过').props.onClick(); await tick();
    assert.match(p.html(), /结果待核对/); assert.doesNotMatch(p.html(), /本笔充值已通过/); assert.equal(button(p, '通过').props.disabled, true);
  }
});
const pending = {};
vm.runInNewContext(compile(fs.readFileSync(path.join(__dirname, '../apps/admin-web/app/order-drafts/pending-direct-order.ts'), 'utf8')), { exports: pending });
function storage() { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }; }
test('direct order lost response and reload retain original request ID and payload', () => {
  const store = storage(), body = { customerId: 'synthetic-customer', companionIds: ['synthetic-companion'], mode: 'game', hours: '1' };
  const first = pending.prepareDirectOrder(store, body, () => 'synthetic-request-0001');
  const loaded = pending.readPendingDirectOrder(store);
  assert.equal(loaded.requestId, first.requestId);
  assert.equal(pending.prepareDirectOrder(store, body, () => { throw new Error('must not generate again'); }).requestId, first.requestId);
  assert.throws(() => pending.prepareDirectOrder(store, { ...body, hours: '2' }, () => 'never'), /原请求/);
  pending.acknowledgeDirectOrder(store, 'wrong-request'); assert.ok(pending.readPendingDirectOrder(store));
  pending.acknowledgeDirectOrder(store, first.requestId); assert.equal(pending.readPendingDirectOrder(store), null);
});
test('storage refusal fails before creating a request; malformed persisted context cannot be discarded', () => {
  assert.throws(() => pending.prepareDirectOrder({ getItem: () => null, setItem: () => { throw new Error('blocked'); } }, {}, () => 'synthetic-request-0001'), /blocked/);
  assert.throws(() => pending.readPendingDirectOrder({ getItem: () => '{"requestId":"short"}' }), /记录异常/);
});
function submission(callApi, loadData = async () => {}) {
  const source = fs.readFileSync(path.join(root, 'apps/admin-web/app/order-drafts/page.tsx'), 'utf8');
  const ast = ts.createSourceFile('s.tsx', source, ts.ScriptTarget.Latest, true); let method;
  function visit(n) { if (ts.isFunctionDeclaration(n) && n.name?.getText(ast) === 'submitDirectOrder') method = n.getText(ast); ts.forEachChild(n, visit); }
  visit(ast); assert.ok(method, 'original order request submission path');
  const store = storage(), request = pending.prepareDirectOrder(store, { customerId: 'synthetic-customer', companionIds: ['synthetic-companion'], mode: 'game', hours: '1' }, () => 'synthetic-request-0001');
  let error = '', status = ''; const exports = {};
  vm.runInNewContext(compile(`${method}\nexports.submit = submitDirectOrder;`), {
    exports, callApi, loadData, sessionStorage: store, acknowledgeDirectOrder: pending.acknowledgeDirectOrder,
    directBusy: { current: false }, setDirectSubmitting: () => {}, setPendingDirect: () => {}, setDirectCompanionIds: () => {}, setForm: () => {},
    setError: value => { error = value; }, setStatus: value => { status = value; }
  });
  return { submit: () => exports.submit(request), pending: () => pending.readPendingDirectOrder(store), error: () => error, status: () => status };
}
test('direct order duplicate click is suppressed and lost response preserves exact retry payload', async () => {
  let calls = 0, firstBody;
  const f = submission(async (_, options) => { calls++; firstBody ??= options.body; assert.equal(options.body, firstBody); throw new Error('lost response'); });
  await Promise.all([f.submit(), f.submit()]); assert.equal(calls, 1); assert.ok(f.pending());
  await f.submit(); assert.equal(calls, 2); assert.ok(f.pending()); assert.match(f.error(), /结果待确认/);
});
test('direct order valid acknowledgement survives refresh failure; empty success stays unresolved', async () => {
  const good = submission(async () => ({ orderGroup: { groupNo: 'synthetic-group' } }), async () => { throw new Error('refresh failure'); });
  await good.submit(); assert.equal(good.pending(), null); assert.match(good.status(), /synthetic-group/); assert.match(good.error(), /订单已确认/);
  const empty = submission(async () => ({})); await empty.submit(); assert.ok(empty.pending()); assert.equal(empty.status(), '');
});
test('only an explicit server not-committed outcome releases a rejected direct-order request', async () => {
  const rejected = submission(async () => { throw Object.assign(new Error('synthetic validation rejection'), { requestNotCommitted: true }); });
  await rejected.submit(); assert.equal(rejected.pending(), null); assert.match(rejected.error(), /确认本笔未成单/);
  const unknown = submission(async () => { throw new Error('plain 400 or proxy error'); });
  await unknown.submit(); assert.ok(unknown.pending()); assert.match(unknown.error(), /结果待确认/);
});
test('shared ActionButton forwards disabled to the native button', () => {
  const source = fs.readFileSync(path.join(root, 'apps/admin-web/app/components.tsx'), 'utf8');
  const ast = ts.createSourceFile('components.tsx', source, ts.ScriptTarget.Latest, true); let fn;
  ts.forEachChild(ast, n => { if (ts.isFunctionDeclaration(n) && n.name?.getText(ast) === 'ActionButton') fn = n.getText(ast); });
  assert.ok(fn); const exports = {};
  vm.runInNewContext(compile(fn), { exports, require: id => { assert.equal(id, 'react/jsx-runtime'); return jsx; } });
  const button = exports.ActionButton({ children: 'synthetic action', disabled: true, onClick: () => {} });
  assert.equal(button.type, 'button'); assert.equal(button.props.disabled, true);
  assert.match(renderToStaticMarkup(button), /disabled=""/);
  assert.equal(exports.ActionButton({ children: 'enabled' }).props.disabled, false);
});
