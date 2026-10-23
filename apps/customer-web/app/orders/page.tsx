"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createOrderRecordClient, orderRecordView, type OrderRecordState } from "@dfc/ui";
import { CustomerShell } from "../components";
import { EscrowProgress, EscrowPromise } from "../escrow";
import { GuaranteeEvidencePanel } from "../guarantee-evidence";
import { reorderHref } from "../order/order-entry";
import { AcceptanceCountdown } from "./acceptance-countdown";
import { ReviewForm } from "./review-form";
import { TipForm } from "./tip-form";

type Order = {
  hasReview?: boolean;
  autoAcceptanceDueAt?: string | null;
  id: string;
  orderNo: string;
  status: string;
  mode: string;
  hours: string;
  totalAmount: string;
  refundAmount?: string;
  serviceKind?: string;
  originalAmount?: string | null;
  memberDiscountRate?: string | null;
  tipAmount?: string;
  companionId?: string | null;
  companion?: { displayName: string } | null;
};
const labels: Record<string, string> = {
  PAID: "待派单",
  ASSIGNED: "待接单",
  ACCEPTED: "已接单",
  IN_PROGRESS: "服务中",
  AWAITING_ACCEPTANCE: "待你验收",
  COMPLETED: "已完成",
  DISPUTED: "争议处理中",
  REFUND_REQUESTED: "退款申请中",
  REFUNDED: "已退回站内余额",
  CANCELLED: "已取消",
};

const nextSteps: Record<string, string> = {
  PAID: "等待客服分配陪玩，请稍后刷新查看。",
  ASSIGNED: "等待陪玩接单，请稍后刷新查看。",
  ACCEPTED: "陪玩已接单，请联系陪玩约好开始时间。",
  IN_PROGRESS: "正在服务，结束后请核对服务与时长。",
  AWAITING_ACCEPTANCE: "请核对服务与时长，再确认验收；有异议可提交投诉。",
  COMPLETED: "订单已完成，可到钱包查看记录；有异议可提交投诉。",
  DISPUTED: "请保留沟通记录，等待客服处理。",
  REFUND_REQUESTED: "等待人工核对退款申请，请保留记录并联系管理员。",
  REFUNDED: "记录显示已退回站内余额，请到钱包核对流水。",
  CANCELLED: "订单已取消，请到钱包核对记录；需要服务可重新下单。",
};

