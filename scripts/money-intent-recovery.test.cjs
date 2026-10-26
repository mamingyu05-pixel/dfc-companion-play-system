const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  assert = require("node:assert/strict"),
  { createRequire } = require("node:module");
const root = "E:/codex专用工作区/release-20261026/dfc";
const deps = createRequire(root + "/apps/customer-web/package.json"),
  ts = deps("typescript"),
  React = deps("react"),
  jsx = deps("react/jsx-runtime");
const tick = () => new Promise((r) => setImmediate(r));
const lockTails = new Map();
const lockManager = {
  request(name, work) {
    const previous = lockTails.get(name) || Promise.resolve();
    const run = previous.catch(() => {}).then(work);
    const settled = run.then(
      () => {},
      () => {},
    );
    lockTails.set(name, settled);
    return run.finally(() => {
      if (lockTails.get(name) === settled) lockTails.delete(name);
    });
  },
};
let uuid = 0;
const crypto = { randomUUID: () => "synthetic-intent-" + String(++uuid).padStart(8, "0") };
const sharedStorage = new Map();
function harness(file, fetcher, { token = "synthetic-token-a", storage = sharedStorage, quick = false } = {}) {
  const states = [],
    refs = [],
    memo = [],
    effects = [],
    effectDeps = [];
  let si = 0,
    ri = 0,
    mi = 0,
    ei = 0;
  const hooks = {
    useState(v) {
      const n = si++;
      if (!(n in states)) states[n] = typeof v === "function" ? v() : v;
      return [states[n], (x) => (states[n] = typeof x === "function" ? x(states[n]) : x)];
    },
    useRef(v) {
      return (refs[ri++] ||= { current: v });
    },
    useMemo(fn, deps) {
      const n = mi++,
        p = memo[n];
      if (p && deps.every((v, i) => Object.is(v, p.deps[i]))) return p.value;
      const value = fn();
      memo[n] = { deps, value };
      return value;
    },
    useEffect(fn, deps) {
      const n = ei++,
        old = effectDeps[n];
      if (!old || !deps || deps.some((v, i) => !Object.is(v, old[i]))) {
        effectDeps[n] = deps;
        effects.push(fn);
      }
    },
  };
  const Wrapper = ({ children }) => React.createElement("div", null, children),
    components = new Proxy({}, { get: () => Wrapper });
  const localStorage = {
    getItem: (k) => (k.endsWith("_token") ? token : (storage.get(k) ?? null)),
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  };
  const sessionStorage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  };
  const context = {
    navigator: { locks: lockManager },
    AbortController,
    crypto,
    sessionStorage,
    localStorage,
    fetch: fetcher,
    window: { confirm: () => true, location: { origin: "http://synthetic.invalid" } },
    document: { body: { style: { background: "" } } },
    setTimeout(fn, ms) {
      if (ms >= 10000) return 2;
      Promise.resolve().then(fn);
      return 1;
    },
    clearTimeout() {},
  };
  function load(file, append = "") {
    const exports = {};
    vm.runInNewContext(
      ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8") + append, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      }).outputText,
      {
        ...context,
        exports,
        require(id) {
          if (id === "react") return hooks;
          if (id === "react/jsx-runtime") return jsx;
          if (id === "@dfc/ui")
            return { ...load("packages/ui/src/submit-intent.ts"), ...load("packages/ui/src/money-intent-client.ts") };
          if (id === "../batch-tools") return load("apps/admin-web/app/batch-tools.tsx");
          if (id.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, k) => k }) };
          if (id.endsWith("/components") || id === "../auth-gate") return components;
          throw Error("Unexpected fixture import " + id);
        },
      },
    );
    return exports;
  }
  const page = load(file, quick ? "\nexports.AuditQuickOrder = QuickOrder;" : ""),
    render = quick ? page.AuditQuickOrder : page.default;
  function tree() {
    si = ri = mi = ei = 0;
    return render();
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
  return {
    all,
    text: () => text(tree()),
    states,
    async flush() {
      for (let i = 0; i < 5; i++) {
        tree();
        effects.splice(0).forEach((fn) => fn());
        await tick();
      }
    },
    input(n, value) {
      all()
        .filter((e) => e.type === "input")
        [n].props.onChange({ target: { value } });
    },
    button(s) {
      return all().find((e) => e.type === "button" && text(e).includes(s));
    },
    async form() {
      await all()
        .find((e) => e.type === "form")
        .props.onSubmit({ preventDefault() {} });
      await tick();
    },
  };
}

