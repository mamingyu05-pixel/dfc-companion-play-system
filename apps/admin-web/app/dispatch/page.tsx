"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

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

export default function DispatchPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [showWaiting, setShowWaiting] = useState(true);
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [selectedCompanionId, setSelectedCompanionId] = useState("");
  const [companionQuery, setCompanionQuery] = useState("");
  const [dispatchMode, setDispatchMode] = useState<"DIRECT" | "OPEN">("DIRECT");
  const [reason, setReason] = useState("");
  const [deadline, setDeadline] = useState("");
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
    void loadData(new URLSearchParams(window.location.search).get("orderId") ?? undefined).catch(() => setError("无法加载真实派单数据"));
  }, []);

  async function assign() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    if (!selectedOrderId || (dispatchMode === "DIRECT" && !selectedCompanionId) || !reason.trim()) {
      setError("请选择订单、分配方式并填写原因；指定派单需要选择陪玩");
      return;
    }

    setError("");
    setStatus("");
    const response = await fetch(`/api/admin/orders/${selectedOrderId}/dispatch`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ dispatchVersion: orders.find(order => order.id === selectedOrderId)?.dispatchVersion, mode: dispatchMode, companionId: dispatchMode === "DIRECT" ? selectedCompanionId : undefined, reason: reason.trim(), acceptanceDeadline: deadline ? new Date(deadline).toISOString() : null })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(toFriendlyError(message));
      return;
    }

    setStatus("分配已保存，等待符合资格的陪玩本人接单。通知异常可在通知核对台处理。");
    await loadData();
  }

  async function expireDue() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    const response = await fetch("/api/admin/orders/expire-assignments", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) { setError("超时处置失败，请重试"); return; }
    const result = await response.json();
    setStatus(`已将 ${result.expired} 笔超时订单退回客服待办。`);
    await loadData();
  }

  const eligible = orders.filter((order) => ["PAID", "ASSIGNED"].includes(order.status));
  const pending = eligible.filter(order => showWaiting || needsDispatchAttention(order));
  const reminded = eligible.filter(order => hasDispatchReminder(order));
  const selectedOrder = pending.find((order) => order.id === selectedOrderId);
  const listedCompanions = companions.filter((companion) => {
    const keyword = companionQuery.trim().toLowerCase();
    const matchesKeyword = !keyword || [companion.nickname, companion.email].some((value) => value.toLowerCase().includes(keyword));
    return companion.status === "LISTED" && companion.userStatus === "ACTIVE" && matchesKeyword &&
      (!selectedOrder || companion.game === selectedOrder.game || companion.games?.includes(selectedOrder.game));
  }).sort((a, b) => Number(b.onlineStatus === "ONLINE" && !b.activeServiceCount) - Number(a.onlineStatus === "ONLINE" && !a.activeServiceCount));
  const onlineCount = listedCompanions.filter((companion) => companion.onlineStatus === "ONLINE").length;
  const selectedCompanion = listedCompanions.find((companion) => companion.userId === selectedCompanionId && companion.onlineStatus !== "BUSY" && !companion.activeServiceCount);
  const pendingAmount = useMemo(() => pending.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0), [pending]);

  return (
    <AdminShell>
      <SectionHeader eyebrow="Dispatch Desk" title="单人订单派单" desc="同一已支付订单可指定陪玩或开放抢单。仅在本人接单前可改派；拒接或接单期限到期回待办，由客服决定下一步。" />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <section className="mb-5 grid gap-4 md:grid-cols-3">
        <Signal label="待派单订单" value={String(pending.length)} hint={`待派金额 ¥${formatMoney(String(pendingAmount))}`} tone="gold" />
        <Signal label="上架陪玩" value={String(listedCompanions.length)} hint={`${onlineCount} 位在线`} tone="cyan" />
        <Signal label="当前模式" value="人工确认" hint="不自动支付、不自动提现" tone="green" />
      </section>

      <section className="admin-panel mb-6">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <h2 className="text-base font-black text-white">多人陪玩订单组</h2>
            <p className="mt-1 text-xs leading-5 text-dfc-muted">
              多人单需要在扣款前确定人数、陪玩和折扣。请从群消息建草稿，在草稿台勾选多个陪玩后，统一转正式订单。
            </p>
          </div>
          <Link href="/order-drafts" className="rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-4 py-3 text-center text-sm font-black text-slate-950 transition hover:bg-cyan-200">
            多人派单入口
          </Link>
        </div>
      </section>

      <section className="admin-panel mb-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-base font-black text-white">等待接单已满 10 分钟：{reminded.length} 笔</h2>
            <p className="mt-1 text-xs text-dfc-muted">本次刷新结果（最近 100 笔订单）。从当前轮派单开始计时；仅提醒联系核对，不撤回派单或改变资金。请刷新确认最新状态。</p></div>
          <ActionButton onClick={() => void loadData().catch(() => setError("刷新失败，当前显示仍是上次结果"))}>刷新待办</ActionButton>
        </div>
        <label className="mb-4 flex items-center gap-2 text-sm text-dfc-subtext">
          <input type="checkbox" checked={showWaiting} onChange={event => { setShowWaiting(event.target.checked); setSelectedOrderId(""); }} />
          显示正常等待接单的订单（可直接换人，无需等满10分钟）
        </label>
        <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr_1fr_180px]">
          <label>
            <span className="mb-2 block text-xs font-black text-dfc-muted">1 · 选择订单</span>
            <select value={selectedOrderId} onChange={(event) => { setSelectedOrderId(event.target.value); setSelectedCompanionId(""); setDispatchMode("DIRECT"); }} className="input">
              <option value="">选择待派单订单</option>
              {pending.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.orderNo} / {gameName(order.game)} / {order.customer?.displayName ?? "-"} / {orderRankLabel(order)} / ¥{formatMoney(order.totalAmount)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-2 block text-xs font-black text-dfc-muted">搜索陪玩</span>
            <input value={companionQuery} onChange={(event) => setCompanionQuery(event.target.value)} className="input" placeholder="陪玩昵称/邮箱" />
          </label>
          <label>
            <span className="mb-2 block text-xs font-black text-dfc-muted">2 · 选择陪玩</span>
            <select value={selectedCompanionId} onChange={(event) => setSelectedCompanionId(event.target.value)} className="input">
              <option value="">选择陪玩</option>
              {listedCompanions.map((companion) => (
                <option key={companion.userId} value={companion.userId} disabled={companion.onlineStatus === "BUSY" || companion.activeServiceCount > 0}>
                  {companion.nickname} / {companion.activeServiceCount ? "服务中" : toOnlineStatus(companion.onlineStatus)} / {companion.skillModes?.join("、") || "模式待沟通"}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button type="button" disabled={!selectedOrder || (dispatchMode === "DIRECT" && !selectedCompanion) || !reason.trim()} onClick={() => void assign()} className="w-full rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-200">
              {selectedOrder?.status === "ASSIGNED" ? "确认换人" : "确认派单"}
            </button>
          </div>
        </div>

        <label className="mt-4 block"><span className="mb-2 block text-xs text-dfc-muted">3 · 填写派单依据，再确认派单（必填，留在客服审计）</span>
          <input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="记录客户确认或改派依据" />
        </label>
        <p className="mt-2 text-xs text-dfc-muted">常规派单只需选订单、选陪玩、填写依据。保存后仍须陪玩本人接单；需要开放抢单或设置期限时再展开下方选项。</p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Preview title="当前订单" lines={selectedOrder ? [selectedOrder.orderNo, `${gameName(selectedOrder.game)} / ${selectedOrder.mode}`, orderRankLabel(selectedOrder), `客户：${selectedOrder.customer?.displayName ?? "-"}`, `保留的陪玩选择：${selectedOrder.companion?.displayName ?? "未指定"}`, `金额：¥${formatMoney(selectedOrder.totalAmount)}`] : ["未选择订单"]} />
          <Preview title="当前陪玩" lines={selectedCompanion ? [selectedCompanion.nickname, `状态：${toOnlineStatus(selectedCompanion.onlineStatus)}`, selectedCompanion.email] : ["未选择陪玩"]} />
        </div>
        <details className="mt-4 rounded-dfc-control border border-cyan-300/20 p-3">
          <summary className="cursor-pointer text-sm font-bold text-cyan-100">更多派单选项：{dispatchMode === "OPEN" ? "开放抢单" : "客服指定"}{deadline ? " · 已设置接单期限" : ""}</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label><span className="mb-2 block text-xs text-dfc-muted">分配方式</span>
            <select className="input" value={dispatchMode} onChange={e => setDispatchMode(e.target.value as "DIRECT" | "OPEN")}>
              <option value="DIRECT">客服指定，等待本人接受</option><option value="OPEN">无合适人选时，手动启用备用抢单</option>
            </select>
          </label>
          <label><span className="mb-2 block text-xs text-dfc-muted">接单截止（可选，按本机时区）</span>
            <input className="input" type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} />
          </label>
        </div>
        <p className="mt-3 text-xs text-dfc-muted">留空不设置接单期限；此处不表示服务预约时间。接单后由陪玩开始服务才计时。</p>
        <button className="mt-3 text-sm text-cyan-200" onClick={() => void expireDue()}>处理已到期派单并刷新待办</button>
        </details>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_1.2fr]">
        <Panel title="客服派单待办" hint="默认展示待分配和待接订单；陪玩未回应时可直接选择另一位改派。">
          <DataTable
            columns={["订单", "游戏", "客户", "金额", "状态 / 最近处置"]}
            rows={pending.map((order) => [
              <span key={`${order.id}-no`} className="font-black text-white">{order.orderNo}</span>,
              gameName(order.game),
              order.customer?.displayName ?? "-",
              <span key={`${order.id}-amount`} className="font-black tabular-nums text-dfc-gold">¥{formatMoney(order.totalAmount)}</span>,
              <div key={order.id}><StatusBadge tone="warning">{order.status === "PAID" ? "客服待办" : order.assignmentType === "PLATFORM_MATCH" ? "开放待抢" : "指定待接"}</StatusBadge><p className="mt-1 text-xs text-dfc-muted">{order.acceptanceDeadline ? new Date(order.acceptanceDeadline).toLocaleString() : "未设置接单期限"}</p><p className="mt-1 max-w-xs break-words text-xs text-dfc-muted">{dispatchReason(order.statusLogs?.[0]?.reason)}</p>{hasDispatchReminder(order) ? <p className="mt-1 text-xs font-bold text-dfc-gold">当前轮等待接单已满 10 分钟，请联系核对</p> : order.status === "ASSIGNED" && !order.dispatchReminder?.assignedAt ? <p className="mt-1 text-xs text-dfc-muted">当前轮派单时间待核，请刷新或人工核对</p> : null}</div>
            ])}
          />
        </Panel>

        <Panel title="已上架陪玩" hint="优先选择在线且资料完整的陪玩">
          <DataTable
            columns={["昵称", "在线", "邮箱", "操作"]}
            rows={listedCompanions.map((companion) => [
              <span key={`${companion.userId}-name`} className="font-semibold text-white">{companion.nickname}</span>,
              <StatusBadge key={`${companion.userId}-online`} tone={companion.onlineStatus === "ONLINE" ? "success" : "default"}>{toOnlineStatus(companion.onlineStatus)}</StatusBadge>,
              companion.email,
              <ActionButton key={companion.userId} disabled={companion.onlineStatus === "BUSY" || companion.activeServiceCount > 0} onClick={() => setSelectedCompanionId(companion.userId)}>{companion.activeServiceCount ? "服务中" : "选择"}</ActionButton>
            ])}
          />
        </Panel>
      </section>
    </AdminShell>
  );
}

