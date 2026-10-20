const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const tick = () => new Promise(resolve => setImmediate(resolve));
const customerPage = "../app/complaints/page.tsx";
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const ok = value => ({ok:true,json:async()=>value});
const order = id => ({id,orderNo:id,status:"COMPLETED",totalAmount:"10"});

test("customer initial load does not claim zero or an empty history", () => {
  const html = loadPage(customerPage, []).html();
  assert.match(html, /正在加载投诉/);
  assert.doesNotMatch(html, /暂无投诉记录|>0<\/div>/);
});

test("customer HTTP failure offers retry and successful empty response shows genuine zero", async () => {
  let fail = true;
  const page = loadPage(customerPage, [], async () => fail ? {ok:false} : ok([]));
  page.mount(); await tick();
  assert.match(page.html(), /无法加载真实投诉数据/);
  assert.doesNotMatch(page.html(), /暂无投诉记录|>0<\/div>/);
  fail = false;
  const retry = hostElements(page.tree()).find(e => e.type === "button" && e.props.children === "重试加载");
  assert.ok(retry); retry.props.onClick(); await tick();
  metric(page.html(), "处理中", 0);
  assert.match(page.html(), /暂无投诉记录/);
});

test("customer JSON failure never publishes a partially loaded order list", async () => {
  const page = loadPage(customerPage, [], async url => url.includes("orders") ? ok([order("partial")]) : {ok:true,json:async()=>{throw new Error("bad JSON");}});
  page.mount(); await tick();
  assert.equal(page.state[0].length, 0);
  assert.doesNotMatch(page.html(), /partial|暂无投诉记录|>0<\/div>/);
  assert.match(page.html(), /bad JSON/);
});

test("customer stale success and stale failure cannot replace latest response", async () => {
  for (const staleFails of [false,true]) {
    const pending = [];
    const page = loadPage(customerPage, [], () => { const d=deferred();pending.push(d);return d.promise; });
    page.mount();
    page.tree(); page.reload();
    pending[2].resolve(ok([order("new-order")])); pending[3].resolve(ok([complaint("RESOLVED")]));
    await tick();
    if (staleFails) pending[0].reject(new Error("stale failure"));
    else pending[0].resolve(ok([order("old-order")]));
    pending[1].resolve(ok([complaint("OPEN")])); await tick();
    assert.equal(page.state[0][0].id, "new-order");
    metric(page.html(), "已处理", 1);
    assert.doesNotMatch(page.html(), /stale failure|old-order/);
  }
});

test("customer unmount invalidates outstanding requests", async () => {
  const pending=[];
  const page=loadPage(customerPage, [], ()=>{const d=deferred();pending.push(d);return d.promise;});
  page.mount(); page.unmount();
  pending[0].resolve(ok([order("late")])); pending[1].resolve(ok([complaint("OPEN")])); await tick();
  assert.equal(page.state[0].length,0);
  assert.equal(page.state[1].length,0);
});

test("customer successful submission survives refresh failure without stale counts", async () => {
  let posts=0;
  const page=loadPage(customerPage, [[order("o")],[complaint("OPEN")],"o",undefined,"reason","","",false,"ready"], async (url,options)=>{
    if(options?.method === "POST"){posts++;return ok({});}
    throw new Error("refresh disconnected");
  });
  await hostElements(page.tree()).find(e=>e.type === "form").props.onSubmit({preventDefault(){}});
  assert.equal(posts,1);
  const html=page.html();
  assert.match(html,/投诉已提交/);
  assert.match(html,/refresh disconnected/);
  assert.doesNotMatch(html,/Synthetic complaint|>1<\/div>/);
  assert.equal(hostElements(page.tree()).find(e=>e.type === "select").props.disabled,true);
});

test("customer reload replaces an order selection absent from current response", async () => {
  const page=loadPage(customerPage, [[order("old")],[],"old"],async url=>ok(url.includes("orders")?[order("current")]:[]));
  page.mount();await tick();
  assert.equal(page.state[2],"current");
});

test("customer malformed payload cannot masquerade as loaded empty history", async () => {
  const page=loadPage(customerPage, [],async()=>ok({message:"wrong shape"}));
  page.mount();await tick();
  assert.match(page.html(),/投诉数据格式异常/);
  assert.doesNotMatch(page.html(),/暂无投诉记录|>0<\/div>/);
});

