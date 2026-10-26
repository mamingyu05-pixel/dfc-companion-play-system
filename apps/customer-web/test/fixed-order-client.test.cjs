const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../app/fixed-order-client.ts'), 'utf8');
const exportsForTest = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: exportsForTest, AbortController, setTimeout, clearTimeout, Date });
const { createFixedOrderClient } = exportsForTest;
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const receipt = (body, extra = {}) => ({ id: 'synthetic-order', orderNo: 'SYNTHETIC-ORDER', status: 'PAID', totalAmount: body.expectedTotalAmount, ...extra });
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const saved = new Map(), calls = [], posts = [];
  let token = 'token-a', sequence = 0;
  const f = { saved, calls, posts,
    token(value) { token = value; },
    storage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) },
    post: async () => { throw Error('synthetic lost response after commit'); },
    lookup: async requestId => response({ requestId, outcome: 'UNRESOLVED', allowNewRequest: false }),
  };
  f.client = (kind = 'guarantee', storage = f.storage) => createFixedOrderClient({ kind, storage, scope: 'http://synthetic.invalid',
    getToken: () => token, makeRequestId: () => `synthetic-request-${String(++sequence).padStart(8, '0')}`,
    fetcher: async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET', token: init.headers.Authorization });
      const subject = init.headers.Authorization === 'Bearer token-b' ? 'customer-b' : 'customer-a';
      if (url === '/api/auth/me') return response({ user: { id: subject, role: 'CUSTOMER' } });
      if (url.includes('/requests/')) return f.lookup(decodeURIComponent(url.split('/').pop()));
      const body = init.body ? JSON.parse(init.body) : null;
      if (url.endsWith('/preview')) return response({ customerId: subject, packageId: body.packageId,
        companionId: body.companionId || null, totalAmount: '100.00', mode: '合成服务' });
      posts.push({ url, body, token: init.headers.Authorization });
      return f.post(body, url);
    } });
  return f;
}
async function quoted(f, kind = 'guarantee') {
  const client = f.client(kind); await client.refresh();
  await client.prepare({ packageId: 'synthetic-tier', companionId: 'synthetic-companion' });
  assert.ok(client.state().preview); return client;
}

for (const kind of ['guarantee', 'package']) {
  test(`${kind}: unknown result locks changes and retry uses the exact persisted body including original notes`, async () => {
    const f = fixture(), client = await quoted(f, kind);
    await client.submit(' original notes ');
    assert.equal(client.state().pending, true); assert.equal(f.posts.length, 1);
    const persisted = [...f.saved.values()][0], journal = JSON.parse(persisted);
    assert.equal(journal.body.notes, 'original notes'); assert.equal(journal.subject, 'customer-a');
    assert.doesNotMatch(persisted, /token-a|Bearer|accessToken/);
    assert.equal(client.change(), false); assert.equal(client.canEdit(), false);
    await client.prepare({ packageId: 'a-different-tier' });
    assert.equal(client.state().preview.packageId, 'synthetic-tier');
    f.post = async body => response(receipt(body));
    await client.retry();
    assert.equal(f.posts.length, 2);
    assert.equal(JSON.stringify(f.posts[1].body), JSON.stringify(f.posts[0].body));
    assert.equal(f.posts[1].url, `/api/orders/${kind}`);
    assert.equal(client.state().pending, false); assert.equal(client.state().receipt.id, 'synthetic-order');
    assert.equal(f.saved.size, 1); assert.equal(JSON.parse([...f.saved.values()][0]).receipt.id, 'synthetic-order');
  });
}

test('reload and the other fixed-price page restore the same pending request rather than making a new intent', async () => {
  const f = fixture(), first = await quoted(f); await first.submit('original notes');
  const reloaded = f.client('package'); await reloaded.refresh();
  assert.equal(reloaded.state().pending, true); assert.equal(reloaded.state().pendingKind, 'guarantee');
  assert.equal(reloaded.change(), false); await reloaded.prepare({ packageId: 'new-package' });
  assert.equal(f.posts.length, 1);
  f.post = async body => response(receipt(body)); await reloaded.retry();
  assert.equal(f.posts[1].url, '/api/orders/guarantee');
  assert.equal(JSON.stringify(f.posts[1].body), JSON.stringify(f.posts[0].body));
});

