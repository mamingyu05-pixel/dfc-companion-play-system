const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDemo } = require("../../local-demo/model.js");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

for (const entry of ["customer", "desk"]) test(`local demo: ${entry} entry through customer acceptance`, () => {
  const demo = createDemo();
  const request = entry === "desk" ? demo.demand() : null;
  const order = demo.create(entry, request?.id);
  assert.equal(order.status, "PAID");
  if (request) assert.equal(demo.create(entry, request.id).id, order.id);
  const card = demo.dispatch(order.id, "demo-a", 0);
  assert.equal(demo.accept(card.id, "demo-a").status, "ACCEPTED");
  assert.equal(demo.advance(order.id, "start").status, "IN_PROGRESS");
  assert.equal(demo.advance(order.id, "complete").status, "AWAITING_ACCEPTANCE");
  assert.equal(demo.advance(order.id, "confirm").status, "COMPLETED");
  assert.equal(demo.snapshot().orders.length, 1);
  assert.equal(demo.snapshot().events.filter(event => event.action === "模拟余额冻结").length, 1);
});
test("local demo: reassignment invalidates old card and duplicate accepts have one effect", () => {
  const demo = createDemo(), order = demo.create("desk", demo.demand().id);
  const old = demo.dispatch(order.id, "demo-a", 0);
  const current = demo.dispatch(order.id, "demo-b", 1);
  assert.throws(() => demo.accept(old.id, "demo-a"), /失效/);
  assert.throws(() => demo.accept(current.id, "demo-a"), /本人/);
  assert.throws(() => demo.dispatch(order.id, "demo-a", 1), /更新/);
  assert.equal(demo.snapshot().orders[0].status, "ASSIGNED");
  for (let i = 0; i < 3; i++) assert.equal(demo.accept(current.id, "demo-b").status, "ACCEPTED");
  assert.equal(demo.snapshot().events.filter(event => event.action === "接单").length, 1);
  assert.throws(() => demo.dispatch(order.id, "demo-a", 2), /接单后/);
});
test("local demo: state guards, unavailable companions and snapshots", () => {
  const demo = createDemo(), order = demo.create("customer");
  assert.throws(() => demo.create("desk", "missing"), /需求/);
  assert.throws(() => demo.advance(order.id, "confirm"), /状态/);
  demo.list("demo-a", false);
  assert.throws(() => demo.dispatch(order.id, "demo-a", 0), /未上架/);
  demo.list("demo-a", true);
  const card = demo.dispatch(order.id, "demo-a", 0);
  demo.accept(card.id, "demo-a");
  const other = demo.create("customer");
  assert.throws(() => demo.dispatch(other.id, "demo-a", 0), /正在服务/);
  demo.snapshot().orders[0].status = "COMPLETED";
  assert.equal(demo.snapshot().orders[0].status, "ACCEPTED");
});

test("local demo view: actual handlers expose both entry routes and one-click KOOK acceptance", () => {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.textContent = ""; this.hidden = false; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute() {}
  }
  const nodes = new Map();
  const document = { createElement: tag => new Element(tag), getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, new Element("div")); return nodes.get(id);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../local-demo/view.js"), "utf8"), { document, createDemo });
  const all = node => [node, ...node.children.flatMap(all)];
  const button = (area, label) => all(document.getElementById(area)).find(node => node.tag === "button" && node.textContent === label);
  const contains = (area, value) => all(document.getElementById(area)).some(node => node.textContent.includes(value));
  document.getElementById("preview").onclick();
  assert.equal(document.getElementById("bill").hidden, false);
  document.getElementById("pay").onclick();
  document.getElementById("pay").onclick();
  assert.equal(document.getElementById("orders").children.length, 1);
  assert.ok(contains("orders", "待客服派单"));
  document.getElementById("demand").onclick();
  button("requests", "客服建单（模拟冻结 ¥100）").onclick();
  assert.equal(document.getElementById("orders").children.length, 2);
  all(document.getElementById("dispatch")).find(node => node.tag === "select").value = "demo-a";
  button("dispatch", "确认派单").onclick();
  button("cards", "接单").onclick();
  assert.ok(contains("orders", "已接单"));
  button("cards", "接单").onclick();
  button("service", "开始服务").onclick();
  button("service", "模拟约定时长结束并报完成").onclick();
  button("customer-orders", "确认验收").onclick();
  assert.ok(contains("orders", "已完成"));
});
