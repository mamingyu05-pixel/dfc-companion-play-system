"use client";

import Link from "next/link";
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
  acceptanceDeadline?: string | null;
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

// Metric labels come from GET /api/admin/dashboard; each card opens the queue that clears it.
const metricHref: Record<string, string> = {
  今日订单: "/dispatch",
  待充值审核: "/recharges",
  待提现审核: "/withdrawals",
  未结投诉: "/complaints"
};

const emptyDashboard: DashboardData = {
  metrics: [
    { label: "今日订单", value: "0", hint: "0 个待派单" },
    { label: "待充值审核", value: "0", hint: "需要核对客户截图" },
    { label: "待提现审核", value: "0", hint: "待审核或待打款" },
    { label: "未结投诉", value: "0", hint: "含新投诉与处理中" }
  ],
  pendingOrders: [],
  pendingReviews: [],
  recentLogs: []
};

export default function AdminDashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard);
  const [error, setError] = useState("");
  const [attention, setAttention] = useState<DashboardOrder[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function loadDashboard() {
      const token = localStorage.getItem("dfc_admin_token");
      if (!token) return;

      const headers = { Authorization: `Bearer ${token}` };
      const [response, ordersResponse] = await Promise.all([
        fetch("/api/admin/dashboard", { headers, cache: "no-store" }),
        fetch("/api/admin/orders", { headers, cache: "no-store" })
      ]);
      if (!response.ok || !ordersResponse.ok) throw new Error("无法加载真实看板数据");
      const [next, orders] = await Promise.all([response.json(), ordersResponse.json()]);
      if (!Array.isArray(orders)) throw new Error("订单列表返回异常");
      setDashboard(next as DashboardData);
      setAttention(orders.filter(needsAttention).map(order => ({ ...order,
        customer: order.customer?.displayName || order.customer?.email || "-",
        companion: order.companion?.displayName || "待分配", amount: order.totalAmount })));
      setLoaded(true);
    }

    void loadDashboard().catch(() => setError("无法加载真实看板数据，请检查登录状态或 API 服务"));
  }, []);

  const pendingReviewCount = dashboard.pendingReviews.length;
  const pendingOrderCount = attention.length;
  const latestLog = dashboard.recentLogs[0];

  return (
    <AdminShell>
      <section className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="admin-panel overflow-hidden">
          <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
            <div>
              <SectionHeader
                eyebrow="Maycat Command Center"
                title="异常与审核待办"
                desc="先处理待分配、接单超时、投诉和人工资金审核。正常接单与服务无需重复操作；资金确认和处理原因继续保留。"
              />
              {error ? <div className="rounded-dfc border border-dfc-danger/40 bg-dfc-danger/10 p-3 text-sm text-dfc-danger">{error}</div> : null}
            </div>
            <div className="grid gap-3">
              <QueueSignal label="近期待处理订单" value={loaded ? pendingOrderCount : undefined} tone="cyan" />
              <QueueSignal label="审核列表项" value={loaded ? pendingReviewCount : undefined} tone="gold" />
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

      <nav aria-label="异常处理入口" className="mt-5 flex flex-wrap gap-3 text-sm text-cyan-100">
        <Link href="/dispatch">待分配 / 接单超时</Link><Link href="/complaints">投诉与争议</Link><Link href="/operations">通知发送异常</Link><Link href="/recharges">人工充值审核</Link><Link href="/withdrawals">提现审核</Link>
      </nav>
      <section className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {loaded ? dashboard.metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} href={metricHref[metric.label]} />
        )) : <p className="text-sm text-dfc-subtext">统计尚未核实。</p>}
      </section>

      <section className="mt-6 grid gap-5 xl:grid-cols-2">
        <Panel title="需要介入的订单" hint="当前接口返回最近 100 笔订单；仅列其中待分配、接单超时或期限异常，不代表历史全部待办">
          {!loaded ? <p role="status">{error ? "待办尚未核实，请通过上方入口查询。" : "正在加载待办…"}</p> : attention.length === 0 ? <p>最近 100 笔订单中暂无需要介入的派单。</p> : null}
          <DataTable
            columns={["订单", "客户", "陪玩", "状态", "金额"]}
            rows={attention.map((order) => [
              <Link key={`${order.id}-no`} className="font-black text-cyan-100 underline" href={`/dispatch?orderId=${encodeURIComponent(order.id)}`}>{order.orderNo} · 处理</Link>,
              order.customer,
              order.companion || "平台匹配",
              <StatusBadge key={order.id} tone="warning">{formatStatus(order.status)}</StatusBadge>,
              <span key={`${order.id}-amount`} className="font-black tabular-nums text-dfc-gold">{formatCurrency(order.amount)}</span>
            ])}
          />
        </Panel>

        <Panel title="待审核事项" hint="近期充值和提现审核；完整列表与投诉通过上方入口查看">
          <DataTable
            columns={["类型", "编号", "对象", "金额", "状态"]}
            rows={dashboard.pendingReviews.map((item) => [
              <Link key={`${item.type}-${item.id}-link`} className="text-cyan-100 underline" href={reviewHref(item.type)}>{formatReviewType(item.type)} · 查看审核</Link>,
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

function QueueSignal({ label, value, tone }: { label: string; value?: number; tone: "cyan" | "gold" }) {
  const toneClass = tone === "gold" ? "border-dfc-gold/35 bg-dfc-gold/10 text-dfc-gold" : "border-cyan-300/35 bg-cyan-300/10 text-cyan-100";
  return (
    <div className={`rounded-dfc border px-4 py-3 ${toneClass}`}>
      <div className="text-xs font-black">{label}</div>
      <div className="mt-1 text-2xl font-black tabular-nums">{value ?? "—"}</div>
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

function needsAttention(order: { status: string; acceptanceDeadline?: string | null }) {
  if (order.status === "PAID") return true;
  if (order.status !== "ASSIGNED" || !order.acceptanceDeadline) return false;
  const deadline = Date.parse(order.acceptanceDeadline);
  return !Number.isFinite(deadline) || deadline <= Date.now();
}

function reviewHref(type: string) {
  if (["RECHARGE", "充值"].includes(type)) return "/recharges";
  if (["WITHDRAWAL", "提现"].includes(type)) return "/withdrawals";
  return "/complaints";
}