export default function OrdersPage() {
  const [kookUrl, setKookUrl] = useState("");
  const [orders, setOrders] = useState<Order[]>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [listLoading, setListLoading] = useState(true);
  const [recordState, setRecordState] = useState<OrderRecordState>({ record: null, error: "", busy: false, orderId: null, status: "idle" });
  const [recordEntryMessage, setRecordEntryMessage] = useState("");
  const reader = useRef<ReturnType<typeof createOrderRecordClient> | null>(null);
  const listed = useRef<{ token: string; ids: Set<string> } | null>(null);
  const listEpoch = useRef(0), mounted = useRef(false), recordEntryApplied = useRef(false);
  function tokenNow() { try { return localStorage.getItem("dfc_customer_token"); } catch { return null; } }
  function closeRecord() { if (reader.current) setRecordState(reader.current.clear()); }
  function changedIdentity() {
    listEpoch.current++; listed.current = null;
    setOrders(undefined); setListLoading(false); setChecked({}); setNotice("");
    setRecordEntryMessage(""); closeRecord();
    setError("登录身份已变化，请重新核对身份后刷新订单。");
  }
  async function readRecord(orderId: string) {
    const active = reader.current;
    if (!active) return;
    if (!listed.current || tokenNow() !== listed.current.token) { changedIdentity(); return; }
    if (!listed.current.ids.has(orderId)) { setRecordEntryMessage("未在当前身份的订单列表中找到该订单，请刷新列表核对。"); return; }
    setRecordEntryMessage("");
    const pending = active.load(orderId);
    setRecordState(active.state());
    await pending;
    if (mounted.current && reader.current === active) {
      if (listed.current && tokenNow() !== listed.current.token) { changedIdentity(); return; }
      setRecordState(active.state());
    }
  }
  function toggleRecord(orderId: string) {
    if (!listed.current || tokenNow() !== listed.current.token) { changedIdentity(); return; }
    if (reader.current?.state().orderId === orderId) closeRecord();
    else void readRecord(orderId);
  }
  async function request(path: string, method = "GET") {
    const token = localStorage.getItem("dfc_customer_token");
    if (!token) throw new Error("请先登录客户账号");
    const response = await fetch(path, {
      method,
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    if (tokenNow() !== token) {
      if (mounted.current) changedIdentity();
      throw new Error("登录身份已变化，请回原身份核对订单结果。");
    }
    if (!response.ok) throw new Error(data.message || "操作未完成，请重试");
    return data;
  }
  async function load() {
    const token = tokenNow(); listEpoch.current++;
    if (!token) { changedIdentity(); throw new Error("请先登录客户账号"); }
    if (listed.current && listed.current.token !== token) changedIdentity();
    const currentGeneration = listEpoch.current;
    setListLoading(true);
    try {
      const data = await request("/api/orders/my");
      if (!mounted.current || currentGeneration !== listEpoch.current) return;
      if (tokenNow() !== token) { changedIdentity(); return; }
      if (!Array.isArray(data) || !data.every(order => order && typeof order.id === "string" && typeof order.totalAmount === "string")) throw new Error("订单列表返回不完整，请刷新核对。");
      listed.current = { token, ids: new Set(data.map((order: Order) => order.id)) };
      setOrders(data as Order[]);
      setError("");
      if (!recordEntryApplied.current) {
        recordEntryApplied.current = true;
        const requested = new URLSearchParams(window.location.search).get("record");
        if (requested) {
          if (listed.current.ids.has(requested)) void readRecord(requested);
          else setRecordEntryMessage("未在当前身份的订单列表中找到链接中的订单，请刷新或联系管理员核对。");
        }
      }
    } catch (error) {
      if (!mounted.current || currentGeneration !== listEpoch.current) return;
      throw error;
    } finally {
      if (mounted.current && currentGeneration === listEpoch.current) setListLoading(false);
    }
  }
  useEffect(() => {
    let closed = false;
    mounted.current = true;
    const active = createOrderRecordClient({ fetcher: fetch, getToken: tokenNow });
    reader.current = active;
    function checkSession() {
      if (listed.current && tokenNow() !== listed.current.token) { changedIdentity(); return; }
      setRecordState(active.state());
    }
    function visibility() { if (document.visibilityState === "visible") checkSession(); }
    window.addEventListener("storage", checkSession);
    window.addEventListener("focus", checkSession);
    document.addEventListener("visibilitychange", visibility);
    void fetch("/api/auth/public-config").then(r => r.ok ? r.json() : null)
      .then(data => { if (!closed) setKookUrl(data?.support?.orderKookUrl?.trim() || ""); }).catch(() => {});
    void load().catch((e) => { if (!closed) setError(e instanceof Error ? e.message : "订单读取失败，请刷新核对。"); });
    return () => {
      closed = true; mounted.current = false; listEpoch.current++; active.clear();
      if (reader.current === active) reader.current = null;
      window.removeEventListener("storage", checkSession);
      window.removeEventListener("focus", checkSession);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  async function refresh() {
    if (busy) return;
    closeRecord();
    setBusy(true);
    try { await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "刷新失败，请重试"); }
    finally { setBusy(false); }
  }
  async function accept(order: Order) {
    if (!checked[order.id]) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(`/api/orders/${order.id}/confirm-completion`, "PATCH");
      closeRecord();
      setNotice(`订单 ${order.orderNo} 已验收，结算已记录。`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "验收失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <CustomerShell>
      <h1 className="text-2xl font-black text-white">我的订单与验收</h1>
      <button className="maycat-button-secondary mt-3 px-4 py-2" disabled={busy} onClick={() => void refresh()}>{busy ? "正在处理…" : "刷新订单"}</button>
      <p className="my-4 text-sm text-dfc-subtext">
        陪玩报完成后，请核对服务与时长。确认验收会释放对应收益；有异议可先提交投诉，等待人工处理。
      </p>
      <EscrowPromise compact />
      {error && (
        <p role="alert" className="my-4 text-red-200">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="my-4 text-green-200">
          {notice}
        </p>
      )}
      {recordEntryMessage ? <p role="status" className="my-3 text-sm text-amber-100">{recordEntryMessage}</p> : null}
      {recordState.error && recordState.orderId === null ? <p role="alert" className="my-3 text-sm text-amber-100">{recordState.error}</p> : null}
      {listLoading && <p role="status">正在加载本人订单…</p>}
      {!listLoading && orders?.length === 0 && <p>暂无订单。</p>}
      <div className="space-y-4">
        {orders?.map((order) => (
          <article key={order.id} className="maycat-card p-4">
            <div className="flex flex-wrap justify-between gap-3">
              <strong>{order.orderNo}</strong>
              <span>{labels[order.status] || order.status}</span>
            </div>
            <p className="my-3 text-sm text-dfc-subtext">
              {order.mode}{order.serviceKind && order.serviceKind !== "HOURLY" ? " · 一口价" : ` · ${order.hours} 小时`} · ¥
              {order.totalAmount}
              {order.memberDiscountRate && order.originalAmount ? <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand-ink">会员价 · 省 ¥{(Number(order.originalAmount) - Number(order.totalAmount)).toFixed(2)}</span> : null}
            </p>
            <EscrowProgress order={order} />
            <GuaranteeEvidencePanel orderId={order.id} status={order.status} tokenKey="dfc_customer_token" defaultKind="VAULT_START" guarantee={order.serviceKind === "GUARANTEE"} />
            <p className="mt-3">陪玩：{order.companion?.displayName || "待分配"}</p>
            <p className="my-3 text-sm text-dfc-subtext">{nextSteps[order.status] || "订单状态待核对，请刷新；仍不明确请联系客服。"}</p>
            {kookUrl && !["COMPLETED", "REFUNDED", "CANCELLED"].includes(order.status) ? <a href={kookUrl} target="_blank" rel="noopener noreferrer" className="mb-3 inline-block text-sm text-cyan-200 underline">去 KOOK 找陪玩</a> : null}
            {order.status === "AWAITING_ACCEPTANCE" && (
              <div className="mb-3 flex flex-wrap items-center gap-4">
                <label className="text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(checked[order.id])}
                    onChange={(e) =>
                      setChecked({ ...checked, [order.id]: e.target.checked })
                    }
                  />{" "}
                  我已核对服务完成，同意结算
                </label>
                <button
                  disabled={busy || !checked[order.id]}
                  onClick={() => void accept(order)}
                  className="maycat-button px-4 py-2 disabled:opacity-40"
                >
                  确认验收
                </button>
              </div>
            )}
            {order.status === "AWAITING_ACCEPTANCE" && <AcceptanceCountdown dueAt={order.autoAcceptanceDueAt} />}
            {(order.status === "AWAITING_ACCEPTANCE" || order.status === "COMPLETED") && order.companionId
              ? <TipForm orderId={order.id} companionName={order.companion?.displayName || "陪玩"} tipped={order.tipAmount ?? "0.00"} onTipped={() => void load()} /> : null}
            {reorderHref(order) ? <Link href={reorderHref(order)!} className="maycat-button mb-3 inline-block px-4 py-2 text-sm font-black">再来一单（{order.companion?.displayName || "同一陪玩"}）</Link> : null}
            {order.status === "COMPLETED" && (order.hasReview ? <p className="my-3 text-sm">已评价</p> : <ReviewForm orderId={order.id} onSubmitted={load} />)}
            <Link
              href={`/complaints?orderId=${encodeURIComponent(order.id)}`}
              className="text-sm text-cyan-200 underline"
            >
              服务异议 / 投诉与申诉
            </Link>
            <div className="mt-3">
              <button type="button" className="maycat-button-secondary px-4 py-2 text-sm" aria-expanded={recordState.orderId === order.id} aria-controls={`record-${order.id}`} onClick={() => toggleRecord(order.id)}>
                {recordState.orderId === order.id ? "收起订单记录" : "查看订单记录"}
              </button>
              {recordState.orderId === order.id ? <div id={`record-${order.id}`} className="mt-3"><OrderRecordDetails state={recordState} onReload={() => void readRecord(order.id)} /></div> : null}
            </div>
          </article>
        ))}
      </div>
    </CustomerShell>
  );
}

function OrderRecordDetails({ state, onReload }: { state: OrderRecordState; onReload?(): void }) {
  if (state.busy) return <p role="status" className="text-sm">正在核验身份并读取当前订单记录…</p>;
  if (state.status === "denied") return <p role="alert" className="text-sm text-amber-100">记录访问未通过：{state.error}</p>;
  if (state.error) return <div role="alert" className="text-sm text-rose-100"><p>{state.error}</p><button type="button" className="mt-2 underline" onClick={onReload}>重新读取记录</button></div>;
  if (!state.record) return null;
  const view = orderRecordView(state.record);
  return <section aria-label="订单记录" className="space-y-4 rounded-dfc border border-cyan-300/20 p-3 text-sm">
    <h2 className="font-bold">订单 {state.record.orderNo} · 记录</h2>
    <p className="text-dfc-subtext">{view.evidenceScope}</p>
    <dl className="grid gap-2 sm:grid-cols-2">{view.fields.map(field => <div key={field.label} className="min-w-0 break-words"><dt className="text-dfc-subtext">{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
    <p className="text-amber-100">{view.financialNotice}</p>
    <div><h3 className="font-bold">状态时间线</h3>
      {view.timeline.length ? <ol className="mt-2 space-y-2">{view.timeline.map(event => <li key={event.id} className="break-words border-l border-cyan-300/30 pl-3"><p>{event.time} · {event.actor}</p><p>{event.change}</p></li>)}</ol> : <p>当前返回范围内暂无状态记录。</p>}
      {view.timelineTruncated ? <p className="mt-2 text-amber-100">仅显示最近 100 条状态记录，较早记录未显示。</p> : null}
    </div>
    <div><h3 className="font-bold">当前身份可见的投诉记录</h3>
      {view.complaints.length ? <ul className="mt-2 space-y-3">{view.complaints.map(complaint => <li key={complaint.id} className="break-words"><p>{complaint.time} · {complaint.status}</p><p className="whitespace-pre-wrap">{complaint.reason}</p><p className="whitespace-pre-wrap">处理说明：{complaint.resolution ?? "未提供可见处置说明，请以处理状态为准"}</p></li>)}</ul> : <p>当前身份可见范围内暂无投诉记录。</p>}
      {view.complaintsTruncated ? <p className="mt-2 text-amber-100">投诉记录已截断，较早记录未显示。</p> : null}
    </div>
    <button type="button" className="underline" onClick={onReload}>重新读取记录</button>
  </section>;
}
