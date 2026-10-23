// A button with url opens that address in the browser instead of returning a value to the bot.
export type FlowButton = { label: string; value: string; primary?: boolean; url?: string };
export type FlowCard = ReturnType<typeof flowCard>;

// Keep every group within KOOK's four-button limit. Use plain text for user data.
export function flowCard(title: string, lines: string[], buttons: FlowButton[] = []) {
  const modules: Record<string, unknown>[] = [
    { type: "header", text: { type: "plain-text", content: title.slice(0, 100) } },
    ...lines.map(content => ({ type: "section", text: { type: "plain-text", content: content.slice(0, 1900) } }))
  ];
  for (let i = 0; i < buttons.length; i += 4) modules.push({
    type: "action-group", elements: buttons.slice(i, i + 4).map(button => ({
      type: "button", theme: button.primary ? "primary" : "secondary", click: button.url ? "link" : "return-val",
      value: button.url ?? button.value, text: { type: "plain-text", content: button.label.slice(0, 40) }
    }))
  });
  return [{ type: "card", theme: "secondary", size: "lg", modules }];
}

// Navigation only. The service checks the exact issued private card before routing.
export function entryButton(action: "order" | "orders" | "demands", label: string, primary = false): FlowButton {
  return { label, primary, value: `dfc.entry.${action}.${Math.floor(Date.now() / 1000) + 900}` };
}

export function webButton(url: string, label = "在网页查看"): FlowButton {
  return { label, value: "", url };
}

export function parseEntryAction(value: string) {
  const match = /^dfc\.entry\.(order|orders|demands)\.(\d{10})$/.exec(value);
  return match ? { action: match[1], expiresAt: Number(match[2]) * 1000 } : null;
}

export function parseFlowAction(value: string) {
  const match = /^dfc\.flow\.([a-f0-9-]{36})\.(0|[1-9]\d{0,8})\.([a-z0-9_-]{1,64})$/.exec(value);
  return match ? { id: match[1], version: Number(match[2]), choice: match[3] } : null;
}

export function parseOrderFlowAction(value: string) {
  const match = /^dfc\.order\.(accept|busy|later|unsuitable|start|complete|refresh)\.([A-Za-z0-9_-]{1,80})\.(0|[1-9]\d{0,8})\.(\d{10})$/.exec(value);
  return match ? { action: match[1], id: match[2], version: Number(match[3]), expiresAt: Number(match[4]) * 1000 } : null;
}

export function orderFlowCard(order: { id: string; orderNo: string; status: string; dispatchVersion: number }, companion: boolean, prefix?: string) {
  const expires = Math.floor(Date.now() / 1000) + 900;
  const button = (action: string, label: string, primary = false): FlowButton => ({
    label, primary, value: `dfc.order.${action}.${order.id}.${order.dispatchVersion}.${expires}`
  });
  const next: Record<string, string> = {
    PAID: "订单款已冻结，等待管理员核对派单状态；尚未接单。",
    ASSIGNED: "订单已进入派单，等待陪玩接单；尚未开始服务。",
    ACCEPTED: "陪玩已接单。双方准备好后，由陪玩点击开始服务。",
    IN_PROGRESS: "服务进行中。约定时长达到后可提交完成；提前结束请联系管理员。",
    AWAITING_ACCEPTANCE: "已提交完成，等待客户验收；陪玩收入仍待结算。",
    COMPLETED: "订单已完成。具体结算以订单账本为准。",
    DISPUTED: "订单正在处理异常，请联系管理员。",
    CANCELLED: "订单已取消。", REFUNDED: "订单已退款。"
  };
  const buttons: FlowButton[] = [];
  if (companion && order.status === "ASSIGNED") buttons.push(button("accept", "接单", true), button("busy", "正在忙"), button("later", "时间不合适"), button("unsuitable", "不符合需求"));
  if (companion && order.status === "ACCEPTED") buttons.push(button("start", "开始服务", true));
  if (companion && order.status === "IN_PROGRESS") buttons.push(button("complete", "提交完成", true));
  buttons.push(button("refresh", "刷新订单"), entryButton("orders", companion ? "返回陪玩工作台" : "我的订单"));
  return flowCard(`订单 ${order.orderNo}`, [prefix ?? "以下为当前订单记录。", next[order.status] ?? "请在订单页查看当前状态。", "发送“我的订单”可找回回执。按钮过期只需刷新，不要重复下单。"], buttons);
}

export function cardContainsAction(card: unknown, value: string): boolean {
  if (!Array.isArray(card)) return false;
  return card.some(item => Array.isArray(item?.modules) && item.modules.some((module: { type?: string; elements?: { click?: string; value?: string }[] }) =>
    module?.type === "action-group" && Array.isArray(module.elements) && module.elements.some(button => button?.click === "return-val" && button.value === value)));
}
