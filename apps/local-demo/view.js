const demo = createDemo();
const labels = { PAID: "待客服派单", ASSIGNED: "待陪玩接单", ACCEPTED: "已接单", IN_PROGRESS: "服务中", AWAITING_ACCEPTANCE: "待客户验收", COMPLETED: "已完成" };
const byId = id => document.getElementById(id);
function text(tag, value) { const node = document.createElement(tag); node.textContent = value; return node; }
function action(label, fn) {
  const node = text("button", label); node.type = "button";
  node.onclick = () => { try { fn(); render(); byId("feedback").textContent = `${label}：演示操作成功，请查看订单状态。`; }
    catch (error) { byId("feedback").textContent = error.message; } }; return node;
}
function panel(target, title) { const node = document.createElement("article"); node.append(text("strong", title)); byId(target).append(node); return node; }
function render() {
  const state = demo.snapshot();
  for (const id of ["requests", "dispatch", "cards", "service", "roster", "orders", "customer-orders"]) byId(id).replaceChildren();
  for (const request of state.requests) {
    const node = panel("requests", request.text);
    if (!state.orders.some(row => row.requestId === request.id)) node.append(action("客服建单（模拟冻结 ¥100）", () => demo.create("desk", request.id)));
    else node.append(text("p", "已建单，请在下方派单。"));
  }
  for (const row of state.orders) {
    const summary = `${row.orderNo} · ${labels[row.status]} · ¥${row.totalAmount}`;
    const customer = panel("customer-orders", summary);
    if (row.status === "AWAITING_ACCEPTANCE") customer.append(action("确认验收", () => demo.advance(row.id, "confirm")));
    const admin = panel("orders", summary); admin.append(text("p", `陪玩：${state.companions.find(person => person.id === row.companionId)?.name || "等待客服指定"}`));
    if (["PAID", "ASSIGNED"].includes(row.status)) {
      const desk = panel("dispatch", summary), select = document.createElement("select"); select.setAttribute("aria-label", `${row.orderNo} 选择陪玩`);
      const placeholder = text("option", "请选择陪玩"); placeholder.value = ""; select.append(placeholder);
      state.companions.filter(person => person.listed).forEach(person => { const option = text("option", person.name); option.value = person.id; select.append(option); });
      desk.append(select, action(row.status === "PAID" ? "确认派单" : "确认换人", () => demo.dispatch(row.id, select.value, row.dispatchVersion)));
    }
    if (["ACCEPTED", "IN_PROGRESS", "AWAITING_ACCEPTANCE"].includes(row.status)) {
      const service = panel("service", summary);
      if (row.status === "ACCEPTED") service.append(action("开始服务", () => demo.advance(row.id, "start")));
      if (row.status === "IN_PROGRESS") service.append(action("模拟约定时长结束并报完成", () => demo.advance(row.id, "complete")));
      if (row.status === "AWAITING_ACCEPTANCE") service.append(text("p", "等待客户验收，不重复报完成。"));
    }
  }
  for (const card of state.cards) {
    const row = state.orders.find(row => row.id === card.orderId);
    const name = state.companions.find(person => person.id === card.companionId).name;
    const node = panel("cards", card.title);
    node.append(text("p", `${row.orderNo} · ${name} · 第 ${card.version} 轮 · ${labels[row.status]}`));
    node.append(action("接单", () => demo.accept(card.id, card.companionId)));
  }
  for (const person of state.companions) {
    const node = panel("roster", `${person.name} · ${person.listed ? "已上架" : "已下架"}`);
    node.append(action(person.listed ? "下架" : "上架", () => demo.list(person.id, !person.listed)));
  }
}
byId("preview").onclick = () => { byId("bill").hidden = false; };
byId("pay").onclick = () => { if (byId("bill").hidden) return; byId("bill").hidden = true; demo.create("customer"); render(); byId("feedback").textContent = "模拟付款成功，订单待客服派单。没有真实扣款。"; };
byId("demand").onclick = () => { demo.demand(); render(); byId("feedback").textContent = "演示需求已出现在客服区域，未发送到真实 KOOK。"; };
render();
