/* Local teaching fixture only: no network, storage, configuration or real funds. */
(function (root) {
  function createDemo() {
    let sequence = 0;
    const state = { requests: [], orders: [], cards: [], events: [], companions: [
      { id: "demo-a", name: "演示陪玩甲", listed: true },
      { id: "demo-b", name: "演示陪玩乙", listed: true }
    ] };
    const copy = value => JSON.parse(JSON.stringify(value));
    const fail = message => { throw new Error(message); };
    const order = id => state.orders.find(row => row.id === id) || fail("演示订单不存在");
    function create(entry, requestId) {
      if (!["customer", "desk"].includes(entry)) fail("下单入口无效");
      if (entry === "desk" && !state.requests.some(row => row.id === requestId)) fail("请选择演示客户需求");
      const previous = entry === "desk" && state.orders.find(row => row.requestId === requestId);
      if (previous) return copy(previous);
      const row = { id: `demo-${++sequence}`, orderNo: `演示订单-${sequence}`, entry, requestId,
        status: "PAID", totalAmount: "100.00", dispatchVersion: 0, companionId: null };
      state.orders.push(row);
      state.events.push({ orderId: row.id, action: "模拟余额冻结", amount: "100.00" });
      return copy(row);
    }
    return {
      snapshot: () => copy(state),
      demand() {
        const row = { id: `demand-${++sequence}`, customer: "演示客户", text: "【演示】三角洲行动，娱乐，1 小时，预算 100 元" };
        state.requests.push(row); return copy(row);
      },
      create,
      list(companionId, listed) {
        const person = state.companions.find(row => row.id === companionId) || fail("演示陪玩不存在");
        person.listed = Boolean(listed);
      },
      dispatch(id, companionId, version) {
        const row = order(id);
        if (!["PAID", "ASSIGNED"].includes(row.status)) fail("接单后不能换人");
        if (row.dispatchVersion !== version) fail("订单已更新，请刷新");
        if (!state.companions.some(person => person.id === companionId && person.listed)) fail("陪玩未上架");
        if (state.orders.some(other => other.id !== id && other.companionId === companionId && ["ACCEPTED", "IN_PROGRESS"].includes(other.status))) fail("陪玩正在服务");
        row.companionId = companionId; row.status = "ASSIGNED"; row.dispatchVersion++;
        const card = { id: `card-${++sequence}`, orderId: id, companionId, version: row.dispatchVersion,
          title: "【演示·模拟 KOOK】客服已派单", value: `order.accept.${id}.${row.dispatchVersion}` };
        state.cards.push(card); return copy(card);
      },
      accept(cardId, actorId) {
        const card = state.cards.find(item => item.id === cardId) || fail("卡片不存在");
        const row = order(card.orderId);
        if (row.dispatchVersion !== card.version || row.companionId !== card.companionId) fail("卡片已失效，请刷新订单");
        if (actorId !== card.companionId) fail("只有被派单的演示陪玩本人可以接单");
        if (["ACCEPTED", "IN_PROGRESS", "AWAITING_ACCEPTANCE", "COMPLETED"].includes(row.status)) return copy(row);
        if (row.status !== "ASSIGNED") fail("当前状态不能接单");
        if (!state.companions.find(person => person.id === actorId)?.listed) fail("陪玩未上架");
        if (state.orders.some(other => other.id !== row.id && other.companionId === actorId && ["ACCEPTED", "IN_PROGRESS"].includes(other.status))) fail("陪玩正在服务");
        row.status = "ACCEPTED";
        state.events.push({ orderId: row.id, action: "接单" }); return copy(row);
      },
      advance(id, action) {
        const row = order(id);
        const transitions = { start: ["ACCEPTED", "IN_PROGRESS"], complete: ["IN_PROGRESS", "AWAITING_ACCEPTANCE"], confirm: ["AWAITING_ACCEPTANCE", "COMPLETED"] };
        const transition = transitions[action];
        if (!transition || row.status !== transition[0]) fail("请按订单状态操作");
        row.status = transition[1]; state.events.push({ orderId: id, action }); return copy(row);
      }
    };
  }
  if (typeof module !== "undefined") module.exports = { createDemo };
  else root.createDemo = createDemo;
})(globalThis);
