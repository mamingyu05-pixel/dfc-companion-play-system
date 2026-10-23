"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AdminShell, DataTable, StatusBadge } from "../components";
import { adminApi, ExportButton } from "../batch-tools";

type AdminOrder = {
  id: string;
  orderNo: string;
  game: string;
  mode: string;
  hours: string;
  originalUnitPrice?: string | null;
  unitPrice: string;
  discountPerHour?: string;
  originalAmount?: string | null;
  totalAmount: string;
  status: string;
  dispatchVersion?: number;
  companionId?: string | null;
  notes?: string | null;
  sourcePlatform?: string | null;
  serviceKind?: string | null;
  voiceTrialRequested: boolean;
  customer?: { email: string; displayName: string };
  companion?: { email: string; displayName: string } | null;
  orderGroup?: {
    id: string;
    groupNo: string;
    companionCount: number;
    originalAmount: string;
    discountAmount: string;
    totalAmount: string;
  } | null;
  createdAt: string;
};

type OrderDraft = { id: string; status: string };

// Each tab is a question staff actually ask: what needs me, what is running, what is done.
const TABS: Array<{ key: string; label: string; statuses: string[] | null }> = [
  { key: "all", label: "全部", statuses: null },
  { key: "dispatch", label: "待派单 / 待接单", statuses: ["PAID", "ASSIGNED"] },
  { key: "active", label: "服务中", statuses: ["ACCEPTED", "IN_PROGRESS"] },
  { key: "review", label: "待验收", statuses: ["AWAITING_ACCEPTANCE"] },
  { key: "issue", label: "争议 / 退款", statuses: ["DISPUTED", "REFUND_REQUESTED"] },
  { key: "done", label: "已完成", statuses: ["COMPLETED"] },
  { key: "closed", label: "已取消", statuses: ["CANCELLED", "REFUNDED"] }
];