test('confirmed recovery checks the matching request and amount before preserving the acknowledgement', async () => {
  const f = fixture(), first = await quoted(f); await first.submit('notes');
  f.lookup = async requestId => response({ requestId, outcome: 'CONFIRMED', order: receipt(f.posts[0].body) });
  const reloaded = f.client(); await reloaded.refresh();
  assert.equal(reloaded.state().receipt.orderNo, 'SYNTHETIC-ORDER'); assert.equal(f.posts.length, 1); assert.equal(f.saved.size, 1);
  assert.equal(JSON.parse([...f.saved.values()][0]).receipt.id, 'synthetic-order');
});

test('synchronous duplicate submits send one POST even before React can rerender', async () => {
  const f = fixture(), client = await quoted(f); let resolvePost;
  f.post = body => new Promise(resolve => { resolvePost = () => resolve(response(receipt(body))); });
  const first = client.submit('original'); const second = client.submit('changed');
  await tick(); assert.equal(f.posts.length, 1); assert.equal(client.state().busy, true); assert.equal(client.canEdit(), false);
  resolvePost(); await Promise.all([first, second]);
  assert.equal(f.posts.length, 1); assert.equal(f.posts[0].body.notes, 'original');
});

test('only an explicit first-attempt 400 NOT_COMMITTED response releases the intent', async () => {
  for (const [status, marker, expectedPending] of [[400, 'NOT_COMMITTED', false], [400, undefined, true], [409, 'NOT_COMMITTED', true], [500, 'NOT_COMMITTED', true]]) {
    const f = fixture(), client = await quoted(f);
    f.post = async () => response({ message: 'synthetic rejection', requestOutcome: marker }, status);
    await client.submit('notes');
    assert.equal(client.state().pending, expectedPending, `HTTP ${status} marker ${marker}`);
    assert.equal(f.saved.size, expectedPending ? 1 : 0);
  }
});

test('a rejection during retry cannot clear an earlier ambiguous attempt', async () => {
  const f = fixture(), client = await quoted(f); await client.submit('notes');
  f.post = async () => response({ message: 'synthetic later validation failure', requestOutcome: 'NOT_COMMITTED' }, 400);
  await client.retry(); assert.equal(client.state().pending, true); assert.equal(f.saved.size, 1); assert.equal(client.change(), false);
});

test('UNRESOLVED, 404, foreign request IDs and malformed recovery receipts never permit a new intent', async () => {
  for (const variant of ['unresolved', '404', 'foreign', 'empty', 'amount']) {
    const f = fixture(), client = await quoted(f); await client.submit('notes');
    f.lookup = async requestId => variant === 'unresolved' ? response({ requestId, outcome: 'UNRESOLVED', allowNewRequest: true })
      : variant === '404' ? response({}, 404) : response({ requestId: variant === 'foreign' ? 'another-request' : requestId,
        outcome: 'CONFIRMED', order: variant === 'empty' ? {} : receipt(f.posts[0].body, variant === 'amount' ? { totalAmount: '1.00' } : {}) });
    const reloaded = f.client(); await reloaded.refresh();
    assert.equal(reloaded.state().pending, true, variant); assert.equal(reloaded.change(), false, variant); assert.equal(f.saved.size, 1, variant);
    await reloaded.prepare({ packageId: 'new-tier' }); assert.equal(f.posts.length, 1, variant);
  }
});

test('empty, wrong-owner or mismatched direct receipts keep the original journal', async () => {
  for (const result of [{}, { id: 'o', orderNo: 'n', status: 'PAID', totalAmount: '1.00' },
    { id: 'o', orderNo: 'n', status: 'PAID', totalAmount: '100.00', customerId: 'customer-b' }]) {
    const f = fixture(), client = await quoted(f); f.post = async () => response(result); await client.submit('notes');
    assert.equal(client.state().pending, true); assert.equal(client.state().receipt, null); assert.equal(f.saved.size, 1);
  }
});

test('storage refusal or a corrupt journal fails before sending an order', async () => {
  const f = fixture(), storage = { ...f.storage, setItem() { throw Error('synthetic storage refusal'); } };
  const client = f.client('guarantee', storage); await client.refresh(); await client.prepare({ packageId: 'synthetic-tier' });
  await client.submit('notes'); assert.equal(f.posts.length, 0); assert.match(client.state().error, /保存/);
  const other = fixture(), first = await quoted(other); await first.submit('notes');
  const key = [...other.saved.keys()][0]; other.saved.set(key, '{"version":1}');
  const reloaded = other.client(); await reloaded.refresh(); await reloaded.prepare({ packageId: 'new-tier' });
  assert.equal(other.posts.length, 1); assert.equal(reloaded.canEdit(), false); assert.match(reloaded.state().error, /记录异常/);
});

