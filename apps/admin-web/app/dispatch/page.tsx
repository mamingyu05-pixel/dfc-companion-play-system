"use client";

import { useEffect, useMemo, useState } from "react";
import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

type AdminOrder = {
  id: string;
  orderNo: string;
  game: string;
  mode: string;
  hours: string;
  totalAmount: string;
  status: string;
  customer?: { email: string; displayName: string };
  companion?: { email: string; displayName: string } | null;
};

type Companion = {
  userId: string;
  nickname: string;
  email: string;
  status: string;
  onlineStatus: string;
  pricePerHour: string;
};

export default function DispatchPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [selectedCompanionId, setSelectedCompanionId] = useState("");
  const [companionQuery, setCompanionQuery] = useState("");
  const [autoStart, setAutoStart] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function loadData() {
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
    setSelectedOrderId(orderData.find((order) => order.status === "PAID")?.id ?? "");
    setSelectedCompanionId(companionData.find((item) => item.status === "LISTED")?.userId ?? "");
  }

  useEffect(() => {
    void loadData().catch(() => setError("无法加载真实派单数据"));
  }, []);

  async function assign() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    if (!selectedOrderId || !selectedCompanionId) {
      setError("请选择订单和陪玩");
      return;
    }

    setError("");
    setStatus("");
    const response = await fetch(`/api/admin/orders/${selectedOrderId}/assign`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ companionId: selectedCompanionId, autoStart })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(toFriendlyError(message));
      return;
    }

    setStatus(autoStart ? "派单成功，订单已直接开始，并已尝试通知 Discord / KOOK。" : "派单成功，系统已尝试通知 Discord / KOOK。");
    await loadData();
  }

  const pending = orders.filter((order) => order.status === "PAID");
  const listedCompanions = companions.filter((companion) => {
    const keyword = companionQuery.trim().toLowerCase();
    const matchesKeyword = !keyword || [companion.nickname, companion.email].some((value) => value.toLowerCase().includes(keyword));
    return companion.status === "LISTED" && matchesKeyword;
  });
  const onlineCount = listedCompanions.filter((companion) => companion.onlineStatus === "ONLINE").length;
  const selectedOrder = pending.find((order) => order.id === selectedOrderId);
  const selectedCompanion = listedCompanions.find((companion) => companion.userId === selectedCompanionId);
  const pendingAmount = useMemo(() => pending.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0), [pending]);

  return (
    <AdminShell>
      <SectionHeader eyebrow="Dispatch Desk" title="派单控制台" desc="将已支付订单分配给已上架陪玩。客户选择平台人工挑人的订单，也会进入这里等待管理员确认。" />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <section className="mb-5 grid gap-4 md:grid-cols-3">
        <Signal label="待派单订单" value={String(pending.length)} hint={`待派金额 ¥${formatMoney(String(pendingAmount))}`} tone="gold" />
        <Signal label="上架陪玩" value={String(listedCompanions.length)} hint={`${onlineCount} 位在线`} tone="cyan" />
        <Signal label="当前模式" value="人工确认" hint="不自动支付、不自动提现" tone="green" />
      </section>

      <section className="admin-panel mb-6">
        <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr_1fr_180px]">
          <label>
            <span className="mb-2 block text-xs font-black text-dfc-muted">选择待派单订单</span>
            <select value={selectedOrderId} onChange={(event) => setSelectedOrderId(event.target.value)} className="input">
              <option value="">选择待派单订单</option>
              {pending.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.orderNo} / {gameName(order.game)} / {order.customer?.displayName ?? "-"} / ¥{formatMoney(order.totalAmount)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-2 block text-xs font-black text-dfc-muted">搜索陪玩</span>
            <input value={companionQuery} onChange={(event) => setCompanionQuery(event.target.value)} className="input" placeholder="陪玩昵称/邮箱" />
          </label>
          <label>
            <span className="mb-2 block text-xs font-black text-dfc-muted">选择陪玩</span>
            <select value={selectedCompanionId} onChange={(event) => setSelectedCompanionId(event.target.value)} className="input">
              <option value="">选择陪玩</option>
              {listedCompanions.map((companion) => (
                <option key={companion.userId} value={companion.userId}>
                  {companion.nickname} / {toOnlineStatus(companion.onlineStatus)} / ¥{formatMoney(companion.pricePerHour)}/h
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button type="button" onClick={() => void assign()} className="w-full rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-200">
              确认派单
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Preview title="当前订单" lines={selectedOrder ? [selectedOrder.orderNo, `${gameName(selectedOrder.game)} / ${selectedOrder.mode}`, `客户：${selectedOrder.customer?.displayName ?? "-"}`, `金额：¥${formatMoney(selectedOrder.totalAmount)}`] : ["未选择订单"]} />
          <Preview title="当前陪玩" lines={selectedCompanion ? [selectedCompanion.nickname, `状态：${toOnlineStatus(selectedCompanion.onlineStatus)}`, `价格：¥${formatMoney(selectedCompanion.pricePerHour)}/h`, selectedCompanion.email] : ["未选择陪玩"]} />
        </div>
        <label className="mt-4 flex items-start gap-3 rounded-dfc-control border border-cyan-300/15 bg-[#07111f]/70 p-3 text-sm text-dfc-subtext">
          <input type="checkbox" checked={autoStart} onChange={(event) => setAutoStart(event.target.checked)} className="mt-1 accent-cyan-300" />
          <span>
            <span className="block font-black text-white">派单后直接开始</span>
            <span className="mt-1 block text-xs leading-5">用于人工客服已经确认好时间、陪玩和老板的场景。关闭后订单会停留在已派单，等待陪玩接单。</span>
          </span>
        </label>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_1.2fr]">
        <Panel title="已支付待派单" hint="只显示 PAID 状态订单">
          <DataTable
            columns={["订单", "游戏", "客户", "金额", "状态"]}
            rows={pending.map((order) => [
              <span key={`${order.id}-no`} className="font-black text-white">{order.orderNo}</span>,
              gameName(order.game),
              order.customer?.displayName ?? "-",
              <span key={`${order.id}-amount`} className="font-black tabular-nums text-dfc-gold">¥{formatMoney(order.totalAmount)}</span>,
              <StatusBadge key={order.id} tone="warning">待派单</StatusBadge>
            ])}
          />
        </Panel>

        <Panel title="已上架陪玩" hint="优先选择在线且资料完整的陪玩">
          <DataTable
            columns={["昵称", "在线", "价格", "邮箱", "操作"]}
            rows={listedCompanions.map((companion) => [
              <span key={`${companion.userId}-name`} className="font-semibold text-white">{companion.nickname}</span>,
              <StatusBadge key={`${companion.userId}-online`} tone={companion.onlineStatus === "ONLINE" ? "success" : "default"}>{toOnlineStatus(companion.onlineStatus)}</StatusBadge>,
              <span key={`${companion.userId}-price`} className="font-black tabular-nums text-dfc-gold">¥{formatMoney(companion.pricePerHour)}/h</span>,
              companion.email,
              <ActionButton key={companion.userId} onClick={() => setSelectedCompanionId(companion.userId)}>选择</ActionButton>
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
    PUBG: "PUBG",
    PUBG_MOBILE: "PUBG Mobile",
    APEX_LEGENDS: "Apex 英雄",
    NARAKA_BLADEPOINT: "永劫无间",
    HONOR_OF_KINGS: "王者荣耀",
    PEACEKEEPER_ELITE: "和平精英",
    DOTA_2: "Dota 2",
    OVERWATCH_2: "守望先锋 2",
    RAINBOW_SIX_SIEGE: "彩虹六号",
    ROCKET_LEAGUE: "火箭联盟",
    EA_SPORTS_FC: "EA Sports FC",
    STREET_FIGHTER_6: "街头霸王 6",
    CALL_OF_DUTY: "使命召唤",
    WILD_RIFT: "英雄联盟手游",
    MOBILE_LEGENDS: "Mobile Legends",
    MINECRAFT: "我的世界",
    GENSHIN_IMPACT: "原神"
  };
  return names[code] ?? code;
}
