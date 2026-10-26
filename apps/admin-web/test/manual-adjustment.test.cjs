const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const { test } = require("node:test"),
  { createRequire } = require("node:module");
const root = path.resolve(__dirname, "../../.."),
  deps = createRequire(path.join(root, "apps/admin-web/package.json"));
const ts = deps("typescript"),
  React = deps("react"),
  jsx = deps("react/jsx-runtime");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const locks = new Map();
const lockManager = {
  request(name, work) {
    const previous = locks.get(name) || Promise.resolve();
    const run = previous.catch(() => {}).then(work);
    const settled = run.then(
      () => {},
      () => {},
    );
    locks.set(name, settled);
    return run.finally(() => {
      if (locks.get(name) === settled) locks.delete(name);
    });
  },
};
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function environment() {
  let serial = 0;
  const f = {
    token: "synthetic-admin-A-session",
    subject: "admin-A",
    role: "ADMIN",
    storage: new Map(),
    posts: [],
    failStorage: false,
  };
  f.users = ["customer-A", "customer-B"].map((id) => ({
    id,
    email: id + "@synthetic.invalid",
    role: "CUSTOMER",
    status: "ACTIVE",
    displayName: id,
    createdAt: "2026-10-27T00:00:00Z",
    wallet: { availableBalance: "300", frozenBalance: "0", availableIncome: "0", pendingIncome: "0" },
    companionProfile: null,
    externalAccounts: [],
  }));
  f.good = (url, body) => ({
    requestId: body.requestId,
    customerId: decodeURIComponent(url.split("/")[4]),
    direction: body.direction || "CREDIT",
    replayed: false,
    wallet: { id: "wallet-A", availableBalance: "400", frozenBalance: "0" },
    transaction: { id: "transaction-original", amount: body.amount, balanceAfter: "400" },
  });
  f.reply = (url, body) => response(f.good(url, body));
  f.fetch = async (url, init = {}) => {
    if (url === "/api/auth/me") {
      const result = response({ user: { id: f.subject, role: f.role } });
      if (f.duringAuth) f.duringAuth();
      return result;
    }
    if (url === "/api/admin/users") return response(f.users);
    assert.match(url, /^\/api\/admin\/users\/[^/]+\/balance-adjustments$/);
    assert.equal(init.method, "POST");
    const body = JSON.parse(init.body);
    f.posts.push({ url, body, token: init.headers.Authorization });
    return f.reply(url, body);
  };
  f.localStorage = {
    getItem(key) {
      if (key === "dfc_admin_token") return f.token;
      if (f.failStorage || f.failReads) throw Error("SYNTHETIC_STORAGE");
      return f.storage.get(key) ?? null;
    },
    setItem(key, value) {
      if (f.failStorage || f.failWrites) throw Error("SYNTHETIC_STORAGE");
      if (!f.discardWrites) f.storage.set(key, value);
    },
    removeItem: (key) => f.storage.delete(key),
  };
  f.crypto = { randomUUID: () => "manual-adjustment-" + String(++serial).padStart(8, "0") };
  return f;
}
function page(f) {
  const states = [],
    refs = [],
    memo = [],
    effectDeps = [],
    effects = [];
  let stateAt = 0,
    refAt = 0,
    memoAt = 0,
    effectAt = 0;
  const hooks = {
    useState(initial) {
      const i = stateAt++;
      if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial;
      return [states[i], (next) => (states[i] = typeof next === "function" ? next(states[i]) : next)];
    },
    useRef(initial) {
      return (refs[refAt++] ||= { current: initial });
    },
    useMemo(fn, deps) {
      const i = memoAt++,
        old = memo[i];
      if (old && deps.every((d, j) => Object.is(d, old.deps[j]))) return old.value;
      const value = fn();
      memo[i] = { deps, value };
      return value;
    },
    useEffect(fn, deps) {
      const i = effectAt++,
        old = effectDeps[i];
      if (!old || deps.some((d, j) => !Object.is(d, old[j]))) {
        effectDeps[i] = deps;
        effects.push(fn);
      }
    },
  };
  const Wrapper = ({ children }) => React.createElement("div", null, children),
    components = new Proxy({}, { get: () => Wrapper });
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {};
    modules.set(file, exports);
    const source = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    vm.runInNewContext(source, {
      exports,
      fetch: f.fetch,
      localStorage: f.localStorage,
      crypto: f.crypto,
      navigator: { locks: lockManager },
      window: { location: { origin: "http://synthetic.invalid" } },
      AbortController,
      setTimeout,
      clearTimeout,
      require(id) {
        if (id === "react") return hooks;
        if (id === "react/jsx-runtime") return jsx;
        if (id === "../components") return components;
        if (id === "../batch-tools") return load("apps/admin-web/app/batch-tools.tsx");
        if (id === "@dfc/ui") return load("packages/ui/src/money-intent-client.ts");
        throw Error("Unexpected fixture import " + id);
      },
    });
    return exports;
  }
  const component = load("apps/admin-web/app/users/page.tsx").default;
  function tree() {
    stateAt = refAt = memoAt = effectAt = 0;
    return component();
  }
  function nodes(n) {
    return !n || typeof n !== "object" ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)];
  }
  function text(n) {
    return Array.isArray(n)
      ? n.map(text).join("")
      : n && typeof n === "object"
        ? text(n.props?.children)
        : String(n ?? "");
  }
  const all = () => nodes(tree());
  const panel = () => all().find((n) => n.props?.title === "搜索用户 / 人工调账");
  const fields = () => nodes(panel()).filter((n) => n.type === "input" || n.type === "select");
  return {
    all,
    fields,
    text: () => text(tree()),
    async flush() {
      for (let i = 0; i < 5; i++) {
        tree();
        effects.splice(0).forEach((fn) => fn());
        await tick();
      }
    },
    input(placeholder, value) {
      all()
        .find((n) => n.type === "input" && n.props.placeholder === placeholder)
        .props.onChange({ target: { value } });
    },
    select(index, value) {
      fields()
        .filter((n) => n.type === "select")
        [index].props.onChange({ target: { value } });
    },
    button(label) {
      return all().find((n) => n.type === "button" && text(n).includes(label));
    },
  };
}
async function ready(f) {
  const p = page(f);
  await p.flush();
  p.select(0, "customer-A");
  p.input("金额，例如 300", "100");
  p.input("备注，例如微信转账已确认", "原人工调账");
  return p;
}
test("manual adjustment suppresses synchronous repeated clicks before React rerenders", async () => {
  const f = environment(),
    p = await ready(f);
  const button = p.button("给客户增加余额");
  button.props.onClick();
  button.props.onClick();
  await p.flush();
  assert.equal(f.posts.length, 1);
  assert.equal(typeof f.posts[0].body.requestId, "string");
});
test("manual adjustment unknown result locks target, direction, amount and note instead of allowing another intent", async () => {
  const f = environment();
  f.reply = () => response({ message: "synthetic unknown result" }, 500);
  const p = await ready(f);
  p.button("给客户增加余额").props.onClick();
  await p.flush();
  assert.equal(f.posts.length, 1);
  assert(
    p
      .fields()
      .filter((n) => n.props.placeholder !== "搜索昵称、邮箱、ID、角色或状态")
      .every((n) => n.props.disabled),
  );
  assert(p.button("给客户增加余额").props.disabled);
});
test("manual adjustment reload restores the original request and explicit retry replays the identical full body", async () => {
  const f = environment();
  f.reply = () => response({ message: "synthetic unknown result" }, 500);
  const p = await ready(f);
  p.button("给客户增加余额").props.onClick();
  await p.flush();
  const q = page(f);
  await q.flush();
  assert.equal(q.fields().find((n) => n.props.placeholder === "金额，例如 300").props.value, "100");
  assert(q.text().includes(f.posts[0].body.requestId));
  q.button("核对原调账").props.onClick();
  await q.flush();
  assert.equal(f.posts.length, 2);
  assert.deepEqual(f.posts[1].body, f.posts[0].body);
});