test('switching accounts during a POST never adopts the old response or replays it under the new customer', async () => {
  const f = fixture(), client = await quoted(f); let resolvePost;
  f.post = body => new Promise(resolve => { resolvePost = () => resolve(response(receipt(body))); });
  const submitting = client.submit('original-a'); await tick(); f.token('token-b'); resolvePost(); await submitting;
  assert.equal(client.state().receipt, null); assert.equal(f.saved.size, 1);
  await client.refresh(); assert.equal(client.state().subject, 'customer-b'); assert.equal(client.state().pending, false);
  await client.retry(); assert.equal(f.posts.length, 1);
  f.token('token-a'); await client.refresh(); assert.equal(client.state().pending, true);
  f.post = async body => response(receipt(body)); await client.retry();
  assert.equal(f.posts[1].token, 'Bearer token-a'); assert.equal(JSON.stringify(f.posts[1].body), JSON.stringify(f.posts[0].body));
});

test('a token change clears the visible prior preview before allowing any input edits', async () => {
  const f = fixture(), client = await quoted(f); f.token('token-b');
  assert.equal(client.canEdit(), false); assert.equal(client.state().preview, null); assert.equal(client.state().subject, null);
  await client.submit('new-account-note'); assert.equal(f.posts.length, 0);
  await client.refresh(); assert.equal(client.state().subject, 'customer-b');
});

async function recoveredOnOtherPage() {
  const f = fixture(), original = await quoted(f); await original.submit('original-notes');
  f.lookup = async requestId => response({ requestId, outcome: 'CONFIRMED', order: receipt(f.posts[0].body) });
  const otherPage = f.client('package'); await otherPage.refresh();
  assert.equal(otherPage.state().receipt.id, 'synthetic-order');
  return { f, original, otherPage };
}

test('cross-page confirmation also unlocks the original page through real refresh/retry ordering', async () => {
  const { f, original } = await recoveredOnOtherPage();
  await original.refresh(); await original.retry();
  assert.equal(original.state().pending, false);
  assert.equal(original.state().receipt?.id, 'synthetic-order');
  assert.equal(f.posts.length, 1);
});

test('confirmed receipt survives a second full page reload until an explicit new order', async () => {
  const { f } = await recoveredOnOtherPage();
  const reloaded = f.client(); await reloaded.refresh();
  assert.equal(reloaded.state().receipt?.id, 'synthetic-order');
  assert.equal(reloaded.state().pending, false); assert.equal(reloaded.canEdit(), false);
  assert.equal(f.posts.length, 1);
});

test('only explicit beginNew clears a confirmed journal and original body, without sending an order', async () => {
  const { f, otherPage } = await recoveredOnOtherPage();
  await otherPage.beginNew(); assert.equal(f.saved.size, 0); assert.equal(otherPage.state().receipt, null);
  assert.equal(otherPage.state().preview, null); assert.equal(otherPage.canEdit(), true); assert.equal(f.posts.length, 1);
  const reloaded = f.client(); await reloaded.refresh(); assert.equal(reloaded.state().receipt, null); assert.equal(reloaded.canEdit(), true);
});

test('explicit new-order action cannot discard an unknown request or an account belonging to somebody else', async () => {
  const f = fixture(), client = await quoted(f); await client.submit('original-notes');
  const original = [...f.saved.values()][0]; await client.beginNew();
  assert.equal(client.state().pending, true); assert.equal([...f.saved.values()][0], original); assert.equal(f.posts.length, 1);
  f.token('token-b'); await client.beginNew(); assert.equal([...f.saved.values()][0], original); assert.equal(f.posts.length, 1);
});

test('the original pending page reconciles after another tab explicitly clears a confirmed journal', async () => {
  const { f, original, otherPage } = await recoveredOnOtherPage();
  await otherPage.beginNew(); assert.equal(f.saved.size, 0);
  await original.refresh(); assert.equal(original.state().pending, false); assert.equal(original.state().receipt.id, 'synthetic-order');
  assert.equal(f.saved.size, 0, 'old page must not resurrect a journal explicitly cleared by another tab');
  await original.beginNew(); assert.equal(original.canEdit(), true); assert.equal(f.posts.length, 1);
});
