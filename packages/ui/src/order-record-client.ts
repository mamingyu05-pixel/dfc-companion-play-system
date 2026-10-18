type ReadResponse = { ok: boolean; status: number; json(): Promise<unknown> };
type ReadTransport = (path: string, init: RequestInit) => Promise<ReadResponse>;

export type OrderRecord = {
  id: string; orderNo: string; status: string;
  quote: { capturedAt: string; mode: string; hours: string; unit: string; rank: string | null; unitPrice: string; totalAmount: string };
  refundAmount: string;
  timeline: Array<{ id: string; fromStatus: string | null; toStatus: string; createdAt: string; actor: string }>;
  complaints: Array<{ id: string; status: string; reason: string; resolution: string | null; createdAt: string }>;
  timelineTruncated: boolean; complaintsTruncated: boolean; evidenceScope: string; financialNotice: string;
};
export type OrderRecordState = {
  record: OrderRecord | null; error: string; busy: boolean; orderId: string | null;
  status: "idle" | "loading" | "ready" | "denied" | "error";
};
const idle = (): OrderRecordState => ({ record: null, error: "", busy: false, orderId: null, status: "idle" });
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid record object");
  return value as Record<string, unknown>;
};
const text = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid record text");
  return value;
};
const decimal = (value: unknown): string => {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error("Invalid record amount");
  return value;
};
const nullableText = (value: unknown): string | null => value === null || value === undefined ? null : text(value);
function parseRecord(value: unknown, orderId: string): OrderRecord {
  const record = object(value), quote = object(record.quote);
  if (record.id !== orderId || !Array.isArray(record.timeline) || record.timeline.length > 100 ||
      !Array.isArray(record.complaints) || record.complaints.length > 30 ||
      typeof record.timelineTruncated !== "boolean" || typeof record.complaintsTruncated !== "boolean") throw new Error("Invalid record scope");
  const hours = text(quote.hours);
  if (!/^\d+(?:\.\d+)?$/.test(hours)) throw new Error("Invalid record hours");
  return {
    id: orderId, orderNo: text(record.orderNo), status: text(record.status),
    quote: { capturedAt: text(quote.capturedAt), mode: text(quote.mode), hours, unit: text(quote.unit),
      rank: nullableText(quote.rank), unitPrice: decimal(quote.unitPrice), totalAmount: decimal(quote.totalAmount) },
    refundAmount: decimal(record.refundAmount),
    // Keep only the endpoint's projected fields; internal log reasons are never adopted here.
    timeline: record.timeline.map(value => { const event = object(value); return {
      id: text(event.id), fromStatus: nullableText(event.fromStatus), toStatus: text(event.toStatus),
      createdAt: text(event.createdAt), actor: text(event.actor)
    }; }),
    complaints: record.complaints.map(value => { const complaint = object(value); return {
      id: text(complaint.id), status: text(complaint.status), reason: text(complaint.reason),
      resolution: nullableText(complaint.resolution), createdAt: text(complaint.createdAt)
    }; }),
    timelineTruncated: record.timelineTruncated, complaintsTruncated: record.complaintsTruncated,
    evidenceScope: text(record.evidenceScope), financialNotice: text(record.financialNotice)
  };
}
class ReadFailure extends Error {
  constructor(message: string, readonly denied = false) { super(message); }
}
class SupersededRead extends Error {}

