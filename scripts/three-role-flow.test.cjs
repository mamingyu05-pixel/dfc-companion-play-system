const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createRequire } = require("node:module");
const root = process.env.DFC_FLOW_SOURCE_ROOT || path.resolve(__dirname, "..");
const dependencies = process.env.DFC_FLOW_DEPENDENCY_ROOT || root;
const localRequire = createRequire(path.join(dependencies, "apps/customer-web/package.json"));
const ts = localRequire("typescript");
const React = localRequire("react");
const jsx = localRequire("react/jsx-runtime");
const { renderToStaticMarkup } = localRequire("react-dom/server");
const ok = value => ({ ok: true, status: 200, json: async () => value });
const tick = () => new Promise(resolve => setImmediate(resolve));
const elements = node => !node || typeof node !== "object" ? [] : Array.isArray(node)
  ? node.flatMap(elements) : [node, ...elements(node.props?.children)];
function page(relative, fetch = async () => ok({}), extras = {}) {
  const state = [], effects = [], refs = []; let cursor = 0, refCursor = 0;
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial;
      return [state[i], value => { state[i] = typeof value === "function" ? value(state[i]) : value; }]; },
    useMemo: fn => fn(), useEffect: fn => effects.push(fn),
    useRef(initial) { const i = refCursor++; return refs[i] || (refs[i] = { current: initial }); },
  };
  const Wrapper = ({ children }) => React.createElement("div", null, children);
  const components = new Proxy({}, { get: (_, name) => name === "DataTable"
    ? ({ rows }) => React.createElement("div", null, ...rows.flat()) : name === "SectionHeader"
      ? ({ title, desc }) => React.createElement("header", null, title, desc)
      : name === "OrderCard" ? props => React.createElement("article", null, props.order.id,
        React.createElement("button", { onClick: props.onAction }, props.action)) : Wrapper });
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {};
    modules.set(file, exports);
    const source = fs.readFileSync(path.join(root, file), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
    vm.runInNewContext(compiled.outputText, { exports, fetch, URLSearchParams, ...extras,
      localStorage: { getItem: () => "synthetic-session" }, window: { location: { search: "" } },
      require(id) {
        if (id === "react") return hooks;
        if (id === "react/jsx-runtime") return jsx;
        if (id === "next/link") return Wrapper;
        if (id === "../components") return components;
        if (id.startsWith(".")) {
          const target = path.join(path.dirname(file), id);
          const found = [target, target + ".ts", target + ".tsx"].find(name => fs.existsSync(path.join(root, name)));
          if (found) return load(found);
        }
        throw new Error(`Unexpected import: ${id}`);
      },
    });
    return exports;
  }
  const exports = load(relative);
  return {
    tree() { cursor = refCursor = 0; return exports.default(); },
    all() { return elements(this.tree()); }, html() { return renderToStaticMarkup(this.tree()); },
    mount() { this.tree(); effects.splice(0).forEach(effect => effect()); },
  };
}
test("order page trial/reservation entry renders the real demand guide without submitting an order", async () => {
  const requests = [];
  const p = page("apps/customer-web/app/order/page.tsx", async (url, options) => {
    requests.push({ url, method: options?.method || "GET" });
    throw new Error("The demand navigation must not make a request");
  });
  const entry = p.all().find(e => e.type === "button" && e.props.children === "先试音 / 预约：只生成需求");
  assert.ok(entry); assert.equal(entry.props.disabled, false);
  assert.doesNotMatch(p.html(), /aria-label="下单内容"/);
  entry.props.onClick(); await tick();
  const html = p.html();
  assert.match(html, /先试音或预约：只生成需求/);
  assert.match(html, /aria-label="下单内容"/);
  assert.match(html, /复制需求/);
  assert.match(html, /返回直接下单/);
  assert.equal(requests.filter(request => request.method === "POST").length, 0);
  assert.equal(requests.length, 0);
});
test("customer can choose service once and copy exact generated demand without an order request", async () => {
  let copied = null, requests = 0;
  const p = page("apps/customer-web/app/order/demand-guide.tsx", async () => { requests++; return ok({}); },
    { navigator: { clipboard: { writeText: async value => { copied = value; } } } });
  assert.equal(p.all().find(e => e.type === "button").props.disabled, true);
  p.all().find(e => e.props?.["aria-label"] === "模式").props.onChange({ target: { value: "烽火地带" } });
  p.all().find(e => e.props?.["aria-label"] === "时长").props.onChange({ target: { value: "2" } });
  p.all().find(e => e.props?.["aria-label"] === "补充备注").props.onChange({ target: { value: "国服" } });
  const demand = "找陪玩；游戏：三角洲行动；模式：烽火地带；时长：2小时；开始时间：现在；不需要试音；预算：按陪玩报价确认。备注：国服";
  assert.equal(p.all().find(e => e.props?.["aria-label"] === "下单内容").props.value, demand);
  assert.equal(p.all().find(e => e.type === "button").props.disabled, false);
  p.all().find(e => e.type === "button").props.onClick(); await tick();
  assert.equal(copied, demand); assert.equal(requests, 0);
  assert.match(p.html(), /已复制，尚未发送/); assert.match(p.html(), /试音安排与正式订单分开确认/);
});
test("clipboard refusal keeps demand and gives a manual-copy fallback", async () => {
  const p = page("apps/customer-web/app/order/demand-guide.tsx", undefined,
    { navigator: { clipboard: { writeText: async () => { throw new Error("denied"); } } } });
  p.all().find(e => e.props?.["aria-label"] === "模式").props.onChange({ target: { value: "烽火地带" } });
  p.all().find(e => e.props?.["aria-label"] === "补充备注").props.onChange({ target: { value: "保留原备注" } });
  const original = p.all().find(e => e.props?.["aria-label"] === "下单内容").props.value;
  p.all().find(e => e.type === "button").props.onClick(); await tick();
  assert.match(p.html(), /手动复制/);
  assert.equal(p.all().find(e => e.props?.["aria-label"] === "下单内容").props.value, original);
  assert.equal(p.all().find(e => e.props?.["aria-label"] === "补充备注").props.value, "保留原备注");
});
test("a successful recharge followed by failed refresh stays submitted and cannot be immediately resubmitted", async () => {
  let posts = 0;
  const p = page("apps/customer-web/app/recharge/page.tsx", async (_, options) => {
    if (options?.method === "POST") { posts++; return ok({ id: "fixture-request" }); }
    return { ok: false };
  });
  p.all().find(e => e.type === "input" && e.props.inputMode === "decimal").props.onChange({ target: { value: "100" } });
  await p.all().find(e => e.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(posts, 1); assert.match(p.html(), /充值申请已提交/); assert.match(p.html(), /不要重复提交/);
  assert.equal(p.all().find(e => e.type === "button" && e.props.children === "提交审核").props.disabled, true);
  assert.doesNotMatch(p.html(), /提交失败/);
});
test("admin sees waiting orders immediately for reassignment and can hide them", async () => {
  const common = { game: "DELTA_FORCE", mode: "烽火地带", hours: "1", totalAmount: "100", unitPrice: "100", dispatchVersion: 1 };
  const orders = [ { ...common, id: "paid", orderNo: "ORDER-PAID", status: "PAID" },
    { ...common, id: "waiting", orderNo: "ORDER-WAITING", status: "ASSIGNED", acceptanceDeadline: "2099-01-01T00:00:00Z" },
    { ...common, id: "expired", orderNo: "ORDER-EXPIRED", status: "ASSIGNED", acceptanceDeadline: "2000-01-01T00:00:00Z" },
    { ...common, id: "malformed", orderNo: "ORDER-BAD-DATE", status: "ASSIGNED", acceptanceDeadline: "invalid" } ];
  let writes = 0;
  const p = page("apps/admin-web/app/dispatch/page.tsx", async (url, opts) => {
    if (opts?.method) writes++;
    return ok(url.endsWith("/orders") ? orders : []);
  });
  p.mount(); await tick();
  assert.match(p.html(), /ORDER-PAID/); assert.match(p.html(), /ORDER-EXPIRED/); assert.match(p.html(), /ORDER-BAD-DATE/);
  assert.match(p.html(), /ORDER-WAITING/);
  p.all().find(e => e.type === "input" && e.props.type === "checkbox").props.onChange({ target: { checked: false } });
  assert.doesNotMatch(p.html(), /ORDER-WAITING/); assert.equal(writes, 0);
  const dispatch = p.all().find(e => e.type === "button" && e.props.children === "确认派单");
  assert.equal(dispatch.props.disabled, true);
});
test("formal companion orders appear before draft applications without removing service acceptance", () => {
  const p = page("apps/companion-web/app/available-orders/page.tsx");
  const html = p.html();
  assert.ok(html.includes("正式可接订单") && html.includes("招募需求（报名不等于接单）"));
  assert.ok(html.indexOf("正式可接订单") < html.lastIndexOf("招募需求（报名不等于接单）"));
  assert.match(html, /备注选填/);
  const source = fs.readFileSync(path.join(root, "apps/companion-web/app/available-orders/page.tsx"), "utf8");
  assert.match(source, /dispatchVersion:/); assert.match(source, /客户或管理员验收后结算/);
});