// Render the real page with isolated hook state and mocked transport.
// No browser, server, database, credentials, or external request is used.
function loadPage(relativePath, initialState, fetchImpl = async () => {
  throw new Error("Unexpected request");
}) {
  const filename = path.resolve(__dirname, relativePath);
  const localRequire = createRequire(filename);
  const state = [...initialState];
  const effects = [];
  let cursor = 0;
  let refCursor = 0;
  const refs = [];
  const cleanups = [];
  const wrapper = ({ children }) => React.createElement("div", null, children);
  const components = {
    CustomerShell: wrapper,
    AdminShell: wrapper,
    SectionHeader: () => null,
    StatusBadge: ({ children }) => React.createElement("span", null, children),
    ActionButton: ({ children, onClick }) => React.createElement("button", { onClick }, children),
    DataTable: ({ rows }) => React.createElement("div", null, rows.flat()),
  };
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], value => {
        state[index] = typeof value === "function" ? value(state[index]) : value;
      }];
    },
    useRef(initial) { const i = refCursor++; return refs[i] ??= { current: initial }; },
    useEffect(callback) { effects.push(callback); },
    useMemo: callback => callback(),
  };
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require(name) {
      if (name === "react") return hooks;
      if (name === "../components") return components;
      if (name === "next/link") return ({ children, href }) => React.createElement("a", { href }, children);
      return localRequire(name);
    },
    fetch: fetchImpl,
    Error,
    URLSearchParams,
    window: { location: { search: "" } },
    localStorage: { getItem: () => "synthetic-local-test" },
  }, { filename });
  return {
    tree() {
      cursor = 0;
      refCursor = 0;
      return module.exports.default();
    },
    mount() { this.tree(); effects.splice(0).forEach(effect => cleanups.push(effect())); },
    unmount() { cleanups.forEach(cleanup => cleanup?.()); },
    reload() { effects.splice(0).forEach(effect => effect()); },
    state,
    html() {
      return renderToStaticMarkup(this.tree());
    },
  };
}

function metric(html, label, expected) {
  const match = html.match(new RegExp(label + "</div><div[^>]*>(\\d+)</div>"));
  assert.ok(match, "Metric exists: " + label);
  assert.equal(Number(match[1]), expected, label);
}

function complaint(status) {
  return {
    id: "complaint-test",
    reason: "Synthetic complaint",
    status,
    createdAt: "2026-10-01T12:00:00Z",
    order: { orderNo: "TEST-1", status: "DISPUTED", totalAmount: "0" },
    reporter: { email: "synthetic@example.invalid", displayName: "Test reporter", role: "CUSTOMER" },
  };
}

for (const [status, pending, resolved, label] of [
  ["OPEN", 1, 0, "待处理"],
  ["IN_REVIEW", 1, 0, "处理中"],
  ["RESOLVED", 0, 1, "已处理"],
  ["REJECTED", 0, 1, "已驳回"],
]) {
  test("customer renders API complaint state " + status, () => {
    const page = loadPage("../app/complaints/page.tsx", [[], [complaint(status)], "", undefined, "", "", "", false, "ready"]);
    const html = page.html();
    metric(html, "处理中", pending);
    metric(html, "已处理", resolved);
    assert.match(html, new RegExp("<span[^>]*>" + label + "</span>"));
  });
}

test("customer counts mixed states and does not mark unknown states handled", () => {
  const rows = ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED", "UNKNOWN"].map(complaint);
  const page = loadPage("../app/complaints/page.tsx", [[], rows, "", undefined, "", "", "", false, "ready"]);
  const html = page.html();
  metric(html, "处理中", 2);
  metric(html, "已处理", 2);
  assert.match(html, /<span[^>]*>UNKNOWN<\/span>/);
  assert.doesNotMatch(html, /含通过\/拒绝\/关闭/);
});

test("customer empty complaint list has zero counts", () => {
  const html = loadPage("../app/complaints/page.tsx", [[], [], "", undefined, "", "", "", false, "ready"]).html();
  metric(html, "处理中", 0);
  metric(html, "已处理", 0);
});

function hostElements(element) {
  if (element == null || typeof element !== "object") return [];
  if (Array.isArray(element)) return element.flatMap(hostElements);
  if (typeof element.type === "function") return hostElements(element.type(element.props));
  return [element, ...hostElements(element.props?.children)];
}