/** Reads existing records only. It never persists identities, requests or business results. */
export function createOrderRecordClient({ fetcher, getToken }: { fetcher: ReadTransport; getToken(): string | null }) {
  let current = idle(), epoch = 0, controller: AbortController | null = null;
  let boundToken: string | null = null, identity: { token: string; id: string } | null = null;
  const tokenNow = () => { try { return getToken() || null; } catch { return null; } };
  function cancel() { epoch++; controller?.abort(); controller = null; }
  function state(): OrderRecordState {
    if (boundToken !== null && tokenNow() !== boundToken) {
      cancel(); boundToken = null; identity = null;
      current = { ...idle(), status: "denied", error: "登录身份已变化，请重新核对身份后读取记录。" };
    }
    return { ...current };
  }
  function clear(): OrderRecordState {
    cancel(); boundToken = null; identity = null; current = idle(); return state();
  }
  async function load(orderId: string): Promise<OrderRecordState> {
    state(); cancel();
    const generation = epoch, token = tokenNow();
    current = { ...idle(), orderId };
    if (!token) {
      boundToken = null; identity = null;
      current = { ...current, status: "denied", error: "请登录后读取本人关联的订单记录。" }; return state();
    }
    boundToken = token;
    if (identity?.token !== token) identity = null;
    if (!orderId || orderId.length > 128 || /[\u0000-\u001f\u007f]/.test(orderId)) {
      current = { ...current, status: "error", error: "订单编号无效，请从本人订单列表重新打开。" }; return state();
    }
    const active = new AbortController(); controller = active;
    current = { ...current, status: "loading", busy: true };
    function check() {
      if (generation !== epoch) throw new SupersededRead();
      if (tokenNow() !== token) { state(); throw new SupersededRead(); }
      if (active.signal.aborted) throw new ReadFailure("读取记录超时，请重新读取；本次未执行订单或资金操作。");
    }
    async function read(path: string, auth = false) {
      check();
      const response = await fetcher(path, { method: "GET", cache: "no-store", signal: active.signal,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      check();
      if (!response.ok) {
        if (response.status === 401) throw new ReadFailure("登录已失效，请重新登录后读取记录。", true);
        if (response.status === 403) throw new ReadFailure("当前身份无权读取这份订单记录。", true);
        if (!auth && response.status === 404) throw new ReadFailure("订单不存在或无权查看。", true);
        throw new ReadFailure(auth ? "身份核验未完成，请稍后重试。" : "订单记录暂时无法读取，请稍后重试。");
      }
      const data = await response.json(); check(); return data;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { active.abort(); reject(new ReadFailure("读取记录超时，请重新读取；本次未执行订单或资金操作。")); }, 12000);
    });
    try {
      const result = await Promise.race([(async () => {
        const me = object(await read("/api/auth/me", true)), user = object(me.user), id = text(user.id);
        if (identity && (identity.token !== token || identity.id !== id)) throw new ReadFailure("登录身份未能保持一致，请重新登录后读取记录。", true);
        identity = { token, id };
        // The existing endpoint and its ownership predicate decide role/profile access.
        return parseRecord(await read(`/api/orders/${encodeURIComponent(orderId)}/record`), orderId);
      })(), timeout]);
      check();
      current = { record: result, error: "", busy: false, orderId, status: "ready" };
    } catch (error) {
      if (error instanceof SupersededRead || generation !== epoch) return state();
      if (tokenNow() !== token) { state(); return state(); }
      current = { record: null, orderId, busy: false, status: error instanceof ReadFailure && error.denied ? "denied" : "error",
        error: error instanceof ReadFailure ? error.message : "订单记录返回不完整或连接失败，请重新读取。" };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (controller === active) controller = null;
    }
    return state();
  }
  return { state, load, clear };
}

const statusNames: Record<string, string> = { PAID: "待派单", ASSIGNED: "待接单", ACCEPTED: "已接单", IN_PROGRESS: "服务中",
  AWAITING_ACCEPTANCE: "待验收", COMPLETED: "已完成", DISPUTED: "争议处理中", REFUND_REQUESTED: "退款待处理", REFUNDED: "已退回站内余额", CANCELLED: "已取消" };
const statusName = (value: string) => statusNames[value] || `状态待核对（${value}）`;
const dateLabel = (value: string) => { const time = new Date(value); return Number.isFinite(time.getTime()) ? time.toLocaleString("zh-CN") : "时间待核对"; };
/** Presentation only: decimal text is retained without Number/rounding or balance calculations. */
export function orderRecordView(record: OrderRecord) {
  const complaintNames: Record<string, string> = { OPEN: "待处理", IN_REVIEW: "处理中", RESOLVED: "已处理", REJECTED: "已驳回" };
  return {
    fields: [
      { label: "记录返回的订单状态", value: statusName(record.status) },
      { label: "创建时确认金额的时间", value: dateLabel(record.quote.capturedAt) },
      { label: "服务", value: `${record.quote.mode} · ${record.quote.hours} 小时` },
      { label: "计价单位", value: record.quote.unit },
      ...(record.quote.rank ? [{ label: "创建时价档", value: record.quote.rank }] : []),
      { label: "创建时确认单价", value: `¥${record.quote.unitPrice}` },
      { label: "创建时确认总额", value: `¥${record.quote.totalAmount}` },
      { label: "站内订单退款记录", value: `¥${record.refundAmount}；去向请核对钱包流水` }
    ],
    timeline: record.timeline.map(event => ({ id: event.id, time: dateLabel(event.createdAt), actor: event.actor,
      change: `${event.fromStatus ? statusName(event.fromStatus) : "创建记录"} → ${statusName(event.toStatus)}` })),
    complaints: record.complaints.map(complaint => ({ id: complaint.id, time: dateLabel(complaint.createdAt),
      status: complaintNames[complaint.status] || "状态待核对", reason: complaint.reason, resolution: complaint.resolution })),
    timelineTruncated: record.timelineTruncated, complaintsTruncated: record.complaintsTruncated,
    evidenceScope: record.evidenceScope, financialNotice: record.financialNotice
  };
}