const { test } = require("node:test");
const ok = (data) => ({ ok: true, status: 200, json: async () => data });
const identity = { user: { id: "synthetic-owner", role: "ADMIN" }, companionProfile: { status: "LISTED" } };
const summary = {
  wallet: { availableIncome: "500", pendingIncome: "0", frozenIncome: "0", disputeReserve: "0" },
  withdrawingAmount: "0",
  withdrawalRequests: [],
};
function transport(posts, quick = false) {
  return async (url, init = {}) => {
    if (url === "/api/auth/me") return ok(identity);
    if (url.includes("/payout-profile")) return ok({});
    if (url.includes("/companion-summary")) return ok(summary);
    if (url.includes("/customers/search"))
      return ok([{ id: "synthetic-customer", displayName: "合成客户", balance: "200", platforms: [] }]);
    if (url.endsWith("/preview"))
      return ok({ mode: "烽火地带", hours: "2", unitPrice: "50", totalAmount: "100", balance: "200", shortfall: "0" });
    if (init.method === "POST") {
      posts.push(JSON.parse(init.body));
      throw Error("SYNTHETIC_RESPONSE_LOST_AFTER_ACCEPTANCE");
    }
    return ok([]);
  };
}
test("withdrawal unknown result keeps amount, account and new submission locked", async () => {
  sharedStorage.clear();
  const posts = [],
    p = harness("apps/companion-web/app/withdrawals/page.tsx", transport(posts));
  await p.flush();
  p.input(0, "100");
  p.input(1, "SYNTHETIC-ACCOUNT");
  await p.form();
  assert.equal(posts.length, 1);
  assert(
    p
      .all()
      .filter((e) => e.type === "input")
      .every((e) => e.props.disabled),
    "unknown fields must be disabled",
  );
  assert(p.button("提交提现申请").props.disabled, "unknown new submission must be disabled");
});
test("staff recharge reload restores the original customer, amount and request id", async () => {
  sharedStorage.clear();
  const posts = [],
    fetcher = transport(posts);
  const p = harness("apps/admin-web/app/staff-recharge/page.tsx", fetcher);
  p.input(0, "合成客户");
  await p.flush();
  p.button("合成客户").props.onClick();
  await p.flush();
  p.input(0, "100");
  p.button("确认入账").props.onClick();
  await tick();
  const q = harness("apps/admin-web/app/staff-recharge/page.tsx", fetcher);
  await q.flush();
  assert.equal(q.all().filter((e) => e.type === "input")[0].props.value, "100");
  assert(q.text().includes(posts[0].requestId));
  q.button("核对原申请").props.onClick();
  await tick();
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[1], posts[0]);
});
test("quick-order reload holds the original full body and replays the same request", async () => {
  sharedStorage.clear();
  const posts = [],
    fetcher = transport(posts, true);
  const p = harness("apps/admin-web/app/quick-order/page.tsx", fetcher, { quick: true });
  p.input(0, "合成客户");
  await p.flush();
  p.button("合成客户").props.onClick();
  await p.flush();
  p.button("下单并发到派单频道").props.onClick();
  await tick();
  const q = harness("apps/admin-web/app/quick-order/page.tsx", fetcher, { quick: true });
  await q.flush();
  assert(q.text().includes(posts[0].requestId));
  q.button("核对原申请").props.onClick();
  await tick();
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[1], posts[0]);
});

