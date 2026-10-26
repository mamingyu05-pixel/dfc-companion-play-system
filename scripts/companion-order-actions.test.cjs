const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { test } = require('node:test'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), deps = createRequire(path.join(root, 'apps/companion-web/package.json'));
const ts = deps('typescript'), React = deps('react'), jsx = deps('react/jsx-runtime');
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const initialOrder = status => ({ id: 'synthetic-order', orderNo: 'SYNTHETIC-ORDER', status, mode: '烽火地带', hours: '1', totalAmount: '100.00', customer: { displayName: '合成客户' } });
function fixture(status = 'ACCEPTED') {
  const f = { orders: [initialOrder(status)], writes: [], reads: 0, failRead: false, token: 'synthetic-token-a', listeners: new Map(),
    post: async () => response({ id: 'synthetic-order', status: 'IN_PROGRESS' }) };
  f.fetch = async (url, init = {}) => {
    if (init.method === 'PATCH') { f.writes.push({ url, token: init.headers.Authorization }); return f.post(url, init); }
    if (url === '/api/orders/companion/my') { f.reads++; if (f.failRead) throw Error('synthetic read failure'); return f.listResponse ? f.listResponse() : response(f.orders); }
    throw Error(`Unexpected synthetic request: ${url}`);
  };
  return f;
}
function page(f) {
  const slots = [], effects = [], modules = new Map(); let cursor = 0;
  const hooks = { ...React,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef(initial) { const index = cursor++; return slots[index] || (slots[index] = { current: initial }); },
    useMemo: fn => fn(),
    useEffect(fn, dependencies) { const index = cursor++, previous = slots[index];
      if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { dependencies, cleanup: fn() }; });
      } },
  };
  const add = (name, callback) => { const entries = f.listeners.get(name) || new Set(); entries.add(callback); f.listeners.set(name, entries); };
  const remove = (name, callback) => f.listeners.get(name)?.delete(callback);
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      transformers: { before: [context => {
        const visit = node => {
          if (ts.isFunctionDeclaration(node) && node.name?.text === 'CompanionOrdersPage') {
            const capture = ts.factory.createExpressionStatement(ts.factory.createBinaryExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('exports'), '__updateOrder'), ts.SyntaxKind.EqualsToken, ts.factory.createIdentifier('updateOrder')));
            return ts.factory.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type,
              ts.factory.updateBlock(node.body, [capture, ...node.body.statements]));
          }
          return ts.visitEachChild(node, visit, context);
        };
        return node => ts.visitNode(node, visit);
      }] } });
    const Wrapper = ({ children }) => React.createElement('div', null, children);
    vm.runInNewContext(compiled.outputText, { exports, fetch: f.fetch, AbortController, setTimeout, clearTimeout,
      localStorage: { getItem: () => f.token },
      window: { addEventListener: add, removeEventListener: remove },
      document: { visibilityState: 'visible', addEventListener: add, removeEventListener: remove },
      require(id) {
        if (id === 'react') return hooks;
        if (id === 'react/jsx-runtime') return jsx;
        if (id === 'next/link') return Wrapper;
        if (id === '../components') return new Proxy({}, { get: () => Wrapper });
        if (id === '../guarantee-evidence') return { GuaranteeEvidencePanel: () => null };
        if (id === '@dfc/ui') return load('packages/ui/src/index.ts');
        if (id.startsWith('.')) {
          const target = path.join(path.dirname(file), id);
          const found = [target, target + '.ts', target + '.tsx'].find(candidate => fs.existsSync(path.join(root, candidate)));
          if (found) return load(found);
        }
        throw Error(`Unexpected fixture import: ${id}`);
      }
    });
    return exports;
  }
  const exports = load('apps/companion-web/app/orders/page.tsx');
  const elements = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(elements) : [value, ...elements(value.props?.children)];
  const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : String(value ?? '');
  const p = { tree() { cursor = 0; return exports.default(); }, all() { return elements(this.tree()); }, text() { return text(this.tree()); },
    action(label) { return this.all().find(node => node.props?.children === label && node.props?.onClick); },
    run(action) { this.tree(); return exports.__updateOrder('synthetic-order', action); },
    async settle() { for (let i = 0; i < 4; i++) { this.tree(); effects.splice(0).forEach(effect => effect()); await tick(); } },
    event(name) { for (const callback of f.listeners.get(name) || []) callback(); },
  };
  return p;
}

test('network loss produces a visible pending outcome and blocks the old action', async () => {
  const f = fixture(), p = page(f); f.post = async () => { throw Error('synthetic network lost'); };
  await p.settle(); let rejected = false; await p.run('start').catch(() => { rejected = true; });
  assert.match(p.text(), /结果待核对/); assert.equal(rejected, false); assert.equal(p.action('开始').props.disabled, true);
  await p.run('start'); assert.equal(f.writes.length, 1);
});

test('synchronous double clicks issue one PATCH before any response arrives', async () => {
  const f = fixture(), p = page(f), releases = [];
  f.post = () => new Promise(resolve => releases.push(() => resolve(response({ id: 'synthetic-order', status: 'IN_PROGRESS' }))));
  await p.settle(); const first = p.run('start'), second = p.run('start');
  try { assert.equal(f.writes.length, 1); }
  finally { releases.forEach(release => release()); await Promise.allSettled([first, second]); }
});

test('an HTTP 200 empty object cannot claim completion success', async () => {
  const f = fixture('IN_PROGRESS'), p = page(f); f.post = async () => response({});
  await p.settle(); await p.run('complete');
  assert.doesNotMatch(p.text(), /已报完成，收益待客户/); assert.match(p.text(), /有效回执|结果待核对/);
  assert.equal(p.action('完成').props.disabled, true);
});

