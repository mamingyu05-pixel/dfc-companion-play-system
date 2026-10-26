const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript'), React = require('react'), jsx = require('react/jsx-runtime');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../../..');
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const elements = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(elements)
  : [node, ...elements(node.props?.children)];
function fixture() {
  const saved = new Map(), writes = [];
  let sequence = 0, token = 'synthetic-token-a';
  const storage = { getItem: key => key === 'dfc_customer_token' ? token : saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  async function fetch(url, options = {}) {
    if (url === '/api/auth/me') return response({ user: { id: 'customer-a', role: 'CUSTOMER' } });
    if (url.includes('/requests/')) {
      const requestId = decodeURIComponent(url.split('/').pop()), body = writes.find(body => body.requestId === requestId);
      return response(body ? { requestId, outcome: 'CONFIRMED', order: { id: 'order-a', orderNo: 'ORDER-A', status: 'PAID', totalAmount: body.expectedTotalAmount } }
        : { requestId, outcome: 'UNRESOLVED', allowNewRequest: false });
    }
    if (url.endsWith('/preview')) {
      const body = JSON.parse(options.body);
      return response({ customerId: 'customer-a', ...body, companionId: body.companionId || null, totalAmount: '100.00', mode: '合成服务' });
    }
    if (options.method === 'POST') { writes.push(JSON.parse(options.body)); throw new Error('synthetic response lost after commit'); }
    if (url.endsWith('customer-summary')) return response({ wallet: { availableBalance: '1000.00' } });
    if (url.includes('companions')) return response([]);
    return response([{ id: 'tier-a', platform: 'PC', category: '合成套餐', name: '合成服务', targetWan: 100, price: '100.00' }]);
  }
  return { saved, writes, storage, fetch, uuid: () => `synthetic-request-${String(++sequence).padStart(8, '0')}` };
}
function page(kind, f) {
  const slots = [], effects = [], modules = new Map(); let cursor = 0;
  const hooks = { ...React,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef(initial) { const index = cursor++; return slots[index] || (slots[index] = { current: initial }); },
    useEffect(effect, deps) { const index = cursor++, before = slots[index];
      if (!before || !deps || deps.some((dep, i) => dep !== before[i])) { slots[index] = deps; effects.push(effect); } },
    useMemo: action => action(), useCallback: action => action,
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const Wrapper = ({ children }) => React.createElement('div', null, children);
    vm.runInNewContext(output, { exports, fetch: f.fetch, localStorage: f.storage, crypto: { randomUUID: f.uuid },
      URLSearchParams, AbortController, setTimeout, clearTimeout, Date,
      window: { localStorage: f.storage, location: { origin: 'http://synthetic.invalid', search: '' }, addEventListener() {}, removeEventListener() {} },
      document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
      require(id) {
        if (id === 'react') return hooks;
        if (id === 'react/jsx-runtime') return jsx;
        if (id === 'next/link') return Wrapper;
        if (id === '../components') return { CustomerShell: Wrapper };
        if (id === '@dfc/ui') return load('packages/ui/src/index.ts');
        if (id.startsWith('.')) {
          const target = path.join(path.dirname(file), id);
          const found = [target, `${target}.ts`, `${target}.tsx`].find(name => fs.existsSync(path.join(root, name)));
          if (found) return load(found);
        }
        throw Error(`Unexpected fixture import: ${id}`);
      }
    });
    return exports;
  }
  const exports = load(`apps/customer-web/app/${kind === 'package' ? 'packages' : 'guarantee'}/page.tsx`);
  const p = { tree() { cursor = 0; return exports.default(); }, all() { return elements(this.tree()); },
    button(label) { return this.all().find(node => node.type === 'button' && node.props.children === label); },
    async settle() { for (let i = 0; i < 6; i++) { this.tree(); effects.splice(0).forEach(effect => effect()); await tick(); } } };
  return p;
}

for (const kind of ['guarantee', 'package']) {
  test(`${kind}: a lost committed response cannot be replaced with a new intent through return/change`, async () => {
    const f = fixture(), p = page(kind, f);
    await p.settle();
    p.all().find(node => node.props?.role === 'radio' && node.key === 'tier-a').props.onClick();
    p.button('核对金额').props.onClick(); await p.settle();
    p.all().find(node => node.type === 'button' && Array.isArray(node.props.children)
      && node.props.children.join('') === '确认提交并冻结 ¥100.00').props.onClick();
    await p.settle(); assert.equal(f.writes.length, 1);
    const back = p.button('返回修改'); if (back && !back.props.disabled) back.props.onClick();
    const quote = p.button('核对金额'); if (quote && !quote.props.disabled) quote.props.onClick();
    await p.settle();
    const submit = p.all().find(node => node.type === 'button' && Array.isArray(node.props.children)
      && node.props.children.join('') === '确认提交并冻结 ¥100.00');
    if (submit && !submit.props.disabled) submit.props.onClick();
    await p.settle();
    assert.equal(new Set(f.writes.map(body => body.requestId)).size, 1, 'unknown committed outcome must retain the first request identity');
    assert.equal(f.writes.length, 1, 'changing controls must not send a second order after the lost response');
    assert.equal(p.button('返回修改').props.disabled, true);
    assert.ok(p.all().filter(node => node.props?.role === 'radio').every(node => node.props.disabled));
    assert.equal(p.all().find(node => node.type === 'select' && node.props['aria-label'] === '陪玩').props.disabled, true);
    assert.equal(p.all().find(node => node.type === 'input' && node.props.maxLength === 200).props.disabled, true);
  });
  test(`${kind}: reloading recovers the committed receipt without another order POST`, async () => {
    const f = fixture(), p = page(kind, f);
    await p.settle(); p.all().find(node => node.props?.role === 'radio' && node.key === 'tier-a').props.onClick();
    p.button('核对金额').props.onClick(); await p.settle();
    p.all().find(node => node.type === 'button' && Array.isArray(node.props.children)
      && node.props.children.join('') === '确认提交并冻结 ¥100.00').props.onClick();
    await p.settle(); assert.equal(f.writes.length, 1);
    const reloaded = page(kind, f); await reloaded.settle();
    assert.equal(f.writes.length, 1);
    assert.ok(reloaded.all().some(node => node.props?.href === '/orders?record=order-a'));
    assert.equal(reloaded.button('返回修改'), undefined);
    assert.equal(f.saved.size, 1);
    assert.equal(JSON.parse([...f.saved.values()][0]).receipt.id, 'order-a');
    assert.ok(reloaded.button('另下一单'));
    reloaded.button('另下一单').props.onClick(); await reloaded.settle();
    assert.equal(f.saved.size, 0); assert.equal(reloaded.button('另下一单'), undefined);
    assert.equal(reloaded.all().find(node => node.props?.role === 'radio' && node.key === 'tier-a').props['aria-checked'], false);
  });
  test(`${kind}: persisted PAID receipt renders original submission evidence without claiming current escrow`, async () => {
    const f = fixture(), p = page(kind, f);
    await p.settle(); p.all().find(node => node.props?.role === 'radio' && node.key === 'tier-a').props.onClick();
    p.button('核对金额').props.onClick(); await p.settle();
    p.all().find(node => node.type === 'button' && Array.isArray(node.props.children)
      && node.props.children.join('') === '确认提交并冻结 ¥100.00').props.onClick();
    await p.settle();
    const recovered = page(kind, f); await recovered.settle();
    assert.equal(JSON.parse([...f.saved.values()][0]).receipt.status, 'PAID');
    const liveState = { id: 'order-a', status: 'COMPLETED', frozenBalance: '0.00' }, priorFetch = f.fetch;
    f.fetch = async (url, init) => url === '/api/orders/my' ? response([liveState])
      : url === '/api/wallet/customer-summary' ? response({ wallet: { availableBalance: '1000.00', frozenBalance: liveState.frozenBalance } }) : priorFetch(url, init);
    const revisited = page(kind, f); await revisited.settle();
    const html = renderToStaticMarkup(revisited.tree());
    assert.doesNotMatch(html, /由平台托管中|aria-label="资金进度"/);
    assert.match(html, /原提交回执/); assert.match(html, /原提交金额/); assert.match(html, /100\.00/);
    assert.match(html, /最新状态、结算与退款/);
    assert.ok(revisited.all().some(node => node.props?.href === '/orders?record=order-a'));
    assert.equal(JSON.parse([...f.saved.values()][0]).receipt.status, 'PAID', 'presentation must not rewrite the original receipt');
    assert.equal(f.writes.length, 1);
  });
}
