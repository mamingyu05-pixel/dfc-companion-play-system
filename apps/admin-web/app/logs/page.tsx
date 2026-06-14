"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

type AdminLog = {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  target: string;
  createdAt: string;
};

export default function LogsPage() {
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadLogs() {
      const token = localStorage.getItem("dfc_admin_token");
      if (!token) return;

      const response = await fetch("/api/admin/logs", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error("无法加载真实操作日志");
      setLogs((await response.json()) as AdminLog[]);
    }

    void loadLogs().catch(() => setError("无法加载真实操作日志，请检查登录状态或 API 服务"));
  }, []);

  const stats = useMemo(() => {
    const financeActions = logs.filter((log) => ["APPROVED_RECHARGE", "REJECTED_RECHARGE", "ADMIN_CREDIT_BALANCE", "ADMIN_DEBIT_BALANCE"].includes(log.action)).length;
    const dispatchActions = logs.filter((log) => log.action === "ASSIGN_ORDER").length;
    const adminActions = logs.filter((log) => log.action === "CREATE_ADMIN").length;
    return { financeActions, dispatchActions, adminActions };
  }, [logs]);

  return (
    <AdminShell>
      <SectionHeader eyebrow="Audit Trail" title="操作日志" desc="所有管理员操作都必须记录到 admin_logs。资金、派单、投诉和权限动作优先追踪。" />

      <section className="mb-5 grid gap-4 md:grid-cols-3">
        <Signal label="资金相关" value={String(stats.financeActions)} hint="充值/调账/扣款" tone="gold" />
        <Signal label="派单动作" value={String(stats.dispatchActions)} hint="订单分配记录" tone="cyan" />
        <Signal label="权限动作" value={String(stats.adminActions)} hint="管理员创建" tone="green" />
      </section>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <DataTable
        columns={["编号", "操作人", "动作", "对象类型", "对象", "时间"]}
        rows={logs.map((log) => [
          shortId(log.id),
          <span key={`${log.id}-actor`} className="font-semibold text-white">{log.actor}</span>,
          <ActionBadge key={`${log.id}-action`} action={log.action} />,
          toEntityType(log.entityType),
          log.target || log.entityId || "-",
          formatDateTime(log.createdAt)
        ])}
      />
    </AdminShell>
  );
}

function ActionBadge({ action }: { action: string }) {
  const moneyActions = ["APPROVED_RECHARGE", "REJECTED_RECHARGE", "ADMIN_CREDIT_BALANCE", "ADMIN_DEBIT_BALANCE"];
  const tone = moneyActions.includes(action) ? "warning" : action === "CREATE_ADMIN" ? "danger" : action === "ASSIGN_ORDER" ? "success" : "default";
  return <StatusBadge tone={tone}>{formatAction(action)}</StatusBadge>;
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

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}...` : id;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function toEntityType(type: string) {
  const map: Record<string, string> = {
    USER: "用户",
    ORDER: "订单",
    RECHARGE: "充值",
    WITHDRAWAL: "提现",
    COMPLAINT: "投诉",
    COMPANION: "陪玩",
    ADMIN: "管理员"
  };
  return map[type] ?? type;
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
