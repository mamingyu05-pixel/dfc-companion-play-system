"use client";

import { useEffect, useState } from "react";
import { AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

type AdminOrder = {
  id: string;
  orderNo: string;
  mode: string;
  hours: string;
  unitPrice: string;
  totalAmount: string;
  status: string;
  voiceTrialRequested: boolean;
  customer?: { email: string; displayName: string };
  companion?: { email: string; displayName: string } | null;
  createdAt: string;
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadOrders() {
      const token = localStorage.getItem("dfc_admin_token");
      if (!token) return;
      const response = await fetch("/api/admin/orders", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error("Failed to load orders");
      setOrders((await response.json()) as AdminOrder[]);
    }

    void loadOrders().catch(() => setError("Failed to load real order data"));
  }, []);

  return (
    <AdminShell>
      <SectionHeader title="Order Management" desc="Real order records from the database. Dispatch paid orders from the Dispatch page." />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <DataTable
        columns={["Order No", "Customer", "Companion", "Mode", "Hours", "Amount", "Voice Trial", "Status", "Created"]}
        rows={orders.map((order) => [
          order.orderNo,
          order.customer ? `${order.customer.displayName} (${order.customer.email})` : "-",
          order.companion ? `${order.companion.displayName} (${order.companion.email})` : "Manual match pending",
          order.mode,
          order.hours,
          `¥${formatMoney(order.totalAmount)}`,
          order.voiceTrialRequested ? "Yes" : "No",
          <StatusBadge key={`${order.id}-status`} tone={statusTone(order.status)}>{order.status}</StatusBadge>,
          new Date(order.createdAt).toLocaleString()
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

function statusTone(status: string): "default" | "warning" | "danger" | "success" {
  if (status === "COMPLETED") return "success";
  if (status === "CANCELLED" || status === "REFUNDED" || status === "DISPUTED") return "danger";
  if (status === "PAID" || status === "ASSIGNED" || status === "ACCEPTED" || status === "IN_PROGRESS") return "warning";
  return "default";
}
