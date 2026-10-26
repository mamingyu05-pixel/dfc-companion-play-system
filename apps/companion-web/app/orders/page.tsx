"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createOrderRecordClient, orderRecordView, type OrderRecordState } from "@dfc/ui";
import { ActionButton, CompanionShell, MetricCard, SectionHeader, StatusBadge } from "../components";
import { GuaranteeEvidencePanel } from "../guarantee-evidence";

type Order = {
  id: string;
  orderNo: string;
  mode: string;
  hours: string;
  totalAmount: string;
  status: string;
  serviceKind?: string;
  customer?: { displayName: string };
};

function isOrderList(value: unknown): value is Order[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const order = item as Record<string, unknown>;
    if (!["id", "orderNo", "mode", "hours", "totalAmount", "status"].every((key) => typeof order[key] === "string")) return false;
    if (!(order.id as string).trim() || !/^\d+(?:\.\d{1,2})?$/.test(order.totalAmount as string)) return false;
    if (order.customer === undefined || order.customer === null) return true;
    if (typeof order.customer !== "object" || Array.isArray(order.customer)) return false;
    const customer = order.customer as Record<string, unknown>;
    return typeof customer.displayName === "string";
  });
}

function tokenNow(): string | null {
  try { return localStorage.getItem("dfc_companion_token"); } catch { return null; }
}

function newOrderControls() {
  return { orders: [] as Order[], loading: true, uncertain: new Set<string>(),
    active: null as { orderId: string; token: string } | null };
}

