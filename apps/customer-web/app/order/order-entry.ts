import type { Companion, OrderView } from "./order-client";

export const ORDER_MODES = ["烽火地带", "全面战场"];
export const ORDER_HOURS = ["1", "2", "3", "4"];

/** Prefill link only: the customer still previews the server quote and confirms the freeze. */
export function reorderHref(order: { status: string; companionId?: string | null; mode: string; hours: string; serviceKind?: string }) {
  if (order.status !== "COMPLETED" || !order.companionId) return null;
  const query = new URLSearchParams({ companionId: order.companionId });
  if (order.serviceKind === "GUARANTEE") return `/guarantee?${query}`;
  if (ORDER_MODES.includes(order.mode)) query.set("mode", order.mode);
  const hours = String(Number(order.hours));
  if (ORDER_HOURS.includes(hours)) query.set("hours", hours);
  return `/order?${query}`;
}

export function entrySelection(search: string, view: OrderView) {
  if (!view.connected || view.busy || view.error || view.pending || view.receipt) return null;
  const id = new URLSearchParams(search).get("companionId");
  if (!id) return { companionId: "", message: "" };
  return view.companions.some(companion => companion.id === id)
    ? { companionId: id, message: "" }
    : { companionId: "", message: "这位陪玩暂时不能下单，请另选" };
}

export function onlineLabel(status: string) {
  return status === "ONLINE" ? "在线" : status === "BUSY" ? "忙碌" : status === "OFFLINE" ? "离线" : "状态待核对";
}

export function sortedCompanions(companions: Companion[]) {
  const rank = (status: string) => status === "ONLINE" ? 0 : status === "BUSY" ? 1 : 2;
  return [...companions].sort((a, b) => rank(a.onlineStatus) - rank(b.onlineStatus));
}

// Display-only comparison of existing values; the server remains responsible for funds.
export function balanceShortfall(balance: string, total: string): string | null {
  const cents = (value: string) => {
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
    const [whole, fraction = ""] = value.split(".");
    const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    return Number.isSafeInteger(result) ? result : null;
  };
  const available = cents(balance), required = cents(total);
  if (available === null || required === null || available >= required) return null;
  return ((required - available) / 100).toFixed(2);
}