test('bad JSON, unrelated IDs, arrays and wrong target statuses all stay pending without success', async () => {
  for (const value of ['bad-json', { id: 'unrelated', status: 'AWAITING_ACCEPTANCE' }, [], null,
    { id: 'synthetic-order', status: 'COMPLETED' }, { id: 'synthetic-order', status: 123 }]) {
    const f = fixture('IN_PROGRESS'), p = page(f);
    f.post = async () => value === 'bad-json' ? { ok: true, status: 200, json: async () => { throw Error('synthetic invalid JSON'); } } : response(value);
    await p.settle(); await p.run('complete');
    assert.match(p.text(), /结果待核对/); assert.doesNotMatch(p.text(), /已报完成，收益待客户/);
    assert.equal(p.action('完成').props.disabled, true); await p.run('complete'); assert.equal(f.writes.length, 1);
  }
});

test('a rejected duration check remains visible and a fresh real status read permits a later action', async () => {
  const f = fixture('IN_PROGRESS'), p = page(f);
  f.post = async () => response({ message: '约定服务时长未结束' }, 400);
  await p.settle(); await p.run('complete');
  assert.match(p.text(), /约定服务时长未结束/); assert.equal(p.action('完成').props.disabled, true);
  p.action('刷新核对订单').props.onClick(); await p.settle();
  assert.equal(p.action('完成').props.disabled, false); assert.equal(f.writes.length, 1);
  f.post = async () => { f.orders = [initialOrder('AWAITING_ACCEPTANCE')]; return response({ id: 'synthetic-order', status: 'AWAITING_ACCEPTANCE' }); };
  await p.run('complete'); assert.equal(f.writes.length, 2); assert.match(p.text(), /已报完成，收益待客户/);
});

test('failed or malformed reconciliation cannot unlock the unknown action', async () => {
  for (const readFailure of ['network', '401', 'malformed']) {
    const f = fixture(), p = page(f); f.post = async () => { throw Error('synthetic lost response'); };
    await p.settle(); await p.run('start');
    f.listResponse = async () => readFailure === 'network' ? Promise.reject(Error('synthetic read loss'))
      : readFailure === '401' ? response({}, 401) : response([{}]);
    p.action('刷新核对订单').props.onClick(); await p.settle();
    assert.equal(p.action('开始').props.disabled, true, readFailure); await p.run('start'); assert.equal(f.writes.length, 1);
    assert.match(p.text(), /本单操作结果待核对/, readFailure);
  }
});

test('a lost committed start is reconciled to the next action and never replays the old start', async () => {
  const f = fixture(), p = page(f);
  f.post = async () => { f.orders = [initialOrder('IN_PROGRESS')]; throw Error('synthetic lost response after commit'); };
  await p.settle(); await p.run('start'); assert.equal(p.action('开始').props.disabled, true);
  p.action('刷新核对订单').props.onClick(); await p.settle();
  assert.equal(p.action('开始'), undefined); assert.equal(p.action('完成').props.disabled, false);
  await p.run('start'); assert.equal(f.writes.length, 1);
});

test('confirmed success survives list refresh failure and removes the old action immediately', async () => {
  const f = fixture('IN_PROGRESS'), p = page(f);
  f.post = async () => { f.failRead = true; return response({ id: 'synthetic-order', status: 'AWAITING_ACCEPTANCE' }); };
  await p.settle(); await p.run('complete');
  assert.match(p.text(), /已报完成，收益待客户/); assert.match(p.text(), /本笔操作已成功，但列表刷新失败/);
  assert.doesNotMatch(p.text(), /本笔结果待核对/); assert.equal(p.action('完成'), undefined);
  await p.run('complete'); assert.equal(f.writes.length, 1);
});

test('changing identity during a PATCH clears old rows and ignores the stale acknowledgement', async () => {
  const f = fixture(), p = page(f); let release;
  f.post = () => new Promise(resolve => { release = () => resolve(response({ id: 'synthetic-order', status: 'IN_PROGRESS' })); });
  await p.settle(); const pending = p.run('start');
  f.token = 'synthetic-token-b'; f.orders = [{ ...initialOrder('ACCEPTED'), id: 'other-order', orderNo: 'ORDER-B' }];
  p.event('storage'); await p.settle(); release(); await pending;
  assert.doesNotMatch(p.text(), /SYNTHETIC-ORDER|订单已开始|本笔结果待核对/); assert.match(p.text(), /ORDER-B/);
  await p.run('start'); assert.equal(f.writes.length, 1);
});

test('refresh is blocked while the mutation is in flight, including synchronous handler reentry', async () => {
  const f = fixture(), p = page(f); let release;
  f.post = () => new Promise(resolve => { release = () => resolve(response({ id: 'synthetic-order', status: 'IN_PROGRESS' })); });
  await p.settle(); const pending = p.run('start');
  const refresh = p.action('刷新核对订单'); assert.equal(refresh.props.disabled, true); refresh.props.onClick();
  await tick(); assert.equal(f.reads, 1); release(); await pending;
});

test('a fresh list without the old order removes its action and a stale handler cannot PATCH it', async () => {
  const f = fixture(), p = page(f); f.post = async () => { throw Error('synthetic lost response'); };
  await p.settle(); await p.run('start'); f.orders = [];
  p.action('刷新核对订单').props.onClick(); await p.settle();
  assert.equal(p.action('开始'), undefined); await p.run('start'); assert.equal(f.writes.length, 1);
});