function client(f) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(path.join(root, "packages/ui/src/money-intent-client.ts"), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      exports,
      AbortController,
      setTimeout,
      clearTimeout,
      navigator: {
        get locks() {
          return f.noLocks ? undefined : lockManager;
        },
      },
    },
  );
  return exports.createMoneyIntentClient({
    purpose: "manual-adjustment",
    storage: f.localStorage,
    fetcher: f.fetch,
    getToken: () => f.token,
    makeRequestId: () => f.crypto.randomUUID(),
    scope: "http://synthetic.invalid",
  });
}
const body = { customerId: "customer-A", amount: "100", direction: "CREDIT", note: "原调账备注" };
const plain = (value) => JSON.parse(JSON.stringify(value));
for (const direction of ["CREDIT", "DEBIT"])
  test(
    "manual " +
      direction +
      " response is matched to actor target and request, retained on reload until explicit new business",
    async () => {
      const f = environment(),
        a = client(f);
      await a.refresh();
      let state = await a.submit({ ...body, direction }, "原客户");
      assert.equal(state.phase, "confirmed");
      assert.equal(f.posts.length, 1);
      assert.equal(f.posts[0].url, "/api/admin/users/customer-A/balance-adjustments");
      assert.equal(state.receipt.transaction.id, "transaction-original");
      const b = client(f);
      state = await b.refresh();
      assert.equal(state.phase, "confirmed");
      assert.equal(f.posts.length, 1);
      assert.deepEqual(plain(state.body), f.posts[0].body);
      await b.submit({ ...body, customerId: "customer-B" });
      assert.equal(f.posts.length, 1);
      state = await b.beginNew();
      assert.equal(state.phase, "empty");
      state = await b.submit({ ...body, customerId: "customer-B", direction });
      assert.equal(state.phase, "confirmed");
      assert.equal(f.posts.length, 2);
      assert.notEqual(f.posts[1].body.requestId, f.posts[0].body.requestId);
      assert.equal(f.posts[1].url, "/api/admin/users/customer-B/balance-adjustments");
      assert.equal([...f.storage.values()].join("").includes(f.token), false);
    },
  );
