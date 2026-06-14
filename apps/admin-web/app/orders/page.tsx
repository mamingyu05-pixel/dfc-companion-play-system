"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

type AdminOrder = {
  id: string;
  orderNo: string;
  game: string;
  mode: string;
  hours: string;
  unitPrice: string;
  totalAmount: string;
  status: string;
  voiceTrialRequested: boolean;
  customer?: { email: string; displayName: string };
  companion?: { email: string; displayName: string } | null;
  createdAt: string;
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadOrders() {
      const token = localStorage.getItem("dfc_admin_token");
      if (!token) return;
      const response = await fetch("/api/admin/orders", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error("无法加载订单");
      setOrders((await response.json()) as AdminOrder[]);
    }

    void loadOrders().catch(() => setError("无法加载真实订单数据"));
  }, []);

  const stats = useMemo(() => {
    const paid = orders.filter((order) => order.status === "PAID").length;
    const active = orders.filter((order) => ["ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(order.status)).length;
    const completed = orders.filter((order) => order.status === "COMPLETED").length;
    const amount = orders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
    return { paid, active, completed, amount };
  }, [orders]);

  return (
    <AdminShell>
      <SectionHeader eyebrow="Order Control" title="订单管理" desc="查看数据库真实订单。已支付订单进入派单页分配陪玩，进行中订单重点关注服务状态和投诉风险。" />

      <section className="mb-5 grid gap-4 md:grid-cols-4">
        <Signal label="待派单" value={String(stats.paid)} hint="PAID 订单" tone="gold" />
        <Signal label="服务中" value={String(stats.active)} hint="已派单 / 已接单 / 进行中" tone="cyan" />
        <Signal label="已完成" value={String(stats.completed)} hint="完成后进入结算" tone="green" />
        <Signal label="订单金额" value={`¥${formatMoney(String(stats.amount))}`} hint="当前列表合计" tone="cyan" />
      </section>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <DataTable
        columns={["订单号", "客户", "陪玩", "游戏", "模式", "时长", "金额", "试音", "状态", "创建时间"]}
        rows={orders.map((order) => [
          <span key={`${order.id}-no`} className="font-black text-white">{order.orderNo}</span>,
          order.customer ? <Person key={`${order.id}-customer`} name={order.customer.displayName} email={order.customer.email} /> : "-",
          order.companion ? <Person key={`${order.id}-companion`} name={order.companion.displayName} email={order.companion.email} /> : <span className="text-dfc-gold">平台待匹配</span>,
          gameName(order.game),
          order.mode,
          `${formatMoney(order.hours)}h`,
          <span key={`${order.id}-amount`} className="font-black tabular-nums text-dfc-gold">¥{formatMoney(order.totalAmount)}</span>,
          order.voiceTrialRequested ? <StatusBadge key={`${order.id}-voice`} tone="warning">需要</StatusBadge> : <span className="text-dfc-muted">不需要</span>,
          <StatusBadge key={`${order.id}-status`} tone={statusTone(order.status)}>{toOrderStatus(order.status)}</StatusBadge>,
          formatDateTime(order.createdAt)
        ])}
      />
    </AdminShell>
  );
}

function Person({ name, email }: { name: string; email: string }) {
  return (
    <div>
      <div className="font-semibold text-white">{name}</div>
      <div className="mt-1 text-xs text-dfc-muted">{email}</div>
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
      <div className="mt-2 text-2xl font-black tabular-nums">{value}</div>
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

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
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

function toOrderStatus(status: string) {
  const map: Record<string, string> = {
    PENDING_PAYMENT: "待支付",
    PAID: "待派单",
    ASSIGNED: "已派单",
    ACCEPTED: "已接单",
    IN_PROGRESS: "进行中",
    COMPLETED: "已完成",
    CANCELLED: "已取消",
    REFUNDED: "已退款",
    DISPUTED: "争议中"
  };
  return map[status] ?? status;
}

function statusTone(status: string): "default" | "warning" | "danger" | "success" {
  if (status === "COMPLETED") return "success";
  if (status === "CANCELLED" || status === "REFUNDED" || status === "DISPUTED") return "danger";
  if (status === "PAID" || status === "ASSIGNED" || status === "ACCEPTED" || status === "IN_PROGRESS") return "warning";
  return "default";
}
