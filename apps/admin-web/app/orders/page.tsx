"use client";

import { useEffect, useState } from "react";
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

  return (
    <AdminShell>
      <SectionHeader title="订单管理" desc="读取数据库真实订单。已支付订单请到派单页面分配陪玩。" />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <DataTable
        columns={["订单号", "客户", "陪玩", "游戏", "模式", "时长", "金额", "试音", "状态", "创建时间"]}
        rows={orders.map((order) => [
          order.orderNo,
          order.customer ? `${order.customer.displayName} (${order.customer.email})` : "-",
          order.companion ? `${order.companion.displayName} (${order.companion.email})` : "平台待匹配",
          gameName(order.game),
          order.mode,
          order.hours,
          `¥${formatMoney(order.totalAmount)}`,
          order.voiceTrialRequested ? "需要" : "不需要",
          <StatusBadge key={`${order.id}-status`} tone={statusTone(order.status)}>{order.status}</StatusBadge>,
          new Date(order.createdAt).toLocaleString()
        ])}
      />
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

function statusTone(status: string): "default" | "warning" | "danger" | "success" {
  if (status === "COMPLETED") return "success";
  if (status === "CANCELLED" || status === "REFUNDED" || status === "DISPUTED") return "danger";
  if (status === "PAID" || status === "ASSIGNED" || status === "ACCEPTED" || status === "IN_PROGRESS") return "warning";
  return "default";
}
