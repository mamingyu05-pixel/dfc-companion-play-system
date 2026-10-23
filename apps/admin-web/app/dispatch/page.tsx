"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AdminShell, StatusBadge } from "../components";

type AdminOrder = {
  id: string;
  orderNo: string;
  game: string;
  mode: string;
  hours: string;
  unitPrice: string;
  originalUnitPrice?: string | null;
  rankTierKey?: string | null;
  rankTierNameSnapshot?: string | null;
  totalAmount: string;
  status: string;
  assignmentType: string;
  dispatchVersion: number;
  acceptanceDeadline?: string | null;
  notes?: string | null;
  sourcePlatform?: string | null;
  serviceKind?: string | null;
  createdAt?: string;
  dispatchReminder?: { dispatchVersion: number; assignedAt: string | null; dueAt: string | null; due: boolean; checkedAt: string };
  statusLogs?: Array<{ reason: string | null }>;
  customer?: { email: string; displayName: string };
  companion?: { email: string; displayName: string } | null;
};

type Companion = {
  userId: string;
  nickname: string;
  email: string;
  status: string;
  onlineStatus: string;
  game: string;
  games?: string[];
  userStatus: string;
  activeServiceCount: number;
  skillModes?: string[];
  pricePerHour: string;
};

const QUICK_REASONS = ["客户在 KOOK 确认", "客户指定这位陪玩", "原陪玩未回应，换人", "客户要求换人"];