test("manual unknown operation cannot be replaced by changed customer, amount, direction or note and only exact replay confirms it", async () => {
  const f = environment(),
    a = client(f);
  await a.refresh();
  f.reply = async () => {
    throw Error("SYNTHETIC_LOST_RESPONSE_AFTER_COMMIT");
  };
  await a.submit(body, "原客户");
  const original = f.posts[0].body;
  const b = client(f);
  assert.equal((await b.refresh()).phase, "unknown");
  for (const changed of [
    { customerId: "customer-B" },
    { amount: "101" },
    { direction: "DEBIT" },
    { note: "另外一笔" },
  ]) {
    const state = await b.submit({ ...body, ...changed });
    assert.equal(state.phase, "unknown");
    assert.deepEqual(plain(state.body), original);
  }
  assert.equal((await b.beginNew()).phase, "unknown");
  assert.equal(f.posts.length, 1);
  f.reply = (url, value) => response({ ...f.good(url, value), replayed: true });
  const state = await b.retry();
  assert.equal(state.phase, "confirmed");
  assert.equal(f.posts.length, 2);
  assert.deepEqual(f.posts[1].body, original);
});
for (const outcome of ["confirmed", "unknown"])
  test("two independent clients racing the first manual " + outcome + " operation create one request", async () => {
    const f = environment(),
      a = client(f),
      b = client(f);
    await Promise.all([a.refresh(), b.refresh()]);
    let release;
    f.reply = (url, value) =>
      new Promise((resolve, reject) => {
        release = () =>
          outcome === "confirmed" ? resolve(response(f.good(url, value))) : reject(Error("SYNTHETIC_LOST"));
      });
    const first = a.submit(body),
      second = b.submit({ ...body, customerId: "customer-B" });
    await tick();
    assert.equal(f.posts.length, 1);
    release();
    await Promise.all([first, second]);
    assert.equal(f.posts.length, 1);
    assert.equal(b.state().targetId, "customer-A");
    assert.equal(b.state().body.requestId, a.state().body.requestId);
  });