function moneyFixture(purpose = "withdrawal") {
  const saved = new Map();
  let serial = 0;
  const f = {
    token: "synthetic-session-A",
    subject: "actor-A",
    posts: [],
    saved,
    getFail: false,
    setFail: false,
    discard: false,
  };
  const storage = {
    getItem(k) {
      if (f.getFail) throw Error("SYNTHETIC_STORAGE_READ");
      return saved.get(k) ?? null;
    },
    setItem(k, v) {
      if (f.setFail) throw Error("SYNTHETIC_STORAGE_WRITE");
      if (!f.discard) saved.set(k, v);
    },
    removeItem: (k) => saved.delete(k),
  };
  f.good = (url, b) =>
    url.includes("withdrawal-requests")
      ? {
          id: "withdrawal-1",
          companionId: f.subject,
          requestId: b.requestId,
          amount: b.amount,
          payoutAccount: b.payoutAccount,
          status: "PENDING",
        }
      : url.includes("staff-record")
        ? {
            requestId: b.requestId,
            replayed: false,
            recharge: { id: "recharge-1", customerId: b.customerId, amount: b.amount, status: "APPROVED" },
          }
        : {
            outcome: "ORDER_CREATED",
            requestId: b.requestId,
            order: { id: "order-1", orderNo: "SYNTHETIC-ORDER", totalAmount: b.expectedTotalAmount, status: "PAID" },
            recharge: b.topUp
              ? { id: "recharge-1", amount: b.topUp.amount, requestId: b.requestId + "-topup", replayed: true }
              : null,
            toppedUp: false,
            dispatched: true,
          };
  f.reply = (url, b) => ok(f.good(url, b));
  const fetcher = async (url, init = {}) => {
    if (url === "/api/auth/me") {
      const data = { user: { id: f.subject, role: "ADMIN" }, companionProfile: { status: "LISTED" } };
      if (f.duringAuth) f.duringAuth();
      return ok(data);
    }
    const b = JSON.parse(init.body);
    f.posts.push({ url, body: b, token: init.headers.Authorization });
    return f.reply(url, b);
  };
  const ex = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(path.join(root, "packages/ui/src/money-intent-client.ts"), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      exports: ex,
      navigator: {
        get locks() {
          return f.noLocks ? undefined : lockManager;
        },
      },
      AbortController,
      setTimeout,
      clearTimeout,
    },
  );
  f.client = (p = purpose, scope = "http://synthetic.invalid") =>
    ex.createMoneyIntentClient({
      purpose: p,
      storage,
      fetcher,
      getToken: () => f.token,
      makeRequestId: () => "synthetic-money-" + String(++serial).padStart(8, "0"),
      scope,
    });
  f.body =
    purpose === "withdrawal"
      ? { amount: "100", payoutAccount: "SYNTHETIC-ACCOUNT", note: "original note" }
      : purpose === "staff-recharge"
        ? {
            customerId: "customer-A",
            amount: "100",
            method: "WECHAT",
            note: "original note",
            screenshotUrl: "data:synthetic",
          }
        : {
            customerId: "customer-A",
            kind: "HOURLY",
            game: "DELTA_FORCE",
            mode: "烽火地带",
            hours: "2",
            companionId: "companion-A",
            expectedTotalAmount: "100",
            notes: "original note",
            topUp: { amount: "100", method: "WECHAT", screenshotUrl: "data:synthetic" },
          };
  return f;
}
for (const purpose of ["withdrawal", "staff-recharge", "quick-order"])
  test(
    purpose + ": lost response survives reload, preserves exact body, and confirmed receipt needs explicit new intent",
    async () => {
      const f = moneyFixture(purpose),
        a = f.client();
      await a.refresh();
      f.reply = async () => {
        throw Error("SYNTHETIC_LOST_RESPONSE");
      };
      let s = await a.submit(f.body, "original customer");
      assert.equal(s.phase, "unknown");
      assert.equal(f.posts.length, 1);
      const original = f.posts[0].body;
      const b = f.client();
      s = await b.refresh();
      assert.deepEqual(JSON.parse(JSON.stringify(s.body)), original);
      assert.equal(s.phase, "unknown");
      s = await b.submit({ ...f.body, amount: "101", customerId: "different-customer" });
      assert.equal(f.posts.length, 1);
      assert.deepEqual(JSON.parse(JSON.stringify(s.body)), original);
      s = await b.beginNew();
      assert.equal(s.phase, "unknown");
      f.reply = (url, body) => ok(f.good(url, body));
      s = await b.retry();
      assert.equal(s.phase, "confirmed");
      assert.deepEqual(f.posts[1].body, original);
      const c = f.client();
      s = await c.refresh();
      assert.equal(s.phase, "confirmed");
      assert.equal(f.posts.length, 2);
      s = await c.submit(f.body);
      assert.equal(s.phase, "confirmed");
      assert.equal(f.posts.length, 2);
      s = await c.beginNew();
      assert.equal(s.phase, "empty");
      assert.equal(savedStrings(f).includes(f.token), false);
    },
  );
