"use client";

import { useEffect, useState } from "react";
import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

type Companion = {
  userId: string;
  email: string;
  nickname: string;
  status: string;
  onlineStatus: string;
  deltaForceRank: string;
  pricePerHour: string;
  availableIncome: string;
  pendingIncome: string;
};

export default function CompanionsPage() {
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function loadCompanions() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    const response = await fetch("/api/admin/companions", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("Failed to load companions");
    setCompanions((await response.json()) as Companion[]);
  }

  useEffect(() => {
    void loadCompanions().catch(() => setError("Failed to load real companion data"));
  }, []);

  async function updateStatus(userId: string, nextStatus: "LISTED" | "UNLISTED" | "BANNED") {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    setError("");
    setStatus("");
    const response = await fetch(`/api/admin/companions/${userId}/status`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status: nextStatus })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(message ?? "Failed to update companion");
      return;
    }
    setStatus(`Companion status updated to ${nextStatus}`);
    await loadCompanions();
  }

  return (
    <AdminShell>
      <SectionHeader title="Companion Management" desc="Real companion profiles. List, unlist or ban companions from here." />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}
      <DataTable
        columns={["ID", "Name", "Email", "Rank", "Price", "Profile Status", "Online", "Income", "Action"]}
        rows={companions.map((item) => [
          item.userId,
          item.nickname,
          item.email,
          item.deltaForceRank,
          `¥${formatMoney(item.pricePerHour)}`,
          <StatusBadge key={`${item.userId}-s`} tone={item.status === "LISTED" ? "success" : item.status === "BANNED" ? "danger" : "warning"}>{item.status}</StatusBadge>,
          item.onlineStatus,
          `Available ¥${formatMoney(item.availableIncome)} / Pending ¥${formatMoney(item.pendingIncome)}`,
          <div key={`${item.userId}-a`} className="flex flex-wrap gap-2">
            <ActionButton onClick={() => void updateStatus(item.userId, "LISTED")}>List</ActionButton>
            <ActionButton tone="secondary" onClick={() => void updateStatus(item.userId, "UNLISTED")}>Unlist</ActionButton>
            <ActionButton tone="danger" onClick={() => void updateStatus(item.userId, "BANNED")}>Ban</ActionButton>
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