test("manual storage read, write and nonretained writes refuse the adjustment before POST", async () => {
  for (const mode of ["failReads", "failWrites", "discardWrites"]) {
    const f = environment();
    f[mode] = true;
    const c = client(f);
    await c.refresh();
    const state = await c.submit(body);
    assert.equal(f.posts.length, 0, mode);
    assert(state.error);
  }
});
test("manual adjustment needs atomic lock support and a verified admin identity", async () => {
  for (const mode of ["noLocks", "customerRole"]) {
    const f = environment();
    if (mode === "noLocks") f.noLocks = true;
    else f.role = "CUSTOMER";
    const c = client(f);
    await c.refresh();
    const state = await c.submit(body);
    assert.equal(f.posts.length, 0);
    assert.equal(f.storage.size, 0);
    assert(state.error);
  }
});
test("an identity switch before sending or after an ambiguous adjustment never replays the old request as another admin", async () => {
  const f = environment(),
    c = client(f);
  await c.refresh();
  f.duringAuth = () => {
    f.token = "synthetic-admin-B-session";
    f.subject = "admin-B";
  };
  await c.submit(body);
  assert.equal(f.posts.length, 0);
  delete f.duringAuth;
  f.token = "synthetic-admin-A-session";
  f.subject = "admin-A";
  await c.refresh();
  f.reply = async () => {
    f.token = "synthetic-admin-B-session";
    f.subject = "admin-B";
    throw Error("SYNTHETIC_LOST");
  };
  await c.submit(body);
  assert.equal(f.posts.length, 1);
  assert.equal(c.state().connected, false);
  await c.refresh();
  await c.retry();
  assert.equal(f.posts.length, 1);
  f.token = "synthetic-admin-A-session";
  f.subject = "admin-A";
  const state = await c.refresh();
  assert.equal(state.phase, "unknown");
  assert.deepEqual(plain(state.body), f.posts[0].body);
});
test("manual receipt must match original request, customer, direction, amount and ledger identity", async () => {
  for (const change of [
    () => ({}),
    (r) => ({ ...r, requestId: "another-adjustment-00000000" }),
    (r) => ({ ...r, customerId: "customer-B" }),
    (r) => ({ ...r, direction: "DEBIT" }),
    (r) => ({ ...r, replayed: undefined }),
    (r) => ({ ...r, transaction: { ...r.transaction, id: "" } }),
    (r) => ({ ...r, transaction: { ...r.transaction, amount: "101" } }),
  ]) {
    const f = environment(),
      c = client(f);
    await c.refresh();
    f.reply = (url, value) => response(change(f.good(url, value)));
    const state = await c.submit(body);
    assert.equal(state.phase, "unknown");
    assert(state.error);
    assert.equal(f.posts.length, 1);
  }
});
test("manual first validation rollback unlocks corrections, while a retry rejection preserves an earlier unknown operation", async () => {
  const f = environment(),
    c = client(f);
  await c.refresh();
  f.reply = () => response({ message: "Insufficient available balance" }, 400);
  assert.equal((await c.submit({ ...body, direction: "DEBIT" })).phase, "empty");
  assert.equal(f.storage.size, 0);
  f.reply = async () => {
    throw Error("SYNTHETIC_LOST");
  };
  await c.submit(body);
  const original = [...f.storage.values()][0];
  f.reply = () => response({ message: "request mismatch" }, 400);
  assert.equal((await c.retry()).phase, "unknown");
  assert.equal([...f.storage.values()][0], original);
});
test("manual corrupt or foreign journal cannot send an adjustment or overwrite the saved operation", async () => {
  const f = environment(),
    c = client(f);
  await c.refresh();
  f.reply = async () => {
    throw Error("SYNTHETIC_LOST");
  };
  await c.submit(body);
  const key = [...f.storage.keys()][0],
    original = f.storage.get(key);
  f.storage.set(key, "bad-json");
  assert((await client(f).refresh()).error);
  assert.equal(f.posts.length, 1);
  f.storage.set(key, original);
  const damaged = JSON.parse(original);
  damaged.targetId = "customer-B";
  f.storage.set(key, JSON.stringify(damaged));
  const state = await client(f).submit(body);
  assert(state.error);
  assert.equal(f.posts.length, 1);
});
test("manual UI preserves its selected target when search changes and offers another adjustment only after a valid receipt", async () => {
  const f = environment();
  f.reply = () => response({ message: "unknown" }, 500);
  const p = await ready(f);
  p.select(1, "DEBIT");
  p.button("扣减客户余额").props.onClick();
  await p.flush();
  const original = f.posts[0].body;
  p.input("搜索昵称、邮箱、ID、角色或状态", "customer-B");
  await p.flush();
  assert.equal(p.fields().filter((n) => n.type === "select")[0].props.value, "customer-A");
  assert(p.fields().filter((n) => n.type === "select")[0].props.disabled);
  f.reply = (url, value) => response({ ...f.good(url, value), replayed: true });
  p.button("核对原调账").props.onClick();
  await p.flush();
  assert.equal(f.posts.length, 2);
  assert.deepEqual(f.posts[1].body, original);
  assert.match(p.text(), /transaction-original/);
  assert.match(p.text(), /它不是实时余额/);
  const q = page(f);
  await q.flush();
  assert.equal(f.posts.length, 2);
  assert(q.button("扣减客户余额").props.disabled);
  q.button("另记一笔调账").props.onClick();
  await q.flush();
  assert.equal(q.fields().find((n) => n.props.placeholder === "金额，例如 300").props.value, "");
  assert.equal(q.fields().filter((n) => n.type === "select")[0].props.value, "");
  assert.equal(f.posts.length, 2);
});
test("manual committed receipt survives a subsequent list refresh failure without enabling another submission", async () => {
  const f = environment(),
    baseFetch = f.fetch;
  let failList = false;
  f.fetch = (url, init) =>
    url === "/api/admin/users" && failList ? response({ message: "SYNTHETIC_LIST_FAILED" }, 500) : baseFetch(url, init);
  f.reply = (url, value) => {
    failList = true;
    return response(f.good(url, value));
  };
  const p = await ready(f);
  assert.doesNotMatch(p.text(), /操作失败/);
  p.button("给客户增加余额").props.onClick();
  await p.flush();
  assert.equal(f.posts.length, 1);
  assert.match(p.text(), /原人工调账已确认/);
  assert.match(p.text(), /用户余额尚未刷新/);
  assert.match(p.text(), /transaction-original/);
  assert(p.button("给客户增加余额").props.disabled);
});
