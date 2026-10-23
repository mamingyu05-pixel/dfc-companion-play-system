const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const jsx = require("react/jsx-runtime");
const ok = value => ({ ok: true, json: async () => value });
const tick = () => new Promise(resolve => setImmediate(resolve));

// Invoke the real page handlers with fake transport and isolated React hook state.
function page(relative, fetch, search = "") {
  const state = [], effects = [], refs = [];
  let cursor = 0, refCursor = 0;
  const wrapper = ({ children }) => React.createElement("div", null, children);
  const components = new Proxy({}, { get: (_, name) => name === "DataTable" ? ({ rows }) => React.createElement("div", null, rows.flat())
    : name === "ActionButton" ? props => React.createElement("button", props) : wrapper });
  const hooks = { ...React, useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial;
    return [state[i], value => { state[i] = typeof value === "function" ? value(state[i]) : value; }]; },
    useRef(initial) { return refs[refCursor++] ||= { current: initial }; }, useEffect(fn) { effects.push(fn); }, useMemo(fn) { return fn(); } };
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  function load(filename) {
    const exports = {};
    const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
    vm.runInNewContext(compiled.outputText, { exports, fetch, URLSearchParams,
      localStorage: { getItem: () => "demo-session" }, sessionStorage: storage,
      window: { location: { search } }, require(id) {
        if (id === "react") return hooks;
        if (id === "react/jsx-runtime") return jsx;
        if (id === "next/link") return props => React.createElement("a", props);
        if (id === "../components") return components;
        if (id === "./pending-direct-order") return load(path.join(path.dirname(filename), "pending-direct-order.ts"));
        if (id === "../batch-tools") return load(path.join(path.dirname(filename), "..", "batch-tools.tsx"));
        throw new Error(`Unexpected import ${id}`);
      } }); return exports;
  }
  const loaded = load(path.resolve(__dirname, relative));
  function tree() { cursor = refCursor = 0; return loaded.default(); }
  function elements(node) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(elements);
    if (typeof node.type === "function") return elements(node.type(node.props));
    return [node, ...elements(node.props?.children)];
  }
  return { all: () => elements(tree()), mount() { tree(); effects.splice(0).forEach(fn => fn()); } };
}
test("order list provides targeted dispatch and replacement without a cancel action", async () => {
  const rows = ["PAID", "ASSIGNED", "IN_PROGRESS"].map(status => ({ id: status, orderNo: status, status, createdAt: "2026-01-01", totalAmount: "100", hours: "1" }));
  const p = page("../../admin-web/app/orders/page.tsx", async url => ok(url.endsWith("order-drafts") ? [] : rows));
  p.mount(); await tick();
  const links = p.all().filter(e => e.type === "a" && e.props.href.startsWith("/dispatch?"));
  assert.deepEqual(links.map(e => [e.props.href, e.props.children]), [["/dispatch?orderId=PAID", "派单"], ["/dispatch?orderId=ASSIGNED", "换人"]]);
});
test("normal waiting order deep link is selected and submits current version for replacement", async () => {
  const row = { id: "waiting", orderNo: "演示", status: "ASSIGNED", game: "DELTA_FORCE", dispatchVersion: 4, totalAmount: "100" };
  let command;
  const p = page("../../admin-web/app/dispatch/page.tsx", async (url, options) => {
    if (options?.method === "PATCH") { command = JSON.parse(options.body); return ok({}); }
    return ok(url.endsWith("/orders") ? [row] : [{ userId: "demo-b", nickname: "演示乙", email: "demo@example.invalid", status: "LISTED", userStatus: "ACTIVE", onlineStatus: "ONLINE", activeServiceCount: 0, game: "DELTA_FORCE" }]);
  }, "?orderId=waiting");
  p.mount(); await tick();
  const selects = p.all().filter(e => e.type === "select");
  assert.equal(selects[0].props.value, "waiting");
  selects[1].props.onChange({ target: { value: "demo-b" } });
  p.all().find(e => e.type === "input" && e.props.placeholder === "记录客户确认或改派依据").props.onChange({ target: { value: "演示客户要求换人" } });
  const button = p.all().find(e => e.type === "button" && e.props.children === "确认换人");
  assert.equal(button.props.disabled, false); button.props.onClick(); await tick();
  assert.equal(command.dispatchVersion, 4); assert.equal(command.companionId, "demo-b"); assert.equal(command.mode, "DIRECT");
});
test("companion status filters combine with search without writes", async () => {
  let writes = 0;
  const rows = ["LISTED", "PENDING_REVIEW"].map((status, i) => ({ userId: `demo-${i}`, nickname: `演示${i}`, status, onlineStatus: "ONLINE", game: "DELTA_FORCE", games: ["DELTA_FORCE"], email: "demo@example.invalid", externalAccounts: [], pricePerHour: "100", commissionRate: "0.2", deltaForceRank: "演示" }));
  const p = page("../../admin-web/app/companions/page.tsx", async (_, opts) => { if (opts?.method) writes++; return ok(rows); });
  p.mount(); await tick();
  p.all().find(e => e.type === "button" && e.props.children === "待审核").props.onClick();
  const names = p.all().filter(e => e.type === "div").map(e => e.props.children).filter(value => typeof value === "string");
  assert.ok(names.includes("演示1")); assert.ok(!names.includes("演示0")); assert.equal(writes, 0);
});
test("service desk honors requested draft instead of silently selecting the first", async () => {
  const drafts = ["first", "target"].map(id => ({ id, draftNo: id, status: "OPEN", game: "DELTA_FORCE", mode: "娱乐", candidates: [], publishedPlatforms: [], events: [] }));
  const p = page("../../admin-web/app/order-drafts/page.tsx", async url => ok(url.endsWith("order-drafts") ? drafts : []), "?draftId=target");
  p.mount(); await tick();
  assert.ok(p.all().some(e => e.type === "select" && e.props.value === "target"));
});