function savedStrings(f) {
  return [...f.saved.values()].join("\n");
}
test("storage read failure, write failure and nonretained write all stop before money POST", async () => {
  for (const mode of ["getFail", "setFail", "discard"]) {
    const f = moneyFixture();
    f[mode] = true;
    const c = f.client();
    await c.refresh();
    const s = await c.submit(f.body);
    assert.equal(f.posts.length, 0, mode);
    assert(s.error);
  }
});
test("corrupt and foreign target journals fail closed without POST or overwrite", async () => {
  const f = moneyFixture("staff-recharge"),
    c = f.client();
  await c.refresh();
  f.reply = async () => {
    throw Error("LOST");
  };
  await c.submit(f.body);
  const key = [...f.saved.keys()][0],
    original = f.saved.get(key);
  f.saved.set(key, "not-json");
  assert((await f.client().refresh()).error);
  assert.equal(f.posts.length, 1);
  f.saved.set(key, original);
  const record = JSON.parse(original);
  record.targetId = "another-customer";
  f.saved.set(key, JSON.stringify(record));
  assert((await f.client().refresh()).error);
  assert.equal(f.posts.length, 1);
});
test("synchronous repeated submits send one POST before a React render", async () => {
  const f = moneyFixture(),
    c = f.client();
  await c.refresh();
  await Promise.all([c.submit(f.body), c.submit(f.body), c.submit(f.body)]);
  assert.equal(f.posts.length, 1);
  assert.equal(c.state().phase, "confirmed");
});
test("another tab cannot replace an unknown target or clear a newer journal", async () => {
  const f = moneyFixture("staff-recharge"),
    a = f.client(),
    b = f.client();
  await a.refresh();
  f.reply = async () => {
    throw Error("LOST");
  };
  await a.submit(f.body);
  await b.refresh();
  await b.submit({ ...f.body, customerId: "customer-B" });
  assert.equal(f.posts.length, 1);
  assert.equal(b.state().targetId, "customer-A");
  f.reply = (url, body) => ok(f.good(url, body));
  await b.retry();
  await b.beginNew();
  f.reply = async () => {
    throw Error("LOST");
  };
  await b.submit({ ...f.body, customerId: "customer-B" });
  const newer = [...f.saved.values()][0];
  await a.beginNew();
  assert.equal([...f.saved.values()][0], newer);
  assert.equal(f.posts.length, 3);
});
test("identity changes before POST and during a lost response never replay the old body as another user", async () => {
  const f = moneyFixture(),
    c = f.client();
  await c.refresh();
  f.duringAuth = () => {
    f.token = "synthetic-session-B";
    f.subject = "actor-B";
  };
  await c.submit(f.body);
  assert.equal(f.posts.length, 0);
  delete f.duringAuth;
  f.token = "synthetic-session-A";
  f.subject = "actor-A";
  await c.refresh();
  f.reply = async () => {
    f.token = "synthetic-session-B";
    f.subject = "actor-B";
    throw Error("LOST");
  };
  await c.submit(f.body);
  assert.equal(f.posts.length, 1);
  assert.equal(c.state().connected, false);
  await c.refresh();
  await c.retry();
  assert.equal(f.posts.length, 1);
  f.token = "synthetic-session-A";
  f.subject = "actor-A";
  assert.equal((await c.refresh()).phase, "unknown");
});
test("purposes and origins preserve separate journals without overwriting another operation", async () => {
  const f = moneyFixture("staff-recharge");
  f.reply = async () => {
    throw Error("LOST");
  };
  const a = f.client(),
    b = f.client("quick-order"),
    c = f.client("staff-recharge", "http://other.invalid");
  await a.refresh();
  await a.submit(f.body);
  await b.refresh();
  await b.submit({ ...f.body, expectedTotalAmount: "100", kind: "HOURLY" });
  await c.refresh();
  await c.submit(f.body);
  assert.equal(f.saved.size, 3);
  assert.equal(f.posts.length, 3);
});
test("empty, wrong request, wrong account and wrong owner receipts never clear unknown state", async () => {
  for (const change of [
    () => ({}),
    (v) => ({ ...v, requestId: "foreign-request" }),
    (v) => ({ ...v, payoutAccount: "another-account" }),
    (v) => ({ ...v, companionId: "another-user" }),
  ]) {
    const f = moneyFixture(),
      c = f.client();
    await c.refresh();
    f.reply = (url, b) => ok(change(f.good(url, b)));
    const s = await c.submit(f.body);
    assert.equal(s.phase, "unknown");
    assert(s.error);
  }
});
test("only an initial simple transaction validation rejection permits editing; retry rejection keeps an earlier unknown request", async () => {
  const f = moneyFixture(),
    c = f.client();
  await c.refresh();
  f.reply = () => ({ ok: false, status: 400, json: async () => ({ message: "invalid amount" }) });
  assert.equal((await c.submit(f.body)).phase, "empty");
  f.reply = async () => {
    throw Error("LOST");
  };
  await c.submit(f.body);
  f.reply = () => ({ ok: false, status: 400, json: async () => ({ message: "invalid amount" }) });
  assert.equal((await c.retry()).phase, "unknown");
  assert.equal(f.saved.size, 1);
});
test("quick partial receipt stays visible and order correction preserves original customer, top-up and request id", async () => {
  const f = moneyFixture("quick-order"),
    c = f.client();
  await c.refresh();
  f.reply = (url, b) =>
    ok({
      outcome: "RECHARGE_COMMITTED_ORDER_NOT_CREATED",
      requestId: b.requestId,
      recharge: { id: "recharge-1", amount: "100.00", requestId: b.requestId + "-topup", replayed: false },
      order: null,
      toppedUp: true,
      dispatched: false,
      error: { message: "价格已经变化", orderOutcome: "NOT_COMMITTED" },
    });
  let s = await c.submit(f.body, "customer A");
  assert.equal(s.phase, "partial");
  assert.equal(s.receipt.recharge.id, "recharge-1");
  const original = f.posts[0].body;
  const reload = f.client();
  s = await reload.refresh();
  assert.equal(s.phase, "partial");
  assert.equal(f.posts.length, 1);
  f.reply = (url, b) => ok(f.good(url, b));
  s = await reload.continueOrder({
    customerId: "malicious-target",
    requestId: "malicious-id",
    topUp: { amount: "999" },
    expectedTotalAmount: "80",
    customUnitPrice: "40",
  });
  assert.equal(s.phase, "confirmed");
  const corrected = f.posts[1].body;
  assert.equal(corrected.requestId, original.requestId);
  assert.equal(corrected.customerId, original.customerId);
  assert.deepEqual(corrected.topUp, original.topUp);
  assert.equal(corrected.expectedTotalAmount, "80");
  assert.equal(corrected.customUnitPrice, "40");
});
test("a failed partial-order continuation keeps the corrected exact body and original committed recharge proof", async () => {
  const f = moneyFixture("quick-order"),
    c = f.client();
  await c.refresh();
  f.reply = (url, b) =>
    ok({
      outcome: "RECHARGE_COMMITTED_ORDER_NOT_CREATED",
      requestId: b.requestId,
      recharge: { id: "recharge-1", amount: "100", requestId: b.requestId + "-topup", replayed: false },
      order: null,
      error: { orderOutcome: "NOT_COMMITTED", message: "price" },
    });
  await c.submit(f.body);
  f.reply = async () => {
    throw Error("LOST");
  };
  let s = await c.continueOrder({ expectedTotalAmount: "80" });
  assert.equal(s.phase, "unknown");
  assert.equal(s.receipt.recharge.id, "recharge-1");
  assert.equal(s.body.expectedTotalAmount, "80");
  const reload = f.client();
  s = await reload.refresh();
  assert.equal(s.phase, "unknown");
  await reload.continueOrder({ expectedTotalAmount: "70" });
  assert.equal(f.posts.length, 2);
  assert.equal(reload.state().body.expectedTotalAmount, "80");
});

