const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react'), jsx = require('react/jsx-runtime');
const tick = () => new Promise(resolve => setImmediate(resolve));
const ok = data => ({ ok: true, status: 200, json: async () => data });
const companion = id => ({ id, nickname: id, onlineStatus: 'ONLINE', game: 'DELTA_FORCE', games: ['DELTA_FORCE'], skillModes: [], deltaForceRank: '新手', voicePreference: 'OPTIONAL', pricePerHour: '30', verified: true, badges: ['耐心'], averageRating: 4.5, reviewCount: 2, completedOrders: 3 });
const rows = (start, count) => Array.from({ length: count }, (_, i) => companion('c' + (start + i)));
const pageData = (companions, total, page = 1) => ({ companions, total, page, limit: 24 });

function harness(fetch, entry = '../app/companions/page.tsx') {
  const states = [], refs = [], effects = [], pending = [];
  const modules = new Map(), saved = new Map();
  const storage = { getItem: key => key === 'dfc_customer_token' ? 'synthetic-only' : saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  let stateIndex = 0, refIndex = 0, effectIndex = 0;
  const hooks = {
    useState(initial) { const i = stateIndex++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef(initial) { return refs[refIndex++] ||= { current: initial }; },
    useEffect(fn, deps) {
      const i = effectIndex++, previous = effects[i];
      if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
        pending.push(() => { previous?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; });
      }
    }
  };
  const shell = props => props.children;
  const card = ({ companion }) => React.createElement('article', { 'data-companion-id': companion.id }, companion.nickname);
  const headers = props => React.createElement('h2', null, props.title, props.desc);
  function load(relative) {
    const filename = path.resolve(__dirname, relative);
    if (modules.has(filename)) return modules.get(filename);
    const exports = {}; modules.set(filename, exports);
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
    vm.runInNewContext(compiled.outputText, { exports, fetch, URLSearchParams, AbortController, setTimeout, clearTimeout,
      localStorage: storage, crypto: { randomUUID: () => 'synthetic-request-only' },
      window: { localStorage: storage, location: { search: '', origin: 'http://localhost' }, addEventListener() {}, removeEventListener() {} },
      document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
      require(id) {
        if (id === 'react') return hooks;
        if (id === 'react/jsx-runtime') return jsx;
        if (id === 'next/link') return 'a';
        if (id.endsWith('/components')) return { CustomerShell: shell, CompanionCard: card, SectionHeader: headers };
        if (id.endsWith('/data')) return { games: [] };
        if (id.endsWith('/escrow')) return { EscrowProgress: () => null, EscrowPromise: () => null };
        if (id === '@dfc/ui') return { GUARANTEE_RULES: [], platformLabel: value => value };
        if (id.startsWith('.')) {
          const target = path.resolve(path.dirname(filename), id);
          const found = [target, target + '.ts', target + '.tsx'].find(file => fs.existsSync(file));
          if (found) return load(found);
        }
        throw Error('Unexpected import ' + id);
      }
    });
    return exports;
  }
  const page = load(entry);
  function render() { stateIndex = refIndex = effectIndex = 0; const tree = page.default(); pending.splice(0).forEach(fn => fn()); return tree; }
  function expand(node) {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
  }
  function nodes(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children)];
  }
  const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : String(node ?? '');
  const all = () => nodes(expand(render()));
  return { load, mount: render, all, text,
    button: label => all().find(node => node.type === 'button' && text(node) === label),
    cards: () => Array.from(all().filter(node => node.type === 'article'), node => node.props['data-companion-id']),
    select: label => all().find(node => node.type === 'select' && node.props['aria-label'] === label),
    content: () => text(expand(render())), unmount() { effects.forEach(effect => effect.cleanup?.()); }
  };
}
function publicFetch(list, leaderboard = []) {
  return async url => url.includes('/leaderboard') ? ok(leaderboard) : url.includes('public-config') ? ok({}) : list(new URL(url, 'http://localhost'));
}

test('companion page requests 24, uses total, appends next page and fetches independent leaders', async () => {
  const calls = [];
  const p = harness(publicFetch(url => {
    calls.push(url); return ok(url.searchParams.get('page') === '1' ? pageData(rows(1, 24), 26) : pageData(rows(25, 2), 26, 2));
  }, [{ ...companion('outside-first-page'), completedOrders: 999 }]));
  p.mount(); await tick();
  assert.equal(p.cards().length, 24); assert.match(p.content(), /共 26 位匹配陪玩，已展示 24 位/); assert.match(p.content(), /outside-first-page/);
  assert.equal(calls[0].searchParams.get('limit'), '24'); assert.equal(calls[0].searchParams.get('sort'), 'recommended');
  p.button('加载更多').props.onClick(); await tick();
  assert.equal(p.cards().length, 26); assert.equal(new Set(p.cards()).size, 26);
  assert.equal(calls[1].searchParams.get('page'), '2'); assert.equal(calls[1].searchParams.get('limit'), '24'); assert.equal(p.button('加载更多'), undefined);
});

