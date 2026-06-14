"use client";

import { useEffect, useMemo, useState } from "react";
import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

type Withdrawal = {
  id: string;
  amount: string;
  payoutAccount: string;
  status: string;
  note?: string | null;
  reviewNote?: string | null;
  payoutReference?: string | null;
  createdAt: string;
  companion: {
    email: string;
    displayName: string;
    availableIncome: string;
    frozenIncome: string;
  };
};

export default function WithdrawalsPage() {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [reviewNote, setReviewNote] = useState("");
  const [payoutReference, setPayoutReference] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function loadWithdrawals() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    const response = await fetch("/api/admin/withdrawals", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("无法加载提现申请");
    setWithdrawals((await response.json()) as Withdrawal[]);
  }

  useEffect(() => {
    void loadWithdrawals().catch(() => setError("无法加载真实提现数据"));
  }, []);

  async function reviewWithdrawal(id: string, nextStatus: "APPROVED" | "REJECTED" | "PAID") {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    setError("");
    setStatus("");
    const response = await fetch(`/api/admin/withdrawals/${id}/review`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status: nextStatus, note: reviewNote, payoutReference })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(toFriendlyError(message));
      return;
    }
    setReviewNote("");
    setPayoutReference("");
    setStatus(nextStatus === "PAID" ? "提现已确认打款" : nextStatus === "APPROVED" ? "提现已通过" : "提现已拒绝");
    await loadWithdrawals();
  }

  const stats = useMemo(() => {
    const pending = withdrawals.filter((item) => item.status === "PENDING");
    const approved = withdrawals.filter((item) => item.status === "APPROVED");
    const pendingAmount = pending.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return { pendingCount: pending.length, approvedCount: approved.length, pendingAmount };
  }, [withdrawals]);

  return (
    <AdminShell>
      <SectionHeader eyebrow="Payout Review" title="提现审核" desc="先审核陪玩可提现收入，再人工打款。确认打款后系统生成钱包流水并释放冻结金额。" />

      <section className="mb-5 grid gap-4 md:grid-cols-3">
        <Signal label="待审核" value={String(stats.pendingCount)} hint={`待核金额 ¥${formatMoney(String(stats.pendingAmount))}`} tone="gold" />
        <Signal label="待打款" value={String(stats.approvedCount)} hint="通过后仍需人工打款" tone="cyan" />
        <Signal label="总申请" value={String(withdrawals.length)} hint="当前列表记录" tone="green" />
      </section>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <section className="admin-panel mb-5">
        <div className="grid gap-3 md:grid-cols-2">
          <label>
            <span className="mb-2 block text-xs font-black text-dfc-muted">审核备注</span>
            <input value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} className="input" placeholder="拒绝原因或人工审核说明" />
          </label>
          <label>
            <span className="mb-2 block text-xs font-black text-dfc-muted">打款流水号</span>
            <input value={payoutReference} onChange={(event) => setPayoutReference(event.target.value)} className="input" placeholder="确认打款时填写人工转账流水号" />
          </label>
        </div>
      </section>

      <DataTable
        columns={["ID", "陪玩", "金额", "收款账户", "状态", "操作"]}
        rows={withdrawals.map((item) => [
          <div key={`${item.id}-id`}>
            <div className="font-black text-white">{shortId(item.id)}</div>
            <div className="mt-1 text-xs text-dfc-muted">{formatDateTime(item.createdAt)}</div>
          </div>,
          <div key={`${item.id}-companion`}>
            <div className="font-semibold text-white">{item.companion.displayName}</div>
            <div className="mt-1 text-xs text-dfc-subtext">{item.companion.email}</div>
            <div className="mt-1 text-xs text-dfc-muted">可提 ¥{formatMoney(item.companion.availableIncome)} / 冻结 ¥{formatMoney(item.companion.frozenIncome)}</div>
          </div>,
          <span key={`${item.id}-amount`} className="font-black tabular-nums text-dfc-gold">¥{formatMoney(item.amount)}</span>,
          <span key={`${item.id}-account`} className="max-w-64 truncate">{item.payoutAccount}</span>,
          <StatusBadge key={`${item.id}-status`} tone={item.status === "PAID" ? "success" : item.status === "REJECTED" ? "danger" : "warning"}>
            {toWithdrawalStatus(item.status)}
          </StatusBadge>,
          <div key={`${item.id}-a`} className="flex flex-wrap gap-2">
            {item.status === "PENDING" ? <ActionButton onClick={() => void reviewWithdrawal(item.id, "APPROVED")}>通过</ActionButton> : null}
            {item.status === "PENDING" ? <ActionButton tone="danger" onClick={() => void reviewWithdrawal(item.id, "REJECTED")}>拒绝</ActionButton> : null}
            {item.status === "APPROVED" ? <ActionButton tone="secondary" onClick={() => void reviewWithdrawal(item.id, "PAID")}>确认打款</ActionButton> : null}
          </div>
        ])}
      />
    </AdminShell>
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

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}...` : id;
}

function toWithdrawalStatus(status: string) {
  if (status === "PENDING") return "待审核";
  if (status === "APPROVED") return "待打款";
  if (status === "PAID") return "已打款";
  if (status === "REJECTED") return "已拒绝";
  return status;
}

function toFriendlyError(message?: string) {
  if (!message) return "操作失败";
  if (message.includes("Withdrawal must be APPROVED")) return "提现必须先通过后才能确认打款";
  if (message.includes("Withdrawal request cannot be reviewed")) return "当前提现状态不能审核";
  return message;
}