for (const outcome of ["confirmed", "unknown"])
  test(
    "two independent clients competing for the first " + outcome + " operation share a real lock boundary",
    async () => {
      const f = moneyFixture("staff-recharge"),
        a = f.client(),
        b = f.client();
      await Promise.all([a.refresh(), b.refresh()]);
      let release;
      f.reply = (url, body) =>
        new Promise((resolve, reject) => {
          release = () => (outcome === "confirmed" ? resolve(ok(f.good(url, body))) : reject(Error("LOST")));
        });
      const pa = a.submit(f.body),
        pb = b.submit({ ...f.body, customerId: "customer-B" });
      await tick();
      assert.equal(f.posts.length, 1);
      assert.equal(f.saved.size, 1);
      release();
      await Promise.all([pa, pb]);
      assert.equal(f.posts.length, 1);
      assert.equal(b.state().targetId, "customer-A");
      assert.equal(b.state().body.requestId, a.state().body.requestId);
    },
  );
test("missing Web Locks stops before journal writes or money POST", async () => {
  const f = moneyFixture();
  f.noLocks = true;
  const c = f.client();
  await c.refresh();
  const s = await c.submit(f.body);
  assert.equal(f.posts.length, 0);
  assert.equal(f.saved.size, 0);
  assert.match(s.error, /安全锁/);
});
test("same-customer same-amount staff receipt with a different request id stays unknown", async () => {
  const f = moneyFixture("staff-recharge"),
    c = f.client();
  await c.refresh();
  f.reply = (url, b) => ok({ ...f.good(url, b), requestId: "another-request-00000000" });
  const s = await c.submit(f.body);
  assert.equal(s.phase, "unknown");
  assert.match(s.error, /有效回执/);
});
test("quick-order page presents committed recharge separately and correction only resumes its original order", async () => {
  sharedStorage.clear();
  const posts = [];
  let charged = false;
  const fetcher = async (url, init = {}) => {
    if (url === "/api/auth/me") return ok(identity);
    if (url.includes("/customers/search"))
      return ok([{ id: "synthetic-customer", displayName: "合成客户", balance: "0", platforms: [] }]);
    if (url.endsWith("/preview")) {
      const b = JSON.parse(init.body),
        total = b.customUnitPrice ? String(Number(b.customUnitPrice) * Number(b.hours)) : "100",
        balance = charged ? "100" : "0";
      return ok({
        mode: b.mode,
        hours: b.hours,
        unitPrice: b.customUnitPrice || "50",
        totalAmount: total,
        balance,
        shortfall: String(Math.max(Number(total) - Number(balance), 0)),
      });
    }
    if (url === "/api/admin/quick-order") {
      const b = JSON.parse(init.body);
      posts.push(b);
      charged = true;
      const recharge = {
        id: "synthetic-recharge-original",
        amount: "100.00",
        requestId: b.requestId + "-topup",
        replayed: posts.length > 1,
      };
      if (posts.length === 1)
        return ok({
          outcome: "RECHARGE_COMMITTED_ORDER_NOT_CREATED",
          requestId: b.requestId,
          recharge,
          order: null,
          toppedUp: true,
          dispatched: false,
          error: { message: "原报价已变化", orderOutcome: "NOT_COMMITTED" },
        });
      return ok({
        outcome: "ORDER_CREATED",
        requestId: b.requestId,
        recharge,
        order: {
          id: "synthetic-order-original",
          orderNo: "SYNTHETIC-ORDER",
          totalAmount: b.expectedTotalAmount,
          status: "PAID",
        },
        dispatched: true,
        dispatchMode: "OPEN",
        toppedUp: false,
      });
    }
    return ok([]);
  };
  const p = harness("apps/admin-web/app/quick-order/page.tsx", fetcher, { quick: true });
  p.input(0, "合成客户");
  await p.flush();
  p.button("合成客户").props.onClick();
  await p.flush();
  assert.equal(p.button("下单并发到派单频道").props.disabled, false);
  p.button("下单并发到派单频道").props.onClick();
  await p.flush();
  assert.equal(posts.length, 1);
  assert.match(p.text(), /已代充本金 ¥100.00/);
  assert.match(p.text(), /synthetic-recharge-original/);
  assert.match(p.text(), /订单尚未创建/);
  assert(p.button("换客户").props.disabled);
  const q = harness("apps/admin-web/app/quick-order/page.tsx", fetcher, { quick: true });
  await q.flush();
  assert.equal(posts.length, 1);
  assert.match(q.text(), /订单尚未创建/);
  const custom = q.all().find((e) => e.type === "input" && e.props.placeholder === "¥\/小时");
  assert(custom);
  custom.props.onChange({ target: { value: "60" } });
  await q.flush();
  assert.equal(q.button("核对后继续原订单").props.disabled, true);
  assert(q.all().some((e) => e.type === "input" && e.props.value === "100" && e.props.disabled));
  assert.match(q.text(), /当前余额仍不足/);
  custom.props.onChange({ target: { value: "40" } });
  await q.flush();
  const button = q.button("核对后继续原订单");
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  await q.flush();
  assert.equal(posts.length, 2);
  assert.equal(posts[1].requestId, posts[0].requestId);
  assert.equal(posts[1].customerId, posts[0].customerId);
  assert.deepEqual(posts[1].topUp, posts[0].topUp);
  assert.equal(posts[1].expectedTotalAmount, "80");
  assert.match(q.text(), /已下单 SYNTHETIC-ORDER/);
});

test("quick order without a top-up cannot adopt an unrelated recharge receipt", async () => {
  const f = moneyFixture("quick-order"),
    c = f.client();
  await c.refresh();
  f.reply = (url, b) =>
    ok({
      ...f.good(url, b),
      recharge: { id: "foreign-recharge", amount: "100", requestId: "another-id-topup", replayed: true },
    });
  const s = await c.submit({ ...f.body, topUp: null });
  assert.equal(s.phase, "unknown");
  assert.match(s.error, /代充回执/);
});
