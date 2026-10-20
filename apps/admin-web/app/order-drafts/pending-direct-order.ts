const PENDING_DIRECT_ORDER_STORAGE = "dfc_direct_order_pending_v1";
export type DirectOrderPayload = {
  customerId: string; companionIds: string[]; sourcePlatform: "WEB" | "DISCORD" | "KOOK";
  sourceChannelId?: string; game: string; mode: string; hours: string; priceTier: string;
  rankTierKey?: string; customUnitPrice?: string; notes?: string; voiceTrialRequested: boolean;
};
export type PendingDirectOrder = { requestId: string; payload: DirectOrderPayload };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function readPendingDirectOrder(store: Store): PendingDirectOrder | null {
  const saved = store.getItem(PENDING_DIRECT_ORDER_STORAGE);
  if (!saved) return null;
  const parsed = JSON.parse(saved) as PendingDirectOrder;
  if (!/^[A-Za-z0-9_-]{16,96}$/.test(parsed.requestId) || !parsed.payload?.customerId || !Array.isArray(parsed.payload.companionIds)) {
    throw new Error("原请求记录异常，请先核对订单，勿重新成单");
  }
  return parsed;
}
export function prepareDirectOrder(store: Store, payload: DirectOrderPayload, newId: () => string): PendingDirectOrder {
  const previous = readPendingDirectOrder(store);
  // Persist the exact payload, so a lost response or page refresh cannot silently turn a retry into a new charge.
  if (previous) {
    if (JSON.stringify(previous.payload) !== JSON.stringify(payload)) throw new Error("存在结果待确认的原请求，请先重试原请求，勿修改后重复成单");
    return previous;
  }
  const pending = { requestId: newId(), payload };
  store.setItem(PENDING_DIRECT_ORDER_STORAGE, JSON.stringify(pending));
  return pending;
}
export function acknowledgeDirectOrder(store: Store, requestId: string) {
  if (readPendingDirectOrder(store)?.requestId === requestId) store.removeItem(PENDING_DIRECT_ORDER_STORAGE);
}
