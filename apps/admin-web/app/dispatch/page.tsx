"use client";

import { useEffect, useState } from "react";
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
      body: JSON.stringify({ companionId: selectedCompanionId })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(toFriendlyError(message));
      return;
    }

    setStatus("派单成功，系统已尝试通知 Discord/KOOK。");
    await loadData();
  }

  const pending = orders.filter((order) => order.status === "PAID");
  const listedCompanions = companions.filter((companion) => companion.status === "LISTED");

  return (
    <AdminShell>
      <SectionHeader title="派单" desc="将已支付订单分配给已上架陪玩。客户选择平台人工挑人的订单也会进入这里。" />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <section className="mb-6 rounded-dfc border border-dfc-border bg-dfc-surface p-4">
        <h2 className="text-base font-semibold">执行派单</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <select value={selectedOrderId} onChange={(event) => setSelectedOrderId(event.target.value)} className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus">
            <option value="">选择待派单订单</option>
            {pending.map((order) => (
              <option key={order.id} value={order.id}>
                {order.orderNo} / {gameName(order.game)} / {order.customer?.displayName ?? "-"} / ¥{formatMoney(order.totalAmount)}
              </option>
            ))}
          </select>
          <select value={selectedCompanionId} onChange={(event) => setSelectedCompanionId(event.target.value)} className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus">
            <option value="">选择陪玩</option>
            {listedCompanions.map((companion) => (
              <option key={companion.userId} value={companion.userId}>
                {companion.nickname} / {companion.onlineStatus} / ¥{formatMoney(companion.pricePerHour)}/h
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void assign()} className="rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950">
            确认派单
          </button>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_1.2fr]">
        <div>
          <h2 className="mb-3 text-base font-semibold">已支付待派单</h2>
          <DataTable
            columns={["订单", "游戏", "客户", "金额", "状态"]}
            rows={pending.map((order) => [
              order.orderNo,
              gameName(order.game),
              order.customer?.displayName ?? "-",
              `¥${formatMoney(order.totalAmount)}`,
              <StatusBadge key={order.id} tone="warning">{order.status}</StatusBadge>
            ])}
          />
        </div>
        <div>
          <h2 className="mb-3 text-base font-semibold">已上架陪玩</h2>
          <DataTable
            columns={["昵称", "在线", "价格", "邮箱", "操作"]}
            rows={listedCompanions.map((companion) => [
              companion.nickname,
              companion.onlineStatus,
              `¥${formatMoney(companion.pricePerHour)}/h`,
              companion.email,
              <ActionButton key={companion.userId} onClick={() => setSelectedCompanionId(companion.userId)}>选择</ActionButton>
            ])}
          />
        </div>
      </section>
    </AdminShell>
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