test("admin processing button sends IN_REVIEW and refreshes displayed counts", async () => {
  const requests = [];
  const page = loadPage("../../admin-web/app/complaints/page.tsx", [[complaint("OPEN")], "", "", "", false, ""], async (url, options) => {
    requests.push({ url, options });
    if (requests.length === 1) return { ok: true, json: async () => complaint("IN_REVIEW") };
    return { ok: true, json: async () => [complaint("IN_REVIEW")] };
  });
  metric(page.html(), "新投诉", 1);
  metric(page.html(), "处理中", 0);
  const button = hostElements(page.tree()).find(element => element.type === "button" && element.props.children === "处理中");
  assert.ok(button, "Rendered processing button exists");
  button.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "/api/admin/complaints/complaint-test/review");
  assert.equal(requests[0].options.method, "PATCH");
  assert.deepEqual(JSON.parse(requests[0].options.body), { status: "IN_REVIEW", resolution: "" });
  assert.equal(requests[1].url, "/api/admin/complaints");
  const html = page.html();
  metric(html, "新投诉", 0);
  metric(html, "处理中", 1);
  metric(html, "已解决", 0);
  assert.match(html, /投诉状态已更新/);
});

test("admin failed processing request retains OPEN state and displays failure", async () => {
  const requests = [];
  const page = loadPage("../../admin-web/app/complaints/page.tsx", [[complaint("OPEN")], "", "", "", false, ""], async (url, options) => {
    requests.push({ url, options });
    return { ok: false, json: async () => ({ message: "Synthetic review rejected" }) };
  });
  const button = hostElements(page.tree()).find(element => element.type === "button" && element.props.children === "处理中");
  assert.ok(button);
  button.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1);
  const html = page.html();
  metric(html, "新投诉", 1);
  metric(html, "处理中", 0);
  assert.match(html, /Synthetic review rejected/);
  assert.doesNotMatch(html, /投诉状态已更新/);
});

test("admin initial loading does not present zero complaint statistics", () => {
  const html = loadPage("../../admin-web/app/complaints/page.tsx", []).html();
  assert.match(html, /正在加载投诉/);
  assert.doesNotMatch(html, /新投诉<\/div><div/);
});

test("admin load failure hides statistics and retry renders all four states", async () => {
  let calls = 0;
  const page = loadPage("../../admin-web/app/complaints/page.tsx", [], async () => {
    calls++;
    if (calls === 1) return { ok: false };
    return { ok: true, json: async () => ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"].map(complaint) };
  });
  page.mount();
  await new Promise(resolve => setImmediate(resolve));
  let html = page.html();
  assert.match(html, /无法加载真实投诉数据/);
  assert.doesNotMatch(html, /新投诉<\/div><div/);
  const retry = hostElements(page.tree()).find(element => element.type === "button" && element.props.children === "重试加载");
  assert.ok(retry);
  retry.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  html = page.html();
  for (const label of ["新投诉", "处理中", "已解决", "已拒绝"]) metric(html, label, 1);
  assert.doesNotMatch(html, /无法加载真实投诉数据|正在加载投诉/);
});

test("admin successful empty response is distinguishable from loading or failure", async () => {
  const page = loadPage("../../admin-web/app/complaints/page.tsx", [], async () => ({ ok: true, json: async () => [] }));
  page.mount();
  await new Promise(resolve => setImmediate(resolve));
  const html = page.html();
  for (const label of ["新投诉", "处理中", "已解决", "已拒绝"]) metric(html, label, 0);
  assert.doesNotMatch(html, /无法加载真实投诉数据|正在加载投诉/);
});

test("admin refresh failure after review does not present stale OPEN counts", async () => {
  let calls = 0;
  const page = loadPage("../../admin-web/app/complaints/page.tsx", [[complaint("OPEN")], "", "", "", false, ""], async () => {
    calls++;
    if (calls === 1) return { ok: true, json: async () => complaint("IN_REVIEW") };
    throw new Error("Synthetic refresh disconnected");
  });
  const button = hostElements(page.tree()).find(element => element.type === "button" && element.props.children === "处理中");
  button.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  const html = page.html();
  assert.match(html, /无法加载真实投诉数据/);
  assert.doesNotMatch(html, /新投诉<\/div><div/);
});

test("admin review network failure is shown without changing loaded statistics", async () => {
  const page = loadPage("../../admin-web/app/complaints/page.tsx", [[complaint("OPEN")], "", "", "", false, ""], async () => {
    throw new Error("Synthetic review disconnected");
  });
  const button = hostElements(page.tree()).find(element => element.type === "button" && element.props.children === "处理中");
  button.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  const html = page.html();
  metric(html, "新投诉", 1);
  metric(html, "处理中", 0);
  assert.match(html, /投诉处理失败/);
});