function Panel({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="admin-panel">
      <div className="admin-panel-header">
        <div>
          <h2 className="text-base font-black text-white">{title}</h2>
          <p className="mt-1 text-xs text-dfc-muted">{hint}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Preview({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="admin-queue-item">
      <div className="text-xs font-black text-dfc-muted">{title}</div>
      <div className="mt-2 space-y-1">
        {lines.map((line) => (
          <div key={line} className="text-sm text-dfc-subtext">{line}</div>
        ))}
      </div>
    </div>
  );
}

function Signal({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: "cyan" | "gold" | "green" }) {
  const styles = {
    cyan: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
    gold: "border-dfc-gold/30 bg-dfc-gold/10 text-dfc-gold",
    green: "border-dfc-success/30 bg-dfc-success/10 text-dfc-success"
  };
  return (
    <div className={`rounded-dfc border p-4 ${styles[tone]}`}>
      <div className="text-xs font-black">{label}</div>
      <div className="mt-2 text-3xl font-black tabular-nums">{value}</div>
      <div className="mt-1 text-xs opacity-80">{hint}</div>
    </div>
  );
}

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success";
  return <div className={`mb-4 rounded-dfc-control border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

function formatMoney(value: string) {
  return Number(value || 0).toFixed(2);
}

function toFriendlyError(message?: string) {
  if (!message) return "派单失败";
  if (message.includes("Only PAID orders can be assigned")) return "只有已支付订单可以派单";
  if (message.includes("Companion is not listed")) return "陪玩未上架或账号不可用";
  if (message.includes("already been assigned")) return "订单已被派单或状态已变化";
  return message;
}

function orderRankLabel(order: Pick<AdminOrder, "rankTierNameSnapshot" | "originalUnitPrice" | "unitPrice">) {
  const unitPrice = order.originalUnitPrice || order.unitPrice;
  return `${order.rankTierNameSnapshot || "平台单价"} ¥${formatMoney(unitPrice)}/h`;
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
    return `${reason}${detail.customerSelectionRetained ? "；陪玩选择已保留，不自动改派" : ""}`;
  } catch { return raw; }
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
