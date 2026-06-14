"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

type WalletTransaction = {
  id: string;
  type: string;
  direction: string;
  amount: string;
  balanceAfter: string;
  note?: string | null;
  createdAt: string;
  user: {
    email: string;
    displayName: string;
    role: string;
  };
  operator?: {
    email: string;
    displayName: string;
  } | null;
};

export default function FinancePage() {
  const [rows, setRows] = useState<WalletTransaction[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;

    void fetch("/api/admin/wallet-transactions", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("无法加载财务流水");
        setRows((await response.json()) as WalletTransaction[]);
      })
      .catch(() => setError("无法加载真实财务流水，请确认管理员已登录"));
  }, []);

  const stats = useMemo(() => {
    const credit = rows.filter((item) => item.direction === "CREDIT").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const debit = rows.filter((item) => item.direction === "DEBIT").reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const manual = rows.filter((item) => item.operator).length;
    return { credit, debit, manual };
  }, [rows]);

  return (
    <AdminShell>
      <SectionHeader eyebrow="Ledger Trace" title="财务流水" desc="读取 wallet_transactions，查看充值入账、订单支付、订单结算、提现和管理员调账。金额、操作者和余额变动必须可追溯。" />

      <section className="mb-5 grid gap-4 md:grid-cols-3">
        <Signal label="入账合计" value={`¥${formatMoney(String(stats.credit))}`} hint="CREDIT 流水" tone="green" />
        <Signal label="出账合计" value={`¥${formatMoney(String(stats.debit))}`} hint="DEBIT 流水" tone="gold" />
        <Signal label="人工操作" value={String(stats.manual)} hint="含管理员调账/审核" tone="cyan" />
      </section>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <DataTable
        columns={["编号", "类型", "对象", "金额", "余额", "操作人", "时间", "状态"]}
        rows={rows.map((item) => [
          shortId(item.id),
          toTransactionType(item.type),
          <div key={`${item.id}-user`}>
            <div className="font-semibold text-white">{item.user.displayName}</div>
            <div className="mt-1 text-xs text-dfc-muted">{item.user.role} / {item.user.email}</div>
          </div>,
          <span key={`${item.id}-amount`} className={`font-black tabular-nums ${item.direction === "CREDIT" ? "text-dfc-success" : "text-dfc-gold"}`}>
            {item.direction === "CREDIT" ? "+" : "-"}¥{formatMoney(item.amount)}
          </span>,
          <span key={`${item.id}-balance`} className="font-black tabular-nums text-white">¥{formatMoney(item.balanceAfter)}</span>,
          item.operator ? <Person key={`${item.id}-operator`} name={item.operator.displayName} email={item.operator.email} /> : "系统",
          formatDateTime(item.createdAt),
          <StatusBadge key={`${item.id}-status`} tone="success">已记录</StatusBadge>
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

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}...` : id;
}

function toTransactionType(type: string) {
  const map: Record<string, string> = {
    RECHARGE: "充值入账",
    ORDER_PAYMENT: "订单支付",
    ORDER_SETTLEMENT: "订单结算",
    WITHDRAWAL: "提现",
    ADMIN_ADJUSTMENT: "管理员调账",
    REFUND: "退款"
  };
  return map[type] ?? type;
}