export default function DispatchPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [selectedCompanionId, setSelectedCompanionId] = useState("");
  const [companionQuery, setCompanionQuery] = useState("");
  const [dispatchMode, setDispatchMode] = useState<"DIRECT" | "OPEN">("DIRECT");
  const [reason, setReason] = useState("");
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function loadData(preferredOrderId?: string) {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    const [ordersResponse, companionsResponse] = await Promise.all([
      fetch("/api/admin/orders", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/admin/companions", { headers: { Authorization: `Bearer ${token}` } })
    ]);
    if (!ordersResponse.ok || !companionsResponse.ok) throw new Error("无法加载派单数据");
    const orderData = (await ordersResponse.json()) as AdminOrder[];
    const companionData = (await companionsResponse.json()) as Companion[];
    setOrders(orderData);
    setCompanions(companionData);
    setSelectedOrderId((current) => orderData.some((order) => order.id === current && ["PAID", "ASSIGNED"].includes(order.status)) ? current : orderData.some(order => order.id === preferredOrderId && ["PAID", "ASSIGNED"].includes(order.status)) ? preferredOrderId! : "");
    setSelectedCompanionId((current) => companionData.some((item) => item.userId === current && item.status === "LISTED") ? current : "");
  }

  useEffect(() => {
    void loadData(new URLSearchParams(window.location.search).get("orderId") ?? undefined).catch(() => setError("无法加载派单数据，请确认已登录"));
  }, []);

  function selectOrder(id: string) {
    setSelectedOrderId(id);
    setSelectedCompanionId("");
    setDispatchMode("DIRECT");
    setStatus("");
  }

  async function assign() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    if (!selectedOrderId || (dispatchMode === "DIRECT" && !selectedCompanionId) || !reason.trim()) {
      setError("请选择订单、陪玩，并写一句派单依据");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch(`/api/admin/orders/${selectedOrderId}/dispatch`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ dispatchVersion: orders.find(order => order.id === selectedOrderId)?.dispatchVersion, mode: dispatchMode, companionId: dispatchMode === "DIRECT" ? selectedCompanionId : undefined, reason: reason.trim(), acceptanceDeadline: deadline ? new Date(deadline).toISOString() : null })
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
      if (!response.ok) {
        const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
        setError(toFriendlyError(message));
        return;
      }
      setStatus(dispatchMode === "OPEN" ? "已发到派单频道，等陪玩抢单。" : "已派出，等陪玩本人在 KOOK 点接单。");
      setReason("");
      await loadData();
    } finally {
      setBusy(false);
    }
  }

  async function expireDue() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    const response = await fetch("/api/admin/orders/expire-assignments", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) { setError("超时处置失败，请重试"); return; }
    const result = await response.json();
    setStatus(`已将 ${result.expired} 笔超时订单退回待派单。`);
    await loadData();
  }

  const eligible = orders.filter((order) => ["PAID", "ASSIGNED"].includes(order.status));
  const attention = eligible.filter(needsDispatchAttention);
  const pending = onlyAttention ? attention : eligible;
  const reminded = eligible.filter(order => hasDispatchReminder(order));
  const selectedOrder = eligible.find((order) => order.id === selectedOrderId);
  const listedCompanions = companions.filter((companion) => {
    const keyword = companionQuery.trim().toLowerCase();
    const matchesKeyword = !keyword || [companion.nickname, companion.email].some((value) => value.toLowerCase().includes(keyword));
    return companion.status === "LISTED" && companion.userStatus === "ACTIVE" && matchesKeyword &&
      (!selectedOrder || companion.game === selectedOrder.game || companion.games?.includes(selectedOrder.game));
  }).sort((a, b) => availability(a) - availability(b));
  const onlineCount = companions.filter((companion) => companion.status === "LISTED" && companion.onlineStatus === "ONLINE").length;
  const selectedCompanion = listedCompanions.find((companion) => companion.userId === selectedCompanionId && companion.onlineStatus !== "BUSY" && !companion.activeServiceCount);
  const waitingAmount = useMemo(() => eligible.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0), [eligible]);
  const canSubmit = Boolean(selectedOrder && (dispatchMode === "OPEN" || selectedCompanion) && reason.trim() && !busy);

  return (
    <AdminShell>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-dfc-text">派单台</h1>
          <p className="mt-1 text-sm text-dfc-muted">左边点一个订单，右边选陪玩，写一句依据就能派出。陪玩在 KOOK 点接单前都可以换人。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/quick-order" className="rounded-[10px] bg-brand px-4 py-2 text-sm font-black text-white hover:bg-brand-ink">＋ 新开一单</Link>
          <Link href="/order-drafts" className="rounded-[10px] border border-[#e6e8ef] bg-white px-4 py-2 text-sm font-bold text-dfc-text hover:border-brand">多人派单入口</Link>
          <button type="button" className="rounded-[10px] border border-[#e6e8ef] bg-white px-4 py-2 text-sm font-bold text-dfc-text hover:border-brand" onClick={() => void loadData().catch(() => setError("刷新失败，当前显示仍是上次结果"))}>刷新</button>
        </div>
      </div>

      <section className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label="等待派出 / 接单" value={String(eligible.length)} hint={`共 ¥${formatMoney(String(waitingAmount))}`} />
        <Stat label="需要处理" value={String(attention.length)} hint={reminded.length ? `${reminded.length} 笔等接单超过 10 分钟` : "没有超时的单"} warn={attention.length > 0} />
        <Stat label="在线陪玩" value={String(onlineCount)} hint={`已上架 ${companions.filter(c => c.status === "LISTED").length} 人`} />
      </section>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
        <section className="admin-panel">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-[10px] border border-[#e6e8ef] bg-[#f8f9fc] p-1">
              <TabButton on={!onlyAttention} onClick={() => setOnlyAttention(false)}>全部等待（{eligible.length}）</TabButton>
              <TabButton on={onlyAttention} onClick={() => setOnlyAttention(true)}>需要处理（{attention.length}）</TabButton>
            </div>
          </div>
          <div className="grid gap-2">
            {pending.map((order) => (
              <button key={order.id} type="button" data-order-id={order.id} aria-pressed={order.id === selectedOrderId} onClick={() => selectOrder(order.id)}
                className={`grid gap-1 rounded-[12px] border p-3 text-left transition ${order.id === selectedOrderId ? "border-brand bg-brand-soft" : "border-[#e6e8ef] bg-white hover:border-[#ffc2ad]"}`}>
                <span className="flex flex-wrap items-center gap-2">
                  <b className="text-dfc-text">{order.customer?.displayName ?? "-"}</b>
                  <span className="text-sm text-dfc-subtext">{gameName(order.game)} · {order.mode}{order.serviceKind !== "GUARANTEE" && Number(order.hours) ? ` · ${Number(order.hours)} 小时` : ""}</span>
                  <span className="ml-auto font-black tabular-nums text-brand-ink">¥{formatMoney(order.totalAmount)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-dfc-muted">
                  <StatusBadge tone={order.status === "PAID" || hasDispatchReminder(order) ? "warning" : "default"}>{orderState(order)}</StatusBadge>
                  {order.companion ? <span>陪玩：{order.companion.displayName}</span> : null}
                  <span>{order.orderNo}</span>
                  {order.sourcePlatform === "KOOK" ? <span>来自 KOOK</span> : null}
                </span>
                {hasDispatchReminder(order) ? <span className="text-xs font-bold text-dfc-warning">等接单已超过 10 分钟，建议联系陪玩或换人</span> : null}
                {dispatchReason(order.statusLogs?.[0]?.reason) ? <span className="text-xs text-dfc-muted">{dispatchReason(order.statusLogs?.[0]?.reason)}</span> : null}
              </button>
            ))}
            {!pending.length ? <p className="py-10 text-center text-sm text-dfc-muted">{onlyAttention ? "没有需要处理的订单" : "没有等待派单的订单"}</p> : null}
          </div>
        </section>

        <aside className="admin-panel xl:sticky xl:top-20">
          {selectedOrder ? (
            <div className="grid gap-4">
              <div>
                <div className="text-xs font-bold text-dfc-muted">当前订单 · {selectedOrder.orderNo}</div>
                <div className="mt-1 text-lg font-black text-dfc-text">{selectedOrder.customer?.displayName ?? "-"} · ¥{formatMoney(selectedOrder.totalAmount)}</div>
                <div className="text-sm text-dfc-subtext">{gameName(selectedOrder.game)} · {selectedOrder.mode}{selectedOrder.serviceKind === "GUARANTEE" ? "" : ` · ${orderRankLabel(selectedOrder)}`}</div>
                {selectedOrder.notes ? <div className="mt-1 text-sm text-dfc-subtext">备注：{selectedOrder.notes}</div> : null}
                {selectedOrder.companion ? <div className="mt-1 text-sm text-dfc-subtext">现在派给：{selectedOrder.companion.displayName}</div> : null}
              </div>

              <div className="inline-flex w-fit rounded-[10px] border border-[#e6e8ef] bg-[#f8f9fc] p-1">
                <TabButton on={dispatchMode === "DIRECT"} onClick={() => setDispatchMode("DIRECT")}>指定陪玩</TabButton>
                <TabButton on={dispatchMode === "OPEN"} onClick={() => { setDispatchMode("OPEN"); setSelectedCompanionId(""); }}>发到派单频道抢单</TabButton>
              </div>

              {dispatchMode === "DIRECT" ? (
                <div>
                  <input value={companionQuery} onChange={(event) => setCompanionQuery(event.target.value)} className="input" placeholder="搜陪玩昵称" />
                  <div className="mt-2 grid max-h-72 gap-2 overflow-y-auto">
                    {listedCompanions.map((companion) => {
                      const unavailable = companion.onlineStatus === "BUSY" || companion.activeServiceCount > 0;
                      return (
                        <button key={companion.userId} type="button" data-companion-id={companion.userId} disabled={unavailable} aria-pressed={companion.userId === selectedCompanionId}
                          onClick={() => setSelectedCompanionId(companion.userId)}
                          className={`flex items-center gap-3 rounded-[12px] border p-2.5 text-left disabled:opacity-50 ${companion.userId === selectedCompanionId ? "border-brand bg-brand-soft" : "border-[#e6e8ef] bg-white hover:border-[#ffc2ad]"}`}>
                          <span className="h-8 w-8 shrink-0 rounded-full bg-gradient-to-br from-[#7c5cff] to-brand" />
                          <span className="min-w-0 flex-1">
                            <b className="block text-sm text-dfc-text">{companion.nickname}</b>
                            <span className="block truncate text-xs text-dfc-muted">{companion.skillModes?.join("、") || "模式待沟通"} · ¥{formatMoney(companion.pricePerHour)}/小时</span>
                          </span>
                          <span className={`text-xs font-bold ${companion.activeServiceCount ? "text-dfc-warning" : companion.onlineStatus === "ONLINE" ? "text-dfc-success" : companion.onlineStatus === "BUSY" ? "text-dfc-warning" : "text-dfc-muted"}`}>
                            {companion.activeServiceCount ? "服务中" : toOnlineStatus(companion.onlineStatus)}
                          </span>
                        </button>
                      );
                    })}
                    {!listedCompanions.length ? <p className="text-sm text-dfc-muted">没有能接这个游戏的已上架陪玩。</p> : null}
                  </div>
                </div>
              ) : (
                <p className="rounded-[12px] bg-[#f8f9fc] p-3 text-sm text-dfc-subtext">KOOK 派单频道会收到这张单，第一个点接单的陪玩接走。</p>
              )}

              <div>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {QUICK_REASONS.map(text => (
                    <button key={text} type="button" onClick={() => setReason(text)}
                      className={`rounded-full border px-3 py-1 text-xs ${reason === text ? "border-brand bg-brand-soft text-brand-ink" : "border-[#e6e8ef] bg-white text-dfc-subtext"}`}>{text}</button>
                  ))}
                </div>
                <input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="记录客户确认或改派依据" />
              </div>

              <details className="rounded-[12px] border border-[#e6e8ef] p-3 text-sm">
                <summary className="cursor-pointer font-bold text-dfc-subtext">接单期限（选填）{deadline ? " · 已设置" : ""}</summary>
                <input className="input mt-2" type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} />
                <p className="mt-2 text-xs text-dfc-muted">到期还没人接会退回待派单。这里不是服务预约时间。</p>
                <button type="button" className="mt-2 text-xs font-bold text-brand-ink" onClick={() => void expireDue()}>立即处理已到期的派单</button>
              </details>

              <button type="button" disabled={!canSubmit} onClick={() => void assign()}
                className="w-full rounded-[12px] bg-brand px-4 py-3 text-base font-black text-white hover:bg-brand-ink disabled:cursor-not-allowed disabled:opacity-40">
                {selectedOrder.status === "ASSIGNED" ? "确认换人" : "确认派单"}
              </button>
            </div>
          ) : (
            <div className="py-16 text-center text-sm text-dfc-muted">在左边点一个订单开始派单</div>
          )}
        </aside>
      </div>
    </AdminShell>
  );
}

function TabButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`rounded-[8px] px-3 py-1.5 text-sm font-bold ${on ? "bg-brand text-white" : "text-dfc-subtext"}`}>{children}</button>;
}

function Stat({ label, value, hint, warn = false }: { label: string; value: string; hint: string; warn?: boolean }) {
  return (
    <div className="admin-metric-card">
      <div className="text-xs font-bold text-dfc-muted">{label}</div>
      <div className={`mt-1 text-3xl font-black tabular-nums ${warn ? "text-dfc-warning" : "text-dfc-text"}`}>{value}</div>
      <div className="mt-1 text-xs text-dfc-muted">{hint}</div>
    </div>
  );
}

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-[#f6c3c4] bg-[#fff1f1] text-dfc-danger" : "border-[#b9ead2] bg-[#effaf4] text-dfc-success";
  return <div className={`mb-4 rounded-[12px] border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

// Free, online companions first; busy or serving ones last.
function availability(companion: Companion) {
  if (companion.activeServiceCount || companion.onlineStatus === "BUSY") return 2;
  return companion.onlineStatus === "ONLINE" ? 0 : 1;
}

function orderState(order: AdminOrder) {
  if (order.status === "PAID") return "待派单";
  return order.assignmentType === "PLATFORM_MATCH" ? "频道抢单中" : "等陪玩接单";
}

function formatMoney(value: string) {
  return Number(value || 0).toFixed(2);
}

function toFriendlyError(message?: string) {
  if (!message) return "派单失败";
  if (message.includes("Only PAID orders can be assigned")) return "只有已支付订单可以派单";
  if (message.includes("Companion is not listed")) return "陪玩未上架或账号不可用";
  if (message.includes("Companion is busy")) return "这位陪玩正在忙";
  if (message.includes("already been assigned") || message.includes("dispatchVersion")) return "订单状态已变化，请刷新后再派";
  return message;
}

function orderRankLabel(order: Pick<AdminOrder, "rankTierNameSnapshot" | "originalUnitPrice" | "unitPrice">) {
  const unitPrice = order.originalUnitPrice || order.unitPrice;
  return `${order.rankTierNameSnapshot || "平台单价"} ¥${formatMoney(unitPrice)}/小时`;
}

function toOnlineStatus(status: string) {
  if (status === "ONLINE") return "在线";
  if (status === "BUSY") return "忙碌";
  if (status === "OFFLINE") return "离线";
  return status;
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

function dispatchReason(raw?: string | null) {
  if (!raw) return "";
  try {
    const detail = JSON.parse(raw.startsWith("CUSTOMER_SELECTED_DISPATCH:") ? raw.slice("CUSTOMER_SELECTED_DISPATCH:".length) : raw);
    const reason = detail.reason === "ACCEPTANCE_DEADLINE_EXPIRED" ? "接单超时，待客服处理" : String(detail.reason || raw).replace("COMPANION_DECLINED: ", "陪玩拒接：");
    if (/^(QUICK_ORDER_|CUSTOMER_CREATE_ORDER|ADMIN_ASSIGN_ORDER)/.test(reason)) return "";
    return `${reason}${detail.customerSelectionRetained ? "；陪玩选择已保留，不自动改派" : ""}`;
  } catch { return /^[A-Z_]+$/.test(raw) ? "" : raw; }
}

function hasDispatchReminder(order: Pick<AdminOrder, "status" | "dispatchVersion" | "dispatchReminder">) {
  return order.status === "ASSIGNED" && order.dispatchReminder?.dispatchVersion === order.dispatchVersion && order.dispatchReminder.due;
}

function needsDispatchAttention(order: Pick<AdminOrder, "status" | "acceptanceDeadline" | "dispatchVersion" | "dispatchReminder">) {
  if (order.status === "PAID" || hasDispatchReminder(order)) return true;
  if (order.status !== "ASSIGNED" || !order.acceptanceDeadline) return false;
  const deadline = Date.parse(order.acceptanceDeadline);
  return !Number.isFinite(deadline) || deadline <= Date.now();
}