export default function CompanionOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [actioningId, setActioningId] = useState("");
  const [uncertainIds, setUncertainIds] = useState<string[]>([]);
  const controlsRef = useRef(newOrderControls());
  const [recordState, setRecordState] = useState<OrderRecordState>({
    record: null,
    error: "",
    busy: false,
    status: "idle",
    orderId: null
  });
  const recordClientRef = useRef<ReturnType<typeof createOrderRecordClient> | null>(null);
  const mountedRef = useRef(false);
  const ordersRequestRef = useRef(0);
  const ordersTokenRef = useRef<string | null>(null);

  async function loadOrders() {
    const token = tokenNow();
    const requestId = ++ordersRequestRef.current;
    if (ordersTokenRef.current !== token) {
      controlsRef.current = newOrderControls();
      setOrders([]); setActioningId(""); setUncertainIds([]); setStatus("");
    }
    ordersTokenRef.current = token;
    const controls = controlsRef.current;
    controls.loading = true;
    setOrdersLoading(true);
    if (!token) {
      setOrders([]);
      setError("请登录后查看本人关联的订单。");
      setOrdersLoading(false);
      controls.loading = false;
      return false;
    }
    try {
      const response = await fetch("/api/orders/companion/my", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
      if (!response.ok) throw new Error("无法加载订单");
      const data: unknown = await response.json();
      if (!isOrderList(data)) throw new Error("订单列表返回不完整");
      if (mountedRef.current && requestId === ordersRequestRef.current && tokenNow() === token && controlsRef.current === controls) {
        controls.orders = data;
        controls.uncertain.clear();
        setOrders(data);
        setUncertainIds([]);
        setError("");
        return true;
      }
      return false;
    } catch {
      if (mountedRef.current && requestId === ordersRequestRef.current && tokenNow() === token) setError("无法加载我的订单");
      return false;
    } finally {
      if (mountedRef.current && requestId === ordersRequestRef.current && tokenNow() === token) {
        controls.loading = false;
        setOrdersLoading(false);
      }
    }
  }

  function syncIdentity() {
    const client = recordClientRef.current;
    if (!client) return;
    setRecordState(client.state());
    if (tokenNow() !== ordersTokenRef.current) {
      controlsRef.current = newOrderControls();
      setOrders([]);
      setActioningId(""); setUncertainIds([]);
      setError("");
      setStatus("");
      void loadOrders();
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    const client = createOrderRecordClient({
      fetcher: fetch,
      getToken: tokenNow
    });
    recordClientRef.current = client;
    setRecordState(client.state());
    function onVisibilityChange() {
      if (document.visibilityState === "visible") syncIdentity();
    }
    window.addEventListener("storage", syncIdentity);
    window.addEventListener("focus", syncIdentity);
    document.addEventListener("visibilitychange", onVisibilityChange);
    void loadOrders();
    return () => {
      mountedRef.current = false;
      controlsRef.current = newOrderControls();
      ++ordersRequestRef.current;
      window.removeEventListener("storage", syncIdentity);
      window.removeEventListener("focus", syncIdentity);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      client.clear();
      if (recordClientRef.current === client) recordClientRef.current = null;
    };
  }, []);

  async function loadRecord(orderId: string) {
    const client = recordClientRef.current;
    if (!client) return;
    if (tokenNow() !== ordersTokenRef.current) {
      syncIdentity();
      return;
    }
    if (!orders.some((order) => order.id === orderId)) {
      setRecordState({ ...client.clear(), status: "error", error: "请从当前身份的订单列表重新打开记录。" });
      return;
    }
    const pending = client.load(orderId);
    setRecordState(client.state());
    await pending;
    if (mountedRef.current && recordClientRef.current === client) syncIdentity();
  }

  function closeRecord() {
    if (tokenNow() !== ordersTokenRef.current) {
      syncIdentity();
      return;
    }
    const client = recordClientRef.current;
    if (client) setRecordState(client.clear());
  }

  async function updateOrder(orderId: string, action: "start" | "complete") {
    const controls = controlsRef.current;
    if (controls.active || controls.loading || controls.uncertain.has(orderId)) return;
    const token = tokenNow();
    if (!token || token !== ordersTokenRef.current) {
      syncIdentity();
      return;
    }
    const previous = controls.orders.find(order => order.id === orderId);
    if (!previous || previous.status !== (action === "start" ? "ACCEPTED" : "IN_PROGRESS")) return;
    const operation = { orderId, token };
    controls.active = operation;
    ++ordersRequestRef.current;
    setActioningId(orderId);
    setError("");
    setStatus("");
    let committed = false;
    const current = () => mountedRef.current && controlsRef.current === controls && tokenNow() === token && ordersTokenRef.current === token;
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/${action}`, {
        method: "PATCH", headers: { Authorization: `Bearer ${token}` }
      });
      const data: unknown = await response.json();
      if (!current()) { if (mountedRef.current) syncIdentity(); return; }
      const receipt = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
      if (!response.ok) {
        const message = Array.isArray(receipt.message) ? receipt.message.join("，") : receipt.message;
        throw new Error(typeof message === "string" ? message : "订单操作未获确认");
      }
      const expected = action === "start" ? "IN_PROGRESS" : "AWAITING_ACCEPTANCE";
      if (receipt.id !== orderId || receipt.status !== expected) throw new Error("未收到本笔订单的有效回执");
      committed = true;
      controls.orders = controls.orders.map(row => row.id === orderId ? { ...row, status: expected } : row);
      setOrders(controls.orders);
      setStatus(action === "start" ? "订单已开始" : "已报完成，收益待客户或管理员验收后结算");
      if (recordClientRef.current?.state().orderId === orderId) closeRecord();
      if (!await loadOrders() && current()) setError("本笔操作已成功，但列表刷新失败；请刷新核对，不要重复点击原操作。");
    } catch (error) {
      if (!current()) { if (mountedRef.current) syncIdentity(); return; }
      if (!committed) { controls.uncertain.add(orderId); setUncertainIds([...controls.uncertain]); }
      setError(committed ? "本笔操作已成功，但列表刷新失败；请刷新核对，不要重复点击原操作。"
        : `本笔结果待核对，请先点“刷新核对订单”，不要重复原操作。${error instanceof Error ? error.message : "连接或回执异常"}`);
    } finally {
      if (controlsRef.current === controls && controls.active === operation) {
        controls.active = null;
        if (mountedRef.current && tokenNow() === token) setActioningId("");
      }
    }
  }

  async function refreshOrders() {
    if (controlsRef.current.active) return;
    await loadOrders();
  }

  const stats = useMemo(() => {
    const accepted = orders.filter((order) => order.status === "ACCEPTED").length;
    const active = orders.filter((order) => order.status === "IN_PROGRESS").length;
    const completed = orders.filter((order) => order.status === "COMPLETED").length;
    return { accepted, active, completed };
  }, [orders]);

  return (
    <CompanionShell>
      <SectionHeader eyebrow="My Service" title="我的订单" desc="进入服务后开始计时，约定时长结束再报完成。收益先待结算，客户或管理员验收且无未决投诉后才可提现。" />
      <Link href="/available-orders" className="mt-4 inline-block rounded-dfc-control bg-cyan-300 px-4 py-3 font-bold text-slate-950">查看待接订单</Link>
      <button type="button" disabled={ordersLoading || Boolean(actioningId)} onClick={() => void refreshOrders()} className="ml-3 mt-4 rounded-dfc-control border border-cyan-300/30 px-4 py-3 font-bold disabled:opacity-50">刷新核对订单</button>

      <section className="mt-5 grid gap-4 md:grid-cols-3">
        <MetricCard label="待开始" value={String(stats.accepted)} hint="已接单，待开始服务" tone="cyan" />
        <MetricCard label="服务中" value={String(stats.active)} hint="需要按时完成" tone="gold" />
        <MetricCard label="已完成" value={String(stats.completed)} hint="完成后进入收益流水" tone="green" />
      </section>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}
      {recordState.error && (!recordState.orderId || !orders.some((order) => order.id === recordState.orderId)) ? <div className="mt-4 rounded-dfc-control border border-dfc-warning/35 bg-dfc-warning/10 px-3 py-2 text-sm text-dfc-warning" role={recordState.status === "denied" ? "alert" : "status"}>{recordState.error}</div> : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {ordersLoading ? <div className="companion-card p-4 text-sm text-dfc-subtext" role="status">正在加载订单列表…</div> : null}
        {orders.length ? (
          orders.map((order) => {
            const nextAction = order.status === "ACCEPTED" ? "开始" : order.status === "IN_PROGRESS" ? "完成" : undefined;
            const expanded = recordState.orderId === order.id;
            const panelId = `order-record-${order.id}`;
            return (
              <article key={order.id} className="companion-card min-w-0 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="break-words text-base font-black text-white">{order.orderNo}</h2>
                    <p className="mt-1 text-sm leading-6 text-dfc-subtext">{order.serviceKind === "GUARANTEE" ? `${order.mode} / 达标后报完成` : `${order.mode} / ${order.hours} 小时`}</p>
                    {order.customer ? <p className="mt-1 break-words text-xs text-dfc-muted">{order.customer.displayName}</p> : null}
                  </div>
                  <StatusBadge tone={orderStatusTone(order.status)}>{orderStatusLabel(order.status)}</StatusBadge>
                </div>
                <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-dfc-muted">订单金额</div>
                    <div className="mt-1 break-words text-2xl font-black tabular-nums text-dfc-gold">¥{order.totalAmount}</div>
                  </div>
                  {nextAction ? <ActionButton disabled={ordersLoading || Boolean(actioningId) || uncertainIds.includes(order.id)} onClick={nextAction === "开始" ? () => void updateOrder(order.id, "start") : () => void updateOrder(order.id, "complete")}>{nextAction}</ActionButton> : null}
                </div>
                {uncertainIds.includes(order.id) ? <p role="status" className="mt-3 text-sm text-dfc-warning">本单操作结果待核对，请先刷新核对订单；核对前不能重复开始或报完成。</p> : null}
                {order.serviceKind === "GUARANTEE" && ["ACCEPTED", "IN_PROGRESS"].includes(order.status) ? (
                  <p className="mt-2 text-xs leading-5 text-dfc-warning">保底单：老板先传开局仓库截图；打完你传结束仓库截图，净增达标后才能点「完成」。</p>
                ) : null}
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={expanded ? panelId : undefined}
                  onClick={expanded ? closeRecord : () => void loadRecord(order.id)}
                  className="mt-4 rounded-dfc-control border border-cyan-300/20 bg-[#101827] px-4 py-2 text-sm font-black text-dfc-text hover:border-cyan-300/45 hover:text-cyan-100"
                >
                  {expanded ? "收起订单记录" : "查看订单记录"}
                </button>
                {expanded ? <OrderRecordDetails id={panelId} state={recordState} onReload={() => void loadRecord(order.id)} /> : null}
                <GuaranteeEvidencePanel orderId={order.id} status={order.status} tokenKey="dfc_companion_token" defaultKind="VAULT_END" guarantee={order.serviceKind === "GUARANTEE"} />
              </article>
            );
          })
        ) : !ordersLoading && !error ? (
          <div className="companion-card p-4 text-sm text-dfc-subtext">暂无订单。</div>
        ) : null}
      </div>
    </CompanionShell>
  );
}

function OrderRecordDetails({ id, state, onReload }: { id?: string; state: OrderRecordState; onReload?: () => void }) {
  const view = state.record ? orderRecordView(state.record) : null;
  return (
    <section id={id} className="mt-4 min-w-0 border-t border-cyan-300/15 pt-4 text-sm" aria-label="订单记录" aria-busy={state.busy}>
      {state.busy ? <p className="text-dfc-subtext" role="status">正在核对身份并读取订单记录…</p> : null}
      {state.status === "denied" ? (
        <div className="rounded-dfc-control border border-dfc-danger/40 bg-dfc-danger/10 p-3 text-dfc-danger" role="alert">
          <p className="font-bold">无法查看此订单记录</p>
          <p className="mt-1 break-words">{state.error || "订单不存在或当前身份无权查看，请确认登录身份。"}</p>
        </div>
      ) : null}
      {state.status === "error" ? (
        <div className="rounded-dfc-control border border-dfc-warning/35 bg-dfc-warning/10 p-3 text-dfc-warning" role="status">
          <p className="font-bold">{view ? "记录刷新未成功，以下保留上次读取的内容" : "订单记录加载失败"}</p>
          <p className="mt-1 break-words">{state.error || "暂时无法读取记录，请稍后重试。"}</p>
          {onReload ? <button type="button" onClick={onReload} className="mt-3 rounded-dfc-control border border-cyan-300/20 bg-[#101827] px-4 py-2 text-sm font-black text-dfc-text hover:border-cyan-300/45 hover:text-cyan-100">重试读取</button> : null}
        </div>
      ) : null}
      {view && !state.busy && state.status !== "denied" ? (
        <div className="space-y-5">
          <div>
            <h3 className="font-black text-white">订单记录</h3>
            <dl className="mt-3 space-y-2">
              {view.fields.map((field) => <div key={field.label} className="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)]"><dt className="text-dfc-muted">{field.label}</dt><dd className="min-w-0 whitespace-pre-wrap break-words text-dfc-text">{field.value}</dd></div>)}
            </dl>
            <p className="mt-3 whitespace-pre-wrap break-words text-xs leading-5 text-dfc-subtext">{view.financialNotice}</p>
          </div>
          <div>
            <h3 className="font-black text-white">状态时间线</h3>
            {view.timeline.length ? <ol className="mt-3 space-y-3">{view.timeline.map((event) => <li key={event.id} className="min-w-0 border-l border-cyan-300/25 pl-3"><p className="break-words text-xs text-dfc-muted">{event.time}</p><p className="mt-1 break-words text-dfc-text">{event.change}</p><p className="mt-1 break-words text-xs text-dfc-subtext">{event.actor}</p></li>)}</ol> : <p className="mt-2 text-dfc-subtext">暂无可见状态变更。</p>}
            {view.timelineTruncated ? <p className="mt-3 text-xs text-dfc-warning">仅显示最近 100 条状态记录，较早记录未显示。</p> : null}
          </div>
          <div>
            <h3 className="font-black text-white">当前身份可见的投诉记录</h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-dfc-subtext">{view.evidenceScope}</p>
            {view.complaints.length ? <ul className="mt-3 space-y-3">{view.complaints.map((complaint) => <li key={complaint.id} className="min-w-0 rounded-dfc-control border border-cyan-300/15 p-3"><p className="break-words text-xs text-dfc-muted">{complaint.time} / {complaint.status}</p><p className="mt-2 whitespace-pre-wrap break-words text-dfc-text">{complaint.reason}</p><p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-dfc-subtext">处理结果：{complaint.resolution ?? "未提供可见处置说明，请以处理状态为准"}</p></li>)}</ul> : <p className="mt-2 text-dfc-subtext">当前身份暂无可见投诉记录。</p>}
            {view.complaintsTruncated ? <p className="mt-3 text-xs text-dfc-warning">投诉记录已截断，较早记录未显示。</p> : null}
          </div>
          {onReload ? <button type="button" onClick={onReload} className="rounded-dfc-control border border-cyan-300/20 bg-[#101827] px-4 py-2 text-sm font-black text-dfc-text hover:border-cyan-300/45 hover:text-cyan-100">重新读取记录</button> : null}
        </div>
      ) : null}
    </section>
  );
}

function orderStatusLabel(status: string) {
  const labels: Record<string, string> = {
    PAID: "待派单",
    ASSIGNED: "待接单",
    ACCEPTED: "已接单",
    IN_PROGRESS: "服务中",
    AWAITING_ACCEPTANCE: "待验收结算",
    COMPLETED: "已完成",
    REFUND_REQUESTED: "退款申请中",
    REFUNDED: "已退回站内余额",
    CANCELLED: "已取消",
    DISPUTED: "争议中"
  };
  return labels[status] ?? status;
}

function orderStatusTone(status: string): "default" | "warning" | "danger" | "success" {
  if (status === "COMPLETED") return "success";
  if (status === "CANCELLED" || status === "DISPUTED") return "danger";
  if (["PAID", "ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(status)) return "warning";
  return "default";
}

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success";
  return <div role={tone === "danger" ? "alert" : "status"} className={`mt-4 rounded-dfc-control border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}