test('load-more failure retains cards and retries the same page without duplicate requests', async () => {
  let count = 0, release;
  const waiting = new Promise(resolve => { release = resolve; });
  const p = harness(publicFetch(async url => {
    if (url.searchParams.get('page') === '1') return ok(pageData(rows(1, 24), 25));
    count++; if (count === 1) { await waiting; throw Error('synthetic failure'); }
    return ok(pageData(rows(25, 1), 25, 2));
  }));
  p.mount(); await tick();
  const button = p.button('加载更多'); button.props.onClick(); button.props.onClick();
  assert.equal(count, 1); assert.equal(p.cards().length, 24);
  release(); await tick(); assert.match(p.content(), /已显示的陪玩仍可查看/); assert.equal(p.cards().length, 24);
  p.button('重新加载').props.onClick(); await tick(); assert.equal(p.cards().length, 25); assert.equal(count, 2);
});

test('sort restarts at page one and stale load-more cannot overwrite the new list', async () => {
  let release; const waiting = new Promise(resolve => { release = resolve; }), calls = [];
  const p = harness(publicFetch(async url => {
    calls.push(url);
    if (url.searchParams.get('sort') === 'rating') return ok(pageData([companion('rating-first')], 1));
    if (url.searchParams.get('page') === '2') { await waiting; return ok(pageData([companion('old-page-two')], 25, 2)); }
    return ok(pageData(rows(1, 24), 25));
  }));
  p.mount(); await tick(); p.button('加载更多').props.onClick();
  p.select('陪玩排序').props.onChange({ target: { value: 'rating' } }); p.all(); await tick();
  assert.deepEqual(p.cards(), ['rating-first']); release(); await tick(); assert.deepEqual(p.cards(), ['rating-first']);
  assert.equal(calls.at(-1).searchParams.get('page'), '1'); assert.equal(calls.at(-1).searchParams.get('sort'), 'rating'); p.unmount();
});

test('four sorts and existing filters query the server instead of filtering the loaded page', async () => {
  const calls = [], p = harness(publicFetch(url => { calls.push(url); return ok(pageData([companion('server-choice')], 1)); }));
  p.mount(); await tick();
  for (const sort of ['rating', 'orders', 'price', 'recommended']) {
    p.select('陪玩排序').props.onChange({ target: { value: sort } }); p.all(); await tick();
    assert.equal(calls.at(-1).searchParams.get('sort'), sort); assert.equal(calls.at(-1).searchParams.get('page'), '1');
  }
  for (const [label, filter] of [['在线优先', 'online'], ['可语音', 'voice'], ['推荐', 'recommended'], ['新手友好', 'newbie'], ['高分段', 'high-rank'], ['全部', 'all']]) {
    p.button(label).props.onClick(); p.all(); await tick(); assert.equal(calls.at(-1).searchParams.get('filter'), filter); assert.deepEqual(p.cards(), ['server-choice']);
  }
});

test('malformed initial response is retryable and leaderboard failure does not block the list', async () => {
  let count = 0;
  const p = harness(async url => {
    if (url.includes('/leaderboard')) throw Error('synthetic failure');
    if (url.includes('public-config')) return ok({});
    return ok(++count === 1 ? [] : pageData([companion('recovered')], 1));
  });
  p.mount(); await tick(); assert.match(p.content(), /暂时无法加载真实陪玩列表/);
  p.button('重新加载').props.onClick(); await tick(); assert.deepEqual(p.cards(), ['recovered']);
});

for (const entry of ['guarantee', 'packages']) test(entry + ' dropdown loads all 75 authenticated options', async () => {
  const people = rows(1, 75), calls = [];
  const p = harness(async (url, init) => {
    calls.push(url);
    if (url === '/api/auth/me') return ok({ user: { id: 'synthetic-customer', role: 'CUSTOMER' } });
    if (url === '/api/orders/companions/options?game=DELTA_FORCE') { assert.ok(init.headers.Authorization); return ok(people); }
    if (url === '/api/wallet/customer-summary') return ok({ wallet: { availableBalance: '0' } });
    assert.ok(['/api/orders/guarantee-packages', '/api/orders/service-packages'].includes(url)); return ok([]);
  }, '../app/' + entry + '/page.tsx');
  p.mount(); await tick(); p.all(); await tick();
  const options = p.all().filter(node => node.type === 'option');
  assert.ok(options.some(node => node.props.value === 'c75')); assert.equal(options.filter(node => /^c\d+$/.test(node.props.value)).length, 75);
  assert.equal(calls.filter(url => url.includes('/companions/')).length, 1);
});

test('hourly order client loads all 75 authenticated options and retains price strings', async () => {
  const p = harness(async () => ok({})), people = rows(1, 75), calls = [];
  const { createOrderClient } = p.load('../app/order/order-client.ts');
  const client = createOrderClient({
    storage: { getItem: () => null, setItem() {}, removeItem() {} }, getToken: () => 'synthetic-only', makeRequestId: () => 'synthetic-request-only', scope: 'http://localhost',
    fetcher: async (url, init) => {
      calls.push(url); assert.ok(init.headers.Authorization);
      if (url === '/api/auth/me') return ok({ user: { id: 'synthetic-customer', role: 'CUSTOMER' } });
      if (url === '/api/orders/companions/options?game=DELTA_FORCE') return ok(people);
      if (url === '/api/wallet/customer-summary') return ok({ wallet: { availableBalance: '0' } });
      assert.equal(url, '/api/orders/my'); return ok([]);
    }
  });
  const state = await client.refresh();
  assert.equal(state.error, ''); assert.equal(state.companions.length, 75); assert.equal(state.companions[74].id, 'c75'); assert.equal(state.companions[74].pricePerHour, '30');
  assert.equal(calls.filter(url => url.includes('/companions/')).length, 1);
});
