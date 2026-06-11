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
    if (!response.ok) throw new Error("Failed to load withdrawals");
    setWithdrawals((await response.json()) as Withdrawal[]);
  }

  useEffect(() => {
    void loadWithdrawals().catch(() => setError("Failed to load real withdrawal data"));
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
    setStatus(nextStatus === "PAID" ? "Withdrawal marked as paid" : nextStatus === "APPROVED" ? "Withdrawal approved" : "Withdrawal rejected");
    await loadWithdrawals();
  }

  return (
    <AdminShell>
      <SectionHeader title="Withdrawal Review" desc="Review companion withdrawals. After manual payout, mark the request as PAID to generate wallet records." />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}
      <section className="mb-4 grid gap-3 md:grid-cols-2">
        <input value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" placeholder="Review note, optional" />
        <input value={payoutReference} onChange={(event) => setPayoutReference(event.target.value)} className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" placeholder="Manual payout reference, required before marking PAID" />
      </section>
      <DataTable
        columns={["ID", "Companion", "Amount", "Payout Account", "Status", "Action"]}
        rows={withdrawals.map((item) => [
          item.id,
          <div key={`${item.id}-companion`}>
            <div className="font-medium text-dfc-text">{item.companion.displayName}</div>
            <div className="mt-1 text-xs text-dfc-subtext">{item.companion.email}</div>
            <div className="mt-1 text-xs text-dfc-muted">Available ¥{formatMoney(item.companion.availableIncome)}</div>
          </div>,
          `¥${formatMoney(item.amount)}`,
          item.payoutAccount,
          <StatusBadge key={`${item.id}-status`} tone={item.status === "PAID" ? "success" : item.status === "REJECTED" ? "danger" : "warning"}>{item.status}</StatusBadge>,
          <div key={`${item.id}-a`} className="flex flex-wrap gap-2">
            {item.status === "PENDING" ? <ActionButton onClick={() => void reviewWithdrawal(item.id, "APPROVED")}>Approve</ActionButton> : null}
            {item.status === "PENDING" ? <ActionButton tone="danger" onClick={() => void reviewWithdrawal(item.id, "REJECTED")}>Reject</ActionButton> : null}
            {item.status === "APPROVED" ? <ActionButton tone="secondary" onClick={() => void reviewWithdrawal(item.id, "PAID")}>Mark Paid</ActionButton> : null}
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
  if (!message) return "Operation failed";
  if (message.includes("Withdrawal must be APPROVED")) return "Withdrawal must be approved before marking paid";
  if (message.includes("Withdrawal request cannot be reviewed")) return "Current withdrawal status cannot be reviewed";
  return message;
}
