"use client";

import { useEffect, useState } from "react";
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

  return (
    <AdminShell>
      <SectionHeader title="提现审核" desc="审核陪玩提现。人工打款后点击确认打款，系统会生成钱包流水。" />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}
      <section className="mb-4 grid gap-3 md:grid-cols-2">
        <input value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" placeholder="审核备注，可留空" />
        <input value={payoutReference} onChange={(event) => setPayoutReference(event.target.value)} className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" placeholder="人工打款流水号，确认打款时填写" />
      </section>
      <DataTable
        columns={["ID", "陪玩", "金额", "收款账户", "状态", "操作"]}
        rows={withdrawals.map((item) => [
          item.id,
          <div key={`${item.id}-companion`}>
            <div className="font-medium text-dfc-text">{item.companion.displayName}</div>
            <div className="mt-1 text-xs text-dfc-subtext">{item.companion.email}</div>
            <div className="mt-1 text-xs text-dfc-muted">可提 ¥{formatMoney(item.companion.availableIncome)}</div>
          </div>,
          `¥${formatMoney(item.amount)}`,
          item.payoutAccount,
          <StatusBadge key={`${item.id}-status`} tone={item.status === "PAID" ? "success" : item.status === "REJECTED" ? "danger" : "warning"}>{item.status}</StatusBadge>,
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

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success";
  return <div className={`mb-4 rounded-dfc-control border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

function formatMoney(value: string) {
  return Number(value || 0).toFixed(2);
}

function toFriendlyError(message?: string) {
  if (!message) return "操作失败";
  if (message.includes("Withdrawal must be APPROVED")) return "提现必须先通过后才能确认打款";
  if (message.includes("Withdrawal request cannot be reviewed")) return "当前提现状态不能审核";
  return message;
}