export default function OrdersPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [drafts, setDrafts] = useState<OrderDraft[]>([]);
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [actioningOrderId, setActioningOrderId] = useState("");
  const [swapping, setSwapping] = useState<AdminOrder | null>(null);

  async function loadOrders() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    const [ordersResponse, draftsResponse] = await Promise.all([
      fetch("/api/admin/orders", { headers }),
      fetch("/api/admin/order-drafts", { headers })
    ]);
    if (!ordersResponse.ok || !draftsResponse.ok) throw new Error("无法加载订单");
    setOrders((await ordersResponse.json()) as AdminOrder[]);
    setDrafts((await draftsResponse.json()) as OrderDraft[]);
  }

  useEffect(() => {
    void loadOrders().catch(() => setError("无法加载订单数据，请确认已登录"));
  }, []);

  // The list holds the latest 200 orders; a search also asks the server, so older orders can be found.
  const [serverMatches, setServerMatches] = useState<AdminOrder[] | null>(null);
  useEffect(() => {
    const q = search.trim();
    setServerMatches(null);
    if (q.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      const token = localStorage.getItem("dfc_admin_token");
      if (!token) return;
      void fetch(`/api/admin/orders?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => (r.ok ? r.json() : null))
        .then(data => { if (live && Array.isArray(data)) setServerMatches(data as AdminOrder[]); })
        .catch(() => undefined);
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [search]);

  async function cancelOrder(order: AdminOrder) {
    if (!canCancelOrder(order)) return;
    const message = order.orderGroup
      ? `确认取消并退款 ${order.orderNo}？如果订单组人数降到折扣门槛以下，系统会自动取消剩余订单折扣并重算钱包冻结金额。`
      : `确认取消 ${order.orderNo}，并把 ¥${formatMoney(order.totalAmount)} 退回客户余额？`;
    if (!window.confirm(message)) return;
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) {
      setError("请先登录管理员账号");
      return;
    }
    try {
      setActioningOrderId(order.id);
      setError("");
      const response = await fetch(`/api/admin/orders/${order.id}/cancel`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ note: "管理员取消未开始订单" })
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
        const detail = Array.isArray(data.message) ? data.message.join(", ") : data.message;
        throw new Error(detail || "取消订单失败");
      }
      await loadOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "取消订单失败");
    } finally {
      setActioningOrderId("");
    }
  }

  const openDrafts = drafts.filter((draft) => draft.status !== "CONVERTED" && draft.status !== "CANCELLED").length;
  const counts = useMemo(() => Object.fromEntries(TABS.map(t => [t.key, t.statuses ? orders.filter(o => t.statuses!.includes(o.status)).length : orders.length])), [orders]);
  const term = search.trim().toLowerCase();
  const statuses = TABS.find(t => t.key === tab)?.statuses ?? null;
  const searchable = term && serverMatches ? serverMatches : orders;
  const visible = searchable.filter(order => (!statuses || statuses.includes(order.status)) &&
    (!term || [order.orderNo, order.customer?.displayName, order.companion?.displayName, order.customer?.email, order.notes, order.mode].some(v => v?.toLowerCase().includes(term))));
  const todayAmount = useMemo(() => {
    const today = new Date().toDateString();
    return orders.filter(o => new Date(o.createdAt).toDateString() === today && !["CANCELLED", "REFUNDED"].includes(o.status))
      .reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
  }, [orders]);

  return (
    <AdminShell>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-dfc-text">订单</h1>
          <p className="mt-1 text-sm text-dfc-muted">今日下单 ¥{formatMoney(String(todayAmount))} · 共 {orders.length} 笔（最近 200 笔）</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/quick-order" className="rounded-[10px] bg-brand px-4 py-2 text-sm font-black text-white hover:bg-brand-ink">＋ 新开一单</Link>
          <ExportButton kind="orders" label="订单" />
        </div>
      </div>

      {error ? <div className="mb-4 rounded-[12px] border border-[#f6c3c4] bg-[#fff1f1] px-3 py-2 text-sm text-dfc-danger">{error}</div> : null}

      {swapping ? <SwapCompanionPanel order={swapping} onClose={() => setSwapping(null)} onDone={() => { setSwapping(null); void loadOrders().catch(() => undefined); }} /> : null}

      {openDrafts ? (
        <Link href="/order-drafts" className="mb-4 flex items-center justify-between rounded-[12px] border border-[#ffd8b5] bg-[#fff7ef] px-4 py-3 text-sm">
          <span className="text-dfc-text"><b>{openDrafts} 条 KOOK / Discord 需求</b> 还没转成订单（AI 客服整理的派单草稿）</span>
          <span className="font-black text-brand-ink">去处理 →</span>
        </Link>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-[10px] border border-[#e6e8ef] bg-white p-1">
          {TABS.map(t => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={`rounded-[8px] px-3 py-1.5 text-sm font-bold ${tab === t.key ? "bg-brand text-white" : "text-dfc-subtext hover:bg-[#f8f9fc]"}`}>
              {t.label}<span className={`ml-1 text-xs ${tab === t.key ? "text-white/80" : "text-dfc-muted"}`}>{counts[t.key]}</span>
            </button>
          ))}
        </div>
        <input className="input max-w-xs" placeholder="搜订单号、客户、陪玩、备注" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <DataTable
        columns={["订单", "客户", "陪玩", "内容", "金额", "状态", "操作"]}
        maxHeightClassName="max-h-[70vh]"
        stickyHeader
        rows={visible.map((order) => [
          <div key={`${order.id}-no`}>
            <div className="font-bold text-dfc-text">{order.orderNo}</div>
            <div className="mt-0.5 text-xs text-dfc-muted">{formatDateTime(order.createdAt)}{order.sourcePlatform === "KOOK" ? " · KOOK" : order.sourcePlatform === "DISCORD" ? " · Discord" : ""}</div>
          </div>,
          order.customer?.displayName ?? "-",
          order.companion ? order.companion.displayName : <span key={`${order.id}-none`} className="text-dfc-muted">未指定</span>,
          <div key={`${order.id}-content`} className="max-w-[260px] whitespace-normal">
            <div>{gameName(order.game)} · {order.mode}{order.serviceKind === "GUARANTEE" || order.serviceKind === "PACKAGE" ? " · 一口价" : ` · ${Number(order.hours)} 小时`}</div>
            {order.notes ? <div className="mt-0.5 line-clamp-1 text-xs text-dfc-muted">{order.notes}</div> : null}
            {order.orderGroup ? <div className="mt-0.5 text-xs text-dfc-muted">多人单 {order.orderGroup.groupNo} · {order.orderGroup.companionCount} 人</div> : null}
            {order.voiceTrialRequested ? <div className="mt-0.5 text-xs text-dfc-warning">需要试音</div> : null}
          </div>,
          <OrderAmount key={`${order.id}-amount`} order={order} />,
          <StatusBadge key={`${order.id}-status`} tone={statusTone(order.status)}>{toOrderStatus(order.status)}</StatusBadge>,
          <div key={`${order.id}-actions`} className="flex flex-wrap gap-2">
            {["PAID", "ASSIGNED"].includes(order.status) ? <Link href={`/dispatch?orderId=${encodeURIComponent(order.id)}`} className="rounded-[9px] bg-brand px-3 py-1.5 text-xs font-black text-white hover:bg-brand-ink">{order.status === "PAID" ? "派单" : "换人"}</Link> : null}
            {canSwapCompanion(order) ? (
              <button type="button" onClick={() => setSwapping(order)}
                className="rounded-[9px] border border-[#e6e8ef] bg-white px-3 py-1.5 text-xs font-bold text-dfc-text hover:border-brand">中途换人</button>
            ) : null}
            {canCancelOrder(order) ? (
              <button type="button" disabled={actioningOrderId === order.id} onClick={() => void cancelOrder(order)}
                className="rounded-[9px] border border-[#f6c3c4] bg-white px-3 py-1.5 text-xs font-bold text-dfc-danger hover:bg-[#fdecec] disabled:cursor-not-allowed disabled:opacity-45">
                {actioningOrderId === order.id ? "处理中" : "取消退款"}
              </button>
            ) : <span key={`${order.id}-no-action`} className="text-xs text-dfc-muted">{nextStep(order.status)}</span>}
          </div>
        ])}
      />
    </AdminShell>
  );
}

type SwapCandidate = { userId: string; nickname: string; status: string; onlineStatus: string; game: string; games?: string[] };

// Settles the hours already played to the first companion, then hands the rest to the new one as a follow-on order.
function SwapCompanionPanel({ order, onClose, onDone }: { order: AdminOrder; onClose: () => void; onDone: () => void }) {
  const [candidates, setCandidates] = useState<SwapCandidate[]>([]);
  const [newCompanionId, setNewCompanionId] = useState("");
  const [servedHours, setServedHours] = useState("0");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hourly = order.serviceKind !== "GUARANTEE" && order.serviceKind !== "PACKAGE";
  const started = order.status === "IN_PROGRESS";

  useEffect(() => {
    adminApi<SwapCandidate[]>("/api/admin/companions")
      .then(list => setCandidates(list.filter(c => c.status === "LISTED" && c.userId !== order.companionId)))
      .catch(e => setError(e instanceof Error ? e.message : "无法加载陪玩"));
  }, [order.companionId]);

  const served = Number(servedHours || 0);
  const remaining = Math.max(0, Number(order.hours) - served);
  const chosen = candidates.find(c => c.userId === newCompanionId);

  async function submit() {
    if (!chosen) { setError("请选择新的陪玩"); return; }
    if (!reason.trim()) { setError("请填写换人原因"); return; }
    const settle = served > 0 ? `已服务 ${served} 小时按 ¥${formatMoney(String(served * Number(order.unitPrice)))} 结给原陪玩，剩余 ${remaining} 小时转给「${chosen.nickname}」` : `整单转给「${chosen.nickname}」`;
    if (!window.confirm(`${order.orderNo}：${settle}？`)) return;
    setBusy(true); setError("");
    try {
      await adminApi(`/api/admin/orders/${encodeURIComponent(order.id)}/swap-companion`, { method: "POST", body: JSON.stringify({
        newCompanionId, servedHours: served > 0 ? servedHours.trim() : "0", reason: reason.trim(), dispatchVersion: order.dispatchVersion ?? 0
      }) });
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "换人失败"); }
    finally { setBusy(false); }
  }

  return (
    <section className="admin-panel mb-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-black">中途换人 · {order.orderNo}（现陪玩：{order.companion?.displayName ?? "未指定"}）</h2>
        <button type="button" className="text-xs text-dfc-muted underline" onClick={onClose}>关闭</button>
      </div>
      {error ? <div role="alert" className="mt-2 text-sm text-dfc-danger">{error}</div> : null}
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <label className="text-xs font-semibold">新陪玩
          <select className="input mt-1 w-full" value={newCompanionId} onChange={e => setNewCompanionId(e.target.value)}>
            <option value="">请选择</option>
            {candidates.map(c => <option key={c.userId} value={c.userId}>{c.nickname}{c.onlineStatus === "ONLINE" ? " · 在线" : c.onlineStatus === "BUSY" ? " · 忙碌" : ""}</option>)}
          </select>
        </label>
        {hourly && started ? (
          <label className="text-xs font-semibold">原陪玩已服务（小时，按 0.5 填）
            <input className="input mt-1 w-full" inputMode="decimal" value={servedHours} onChange={e => setServedHours(e.target.value)} />
            <span className="mt-1 block font-normal text-dfc-muted">共 {Number(order.hours)} 小时，剩余 {remaining} 小时给新陪玩</span>
          </label>
        ) : <p className="self-center text-xs text-dfc-muted">{hourly ? "还没开始服务，整单直接转给新陪玩。" : "一口价订单整单转给新陪玩。"}</p>}
        <label className="text-xs font-semibold">换人原因（会记日志）
          <input className="input mt-1 w-full" maxLength={200} placeholder="如：原陪玩掉线 / 客户要求换人" value={reason} onChange={e => setReason(e.target.value)} />
        </label>
      </div>
      <div className="mt-3">
        <button type="button" disabled={busy} onClick={() => void submit()}
          className="rounded-[9px] bg-brand px-4 py-2 text-xs font-black text-white hover:bg-brand-ink disabled:opacity-50">{busy ? "处理中" : "确认换人"}</button>
      </div>
    </section>
  );
}

function canSwapCompanion(order: AdminOrder) {
  return ["ACCEPTED", "IN_PROGRESS"].includes(order.status) && Boolean(order.companion) && !order.orderGroup;
}

function OrderAmount({ order }: { order: AdminOrder }) {
  const originalAmount = Number(order.originalAmount ?? order.totalAmount);
  const totalAmount = Number(order.totalAmount || 0);
  const discount = Math.max(0, originalAmount - totalAmount);
  return (
    <div>
      <div className="font-black tabular-nums text-dfc-text">¥{formatMoney(order.totalAmount)}</div>
      {discount > 0 ? <div className="text-xs text-dfc-muted">原价 ¥{formatMoney(String(originalAmount))}，优惠 ¥{formatMoney(String(discount))}</div> : null}
    </div>
  );
}

function nextStep(status: string) {
  const map: Record<string, string> = {
    AWAITING_ACCEPTANCE: "等客户验收",
    IN_PROGRESS: "陪玩服务中",
    DISPUTED: "去投诉页处理",
    REFUND_REQUESTED: "去投诉页处理"
  };
  return map[status] ?? "—";
}

function formatMoney(value: string) {
  return Number(value || 0).toFixed(2);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function gameName(code: string) {
  const names: Record<string, string> = {
    DELTA_FORCE: "三角洲行动",
    LEAGUE_OF_LEGENDS: "英雄联盟",
    VALORANT: "无畏契约",
    COUNTER_STRIKE_2: "CS2",
    PUBG: "PUBG 绝地求生",
    APEX_LEGENDS: "Apex 英雄",
    NARAKA_BLADEPOINT: "永劫无间",
    CALL_OF_DUTY: "塔科夫 / COD"
  };
  return names[code] ?? code;
}

function toOrderStatus(status: string) {
  const map: Record<string, string> = {
    PENDING_PAYMENT: "待支付",
    PAID: "待派单",
    ASSIGNED: "等陪玩接单",
    ACCEPTED: "已接单",
    IN_PROGRESS: "进行中",
    AWAITING_ACCEPTANCE: "待验收",
    COMPLETED: "已完成",
    CANCELLED: "已取消",
    REFUND_REQUESTED: "退款申请",
    REFUNDED: "已退款",
    DISPUTED: "争议中"
  };
  return map[status] ?? status;
}

function canCancelOrder(order: AdminOrder) {
  return ["PAID", "ASSIGNED", "ACCEPTED"].includes(order.status);
}

function statusTone(status: string): "default" | "warning" | "danger" | "success" {
  if (status === "COMPLETED") return "success";
  if (status === "CANCELLED" || status === "REFUNDED" || status === "DISPUTED" || status === "REFUND_REQUESTED") return "danger";
  if (status === "PAID" || status === "ASSIGNED" || status === "AWAITING_ACCEPTANCE") return "warning";
  return "default";
}
