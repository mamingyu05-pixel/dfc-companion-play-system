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
    { label: "待充值审核", value: "0", hint: "需要核对客户截图" },
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

  const pendingReviewCount = dashboard.pendingReviews.length;
  const pendingOrderCount = dashboard.pendingOrders.length;
  const latestLog = dashboard.recentLogs[0];

  return (
    <AdminShell>
      <section className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="admin-panel overflow-hidden">
          <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
            <div>
              <SectionHeader
                eyebrow="Maycat Command Center"
                title="运营看板"
                desc="集中处理订单派发、充值审核、提现审核和投诉风险。优先看待办，再看日志，所有资金动作都必须留下后台记录。"
              />
              {error ? <div className="rounded-dfc border border-dfc-danger/40 bg-dfc-danger/10 p-3 text-sm text-dfc-danger">{error}</div> : null}
            </div>
            <div className="grid gap-3">
              <QueueSignal label="待处理订单" value={pendingOrderCount} tone="cyan" />
              <QueueSignal label="待审核事项" value={pendingReviewCount} tone="gold" />
            </div>
          </div>
        </div>

        <aside className="admin-panel">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-200">Live Ops</div>
          <h2 className="mt-2 text-lg font-black text-white">当前班次重点</h2>
          <div className="mt-4 space-y-3">
            <OpsNote title="充值先核图" desc="人工转账到账后再通过，避免余额提前入账。" />
            <OpsNote title="派单先看在线" desc="优先分配在线、已绑定 KOOK / Discord 的陪玩。" />
            <OpsNote title="投诉先留证据" desc="退款、补偿和处罚需要管理员记录原因。" />
          </div>
        </aside>
      </section>

      <section className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {dashboard.metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </section>

      <section className="mt-6 grid gap-5 xl:grid-cols-2">
        <Panel title="待处理订单" hint="已支付、待派单、服务中订单优先处理">
          <DataTable
            columns={["订单", "客户", "陪玩", "状态", "金额"]}
            rows={dashboard.pendingOrders.map((order) => [
              <span key={`${order.id}-no`} className="font-black text-white">{order.orderNo}</span>,
              order.customer,
              order.companion || "平台匹配",
              <StatusBadge key={order.id} tone="warning">{formatStatus(order.status)}</StatusBadge>,
              <span key={`${order.id}-amount`} className="font-black tabular-nums text-dfc-gold">{formatCurrency(order.amount)}</span>
            ])}
          />
        </Panel>

        <Panel title="待审核事项" hint="充值、提现、投诉等资金和风控事项">
          <DataTable
            columns={["类型", "编号", "对象", "金额", "状态"]}
            rows={dashboard.pendingReviews.map((item) => [
              formatReviewType(item.type),
              shortId(item.id),
              item.subject,
              <span key={`${item.type}-${item.id}-amount`} className="font-black tabular-nums text-dfc-gold">{formatCurrency(item.amount)}</span>,
              <StatusBadge key={`${item.type}-${item.id}`} tone="warning">{formatStatus(item.status)}</StatusBadge>
            ])}
          />
        </Panel>

        <Panel title="最近操作日志" hint={latestLog ? `最新：${formatDateTime(latestLog.createdAt)}` : "暂无管理员动作"} wide>
          <DataTable
            columns={["操作人", "动作", "对象", "时间"]}
            rows={dashboard.recentLogs.map((log) => [
              <span key={`${log.id}-actor`} className="font-semibold text-white">{log.actor}</span>,
              formatAction(log.action),
              log.target || "-",
              formatDateTime(log.createdAt)
            ])}
          />
        </Panel>
      </section>
    </AdminShell>
  );
}

function Panel({ title, hint, wide, children }: { title: string; hint: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`admin-panel ${wide ? "xl:col-span-2" : ""}`}>
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

function QueueSignal({ label, value, tone }: { label: string; value: number; tone: "cyan" | "gold" }) {
  const toneClass = tone === "gold" ? "border-dfc-gold/35 bg-dfc-gold/10 text-dfc-gold" : "border-cyan-300/35 bg-cyan-300/10 text-cyan-100";
  return (
    <div className={`rounded-dfc border px-4 py-3 ${toneClass}`}>
      <div className="text-xs font-black">{label}</div>
      <div className="mt-1 text-2xl font-black tabular-nums">{value}</div>
    </div>
  );
}

function OpsNote({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="admin-queue-item">
      <div className="text-sm font-black text-white">{title}</div>
      <div className="mt-1 text-xs leading-5 text-dfc-subtext">{desc}</div>
    </div>
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

function formatReviewType(type: string) {
  const map: Record<string, string> = {
    RECHARGE: "充值",
    WITHDRAWAL: "提现",
    COMPLAINT: "投诉",
    ORDER: "订单"
  };
  return map[type] ?? type;
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
