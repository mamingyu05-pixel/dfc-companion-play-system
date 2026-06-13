"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { AdminShell, DataTable, MetricCard, SectionHeader, StatusBadge } from "../components";

type DashboardMetric = {
  label: string;
  value: string;
  hint: string;
};

type DashboardOrder = {
  id: string;
  orderNo: string;
  customer: string;
  companion: string;
  status: string;
  amount: string;
};

type DashboardReview = {
  type: string;
  id: string;
  subject: string;
  amount: string;
  status: string;
};

type DashboardLog = {
  id: string;
  actor: string;
  action: string;
  target: string;
  createdAt: string;
};

type DashboardData = {
  metrics: DashboardMetric[];
  pendingOrders: DashboardOrder[];
  pendingReviews: DashboardReview[];
  recentLogs: DashboardLog[];
};

const emptyDashboard: DashboardData = {
  metrics: [
    { label: "今日订单", value: "0", hint: "0 个待派单" },
    { label: "待充值审核", value: "0", hint: "需要核对截图" },
    { label: "待提现审核", value: "0", hint: "待审核或待打款" },
    { label: "投诉处理中", value: "0", hint: "需要管理员介入" }
  ],
  pendingOrders: [],
  pendingReviews: [],
  recentLogs: []
};

export default function AdminDashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadDashboard() {
      const token = localStorage.getItem("dfc_admin_token");
      if (!token) return;

      const response = await fetch("/api/admin/dashboard", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error("无法加载真实看板数据");
      setDashboard((await response.json()) as DashboardData);
    }

    void loadDashboard().catch(() => setError("无法加载真实看板数据，请检查登录状态或 API 服务"));
  }, []);

  return (
    <AdminShell>
      <SectionHeader title="数据看板" desc="真实统计当前订单、充值审核、提现审核和投诉。" />
      {error ? <div className="mb-4 rounded-dfc border border-dfc-danger bg-dfc-danger/10 p-3 text-sm text-dfc-danger">{error}</div> : null}
      <section className="grid gap-4 md:grid-cols-4">
        {dashboard.metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
      </section>
      <section className="mt-8 grid gap-5 xl:grid-cols-2">
        <Panel title="待处理订单">
          <DataTable
            columns={["订单", "客户", "陪玩", "状态", "金额"]}
            rows={dashboard.pendingOrders.map((order) => [
              order.orderNo,
              order.customer,
              order.companion,
              <StatusBadge key={order.id} tone="warning">{formatStatus(order.status)}</StatusBadge>,
              formatCurrency(order.amount)
            ])}
          />
        </Panel>
        <Panel title="待审核事项">
          <DataTable
            columns={["类型", "编号", "对象", "金额", "状态"]}
            rows={dashboard.pendingReviews.map((item) => [
              item.type,
              shortId(item.id),
              item.subject,
              formatCurrency(item.amount),
              <StatusBadge key={`${item.type}-${item.id}`} tone="warning">{formatStatus(item.status)}</StatusBadge>
            ])}
          />
        </Panel>
        <Panel title="最近操作日志">
          <DataTable
            columns={["操作人", "动作", "对象", "时间"]}
            rows={dashboard.recentLogs.map((log) => [log.actor, formatAction(log.action), log.target || "-", formatDateTime(log.createdAt)])}
          />
        </Panel>
      </section>
    </AdminShell>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function formatCurrency(value: string) {
  return `¥${Number(value || 0).toFixed(2)}`;
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}...` : id;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatStatus(status: string) {
  const map: Record<string, string> = {
    PAID: "待派单",
    ASSIGNED: "已派单",
    ACCEPTED: "已接单",
    IN_PROGRESS: "进行中",
    PENDING: "待审核",
    APPROVED: "已审核",
    OPEN: "新投诉",
    IN_REVIEW: "处理中"
  };
  return map[status] ?? status;
}

function formatAction(action: string) {
  const map: Record<string, string> = {
    APPROVED_RECHARGE: "审核充值",
    REJECTED_RECHARGE: "拒绝充值",
    ADMIN_CREDIT_BALANCE: "人工加余额",
    ADMIN_DEBIT_BALANCE: "人工扣余额",
    ASSIGN_ORDER: "派单",
    CREATE_COMPANION: "创建陪玩",
    REVIEW_COMPLAINT: "处理投诉",
    CREATE_ADMIN: "创建管理员"
  };
  return map[action] ?? action;
}
