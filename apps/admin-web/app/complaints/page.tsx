"use client";

import { useEffect, useState } from "react";
import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

type Complaint = {
  id: string;
  reason: string;
  status: string;
  resolution?: string | null;
  createdAt: string;
  order: { orderNo: string; status: string; totalAmount: string };
  reporter: { email: string; displayName: string; role: string };
};

export default function ComplaintsPage() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [resolution, setResolution] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function loadComplaints() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    const response = await fetch("/api/admin/complaints", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("Failed to load complaints");
    setComplaints((await response.json()) as Complaint[]);
  }

  useEffect(() => {
    void loadComplaints().catch(() => setError("Failed to load real complaint data"));
  }, []);

  async function reviewComplaint(id: string, nextStatus: "IN_REVIEW" | "RESOLVED" | "REJECTED") {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    setError("");
    setStatus("");
    const response = await fetch(`/api/admin/complaints/${id}/review`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status: nextStatus, resolution })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(message ?? "Failed to update complaint");
      return;
    }
    setResolution("");
    setStatus("Complaint status updated");
    await loadComplaints();
  }

  return (
    <AdminShell>
      <SectionHeader title="Complaint Handling" desc="Review customer and companion complaints. Refunds remain manual in phase 1." />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}
      <input value={resolution} onChange={(event) => setResolution(event.target.value)} className="mb-4 w-full max-w-xl rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" placeholder="Resolution note" />
      <DataTable
        columns={["ID", "Order", "Reporter", "Reason", "Status", "Action"]}
        rows={complaints.map((item) => [
          item.id,
          `${item.order.orderNo} / ¥${formatMoney(item.order.totalAmount)} / ${item.order.status}`,
          `${item.reporter.displayName} (${item.reporter.role})`,
          item.reason,
          <StatusBadge key={`${item.id}-s`} tone={item.status === "RESOLVED" ? "success" : item.status === "REJECTED" ? "danger" : "warning"}>{item.status}</StatusBadge>,
          <div key={`${item.id}-a`} className="flex flex-wrap gap-2">
            <ActionButton tone="secondary" onClick={() => void reviewComplaint(item.id, "IN_REVIEW")}>Reviewing</ActionButton>
            <ActionButton onClick={() => void reviewComplaint(item.id, "RESOLVED")}>Resolve</ActionButton>
            <ActionButton tone="danger" onClick={() => void reviewComplaint(item.id, "REJECTED")}>Reject</ActionButton>
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