test("successful direct order navigates to admin dispatch with the returned order ID", async () => {
  const filename = path.resolve(__dirname, "../../admin-web/app/order-drafts/page.tsx");
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "submitDirectOrder") handler = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(handler, "actual direct-order success handler exists");
  const compiled = ts.transpileModule(handler.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const companionIds of [[], ["selected-companion"]]) {
    const navigations = [], requests = [], acknowledgements = [], errors = [];
    const orderId = "order /?&中文";
    const pending = { payload: { companionIds }, requestId: "request-one" };
    const context = { directBusy: { current: false }, sessionStorage: {},
      callApi: async (url, options) => {
        requests.push([url, JSON.parse(options.body)]);
        return { orders: [{ id: orderId, orderNo: "synthetic-order" }] };
      },
      acknowledgeDirectOrder: (_, id) => acknowledgements.push(id),
      setDirectSubmitting() {}, setPendingDirect() {}, setStatus() {}, setDirectCompanionIds() {}, setForm() {},
      setError: error => errors.push(error), loadData: async () => {},
      window: { location: { assign: url => navigations.push(url) } },
    };
    vm.createContext(context);
    vm.runInContext(compiled, context);
    await context.submitDirectOrder(pending);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, [["/api/admin/orders/direct", { companionIds, requestId: "request-one" }]]);
    assert.deepEqual(acknowledgements, ["request-one"]);
    assert.deepEqual(navigations, companionIds.length ? [] : [`/admin/dispatch?orderId=${encodeURIComponent(orderId)}`]);
    if (navigations.length) {
      const target = new URL(navigations[0], "https://admin.example.invalid");
      assert.equal(target.pathname, "/admin/dispatch");
      assert.equal(target.searchParams.get("orderId"), orderId);
    }
  }
});

test("dispatch page multi-companion entry resolves under the admin base path", () => {
  const config = fs.readFileSync(path.resolve(__dirname, "../../admin-web/next.config.mjs"), "utf8");
  const basePath = /basePath:\s*"([^"]*)"/.exec(config)?.[1];
  assert.equal(basePath, "/admin");
  const filename = path.resolve(__dirname, "../../admin-web/app/dispatch/page.tsx");
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = new Map(), entries = [], plainInternalAnchors = [];
  function visit(node) {
    if (ts.isImportDeclaration(node) && node.importClause?.name) imports.set(node.importClause.name.text, node.moduleSpecifier.text);
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName.getText(source);
      const attr = node.openingElement.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(source) === "href");
      const href = attr?.initializer && ts.isStringLiteral(attr.initializer) ? attr.initializer.text : undefined;
      if (node.children.some(child => ts.isJsxText(child) && child.text.trim() === "多人派单入口")) entries.push({ tag, href });
      if (tag === "a" && href?.startsWith("/") && !href.startsWith(`${basePath}/`) && !href.startsWith("/api/")) plainInternalAnchors.push(href);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(entries.length, 1, "actual multi-companion entry exists");
  const [{ tag, href }] = entries;
  assert.ok(href, "entry has a literal href");
  // next/link prepends basePath; a plain anchor is used by the browser as written.
  const resolved = tag === "a" ? href : imports.get(tag) === "next/link" ? `${basePath}${href}` : undefined;
  assert.ok(resolved, `entry uses a known link element, got <${tag}>`);
  assert.equal(new URL(resolved, "https://admin.example.invalid").pathname.replace(/\/$/, ""), "/admin/order-drafts");
  assert.deepEqual(plainInternalAnchors, [], "no plain anchor on the dispatch page skips the admin base path");
});
