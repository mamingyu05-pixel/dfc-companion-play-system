const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const deps = require('node:module').createRequire(path.join(root, 'apps/customer-web/package.json'));
const ts = deps('typescript'), React = deps('react'), jsx = deps('react/jsx-runtime');
const { renderToStaticMarkup } = deps('react-dom/server');
const tick = () => new Promise(resolve => setImmediate(resolve));
const pages = ['apps/customer-web/app/recharge/page.tsx', 'apps/companion-web/app/earnings/page.tsx', 'apps/companion-web/app/withdrawals/page.tsx'];
function page(file, mode) {
  const states = [], refs = [], effects = []; let cursor = 0, ref = 0;
  const hooks = { useState(value) { const i = cursor++; if (!(i in states)) states[i] = typeof value === 'function' ? value() : value;
    return [states[i], next => states[i] = typeof next === 'function' ? next(states[i]) : next]; },
    useRef(value) { const i = ref++; return refs[i] ||= { current: value }; }, useEffect: fn => effects.push(fn), useMemo: fn => fn() };
  const Summary = { wallet: { availableBalance: '0', frozenBalance: '0', availableIncome: '0', pendingIncome: '0', frozenIncome: '0', disputeReserve: '0', transactions: [] },
    pendingRechargeAmount: '0', withdrawingAmount: '0', rechargeRequests: [], withdrawalRequests: [] };
  // The dedicated money-intent suite loads the real recovery module; this fixture isolates wallet loading.
  const moneyState = () => ({ subject: "synthetic-owner", connected: true, busy: false, phase: "empty", targetId: null, targetLabel: "", body: null, receipt: null, error: "" });
  const money = { emptyMoneyIntentState: moneyState, createMoneyIntentClient: () => ({ state: moneyState, refresh: async () => moneyState() }) };
  const exports = {};
  const Wrapper = ({ children }) => React.createElement('div', null, children);
  const components = { CustomerShell: Wrapper, CompanionShell: Wrapper, StatusBadge: Wrapper,
    SectionHeader: ({ title }) => React.createElement('h1', null, title),
    MetricCard: ({ label, value }) => React.createElement('div', { 'data-metric': label }, value) };
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, crypto: { randomUUID: () => "synthetic-intent-00000000" }, localStorage: { getItem: () => 'synthetic-session' }, window: { location: {} },
    fetch: async url => {
      if (url.includes('public-config') || url.includes('payout-profile')) return { ok: true, json: async () => ({}) };
      if (mode === 'pending') return new Promise(() => {});
      if (mode === 'network') throw Error('synthetic network failure');
      return { ok: mode === 'zero', status: mode === 'unauthorized' ? 401 : mode === 'zero' ? 200 : 500, json: async () => Summary };
    },
    require: id => id === 'react' ? hooks : id === 'react/jsx-runtime' ? jsx : id === '@dfc/ui' ? money : components
  });
  function html() { cursor = ref = 0; return renderToStaticMarkup(exports.default()); }
  return { html, async mount() { html(); effects.splice(0).forEach(fn => fn()); await tick(); await tick(); } };
}
for (const file of pages) {
  for (const mode of ['pending', 'network', 'unauthorized', 'server']) test(`${file}: ${mode} keeps amounts and empty history unconfirmed`, async () => {
    const p = page(file, mode); await p.mount(); const html = p.html();
    assert.match(html, /待核对|正在加载/);
    assert.doesNotMatch(html, /¥0\.00|当前账号还没有充值申请|当前账号暂无收益流水|当前账号还没有提现申请/);
  });
  test(`${file}: a confirmed zero response displays real zero and empty history`, async () => {
    const p = page(file, 'zero'); await p.mount(); const html = p.html();
    assert.match(html, /¥0\.00/); assert.match(html, /没有充值申请|暂无收益流水|没有提现申请/);
  });
}
