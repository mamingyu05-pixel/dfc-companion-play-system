"use client";

import { useEffect, useState } from "react";
import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

type AdminOrder = {
  id: string;
  orderNo: string;
  mode: string;
  hours: string;
  totalAmount: string;
  status: string;
  customer?: { email: string; displayName: string };
  companion?: { email: string; displayName: string } | null;
};

type Companion = {
  userId: string;
  nickname: string;
  email: string;
  status: string;
  onlineStatus: string;
  pricePerHour: string;
};

export default function DispatchPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [selectedCompanionId, setSelectedCompanionId] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function loadData() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    const [ordersResponse, companionsResponse] = await Promise.all([
      fetch("/api/admin/orders", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/admin/companions", { headers: { Authorization: `Bearer ${token}` } })
    ]);
    if (!ordersResponse.ok || !companionsResponse.ok) throw new Error("Failed to load dispatch data");
    const orderData = (await ordersResponse.json()) as AdminOrder[];
    const companionData = (await companionsResponse.json()) as Companion[];
    setOrders(orderData);
    setCompanions(companionData);
    setSelectedOrderId(orderData.find((order) => order.status === "PAID")?.id ?? "");
    setSelectedCompanionId(companionData.find((item) => item.status === "LISTED")?.userId ?? "");
  }

  useEffect(() => {
    void loadData().catch(() => setError("Failed to load real dispatch data"));
  }, []);

  async function assign() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    if (!selectedOrderId || !selectedCompanionId) {
      setError("Please select an order and a companion");
      return;
    }

    setError("");
    setStatus("");
    const response = await fetch(`/api/admin/orders/${selectedOrderId}/assign`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ companionId: selectedCompanionId })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(toFriendlyError(message));
      return;
    }

    setStatus("Order assigned. Discord/KOOK notification was attempted by the API.");
    await loadData();
  }

  const pending = orders.filter((order) => order.status === "PAID");
  const listedCompanions = companions.filter((companion) => companion.status === "LISTED");

  return (
    <AdminShell>
      <SectionHeader title="Dispatch" desc="Assign paid orders to listed companions. Manual match orders also enter this queue." />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <section className="mb-6 rounded-dfc border border-dfc-border bg-dfc-surface p-4">
        <h2 className="text-base font-semibold">Assign Order</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <select value={selectedOrderId} onChange={(event) => setSelectedOrderId(event.target.value)} className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus">
            <option value="">Select paid order</option>
            {pending.map((order) => (
              <option key={order.id} value={order.id}>
                {order.orderNo} / {order.customer?.displayName ?? "-"} / ¥{formatMoney(order.totalAmount)}
              </option>
            ))}
          </select>
          <select value={selectedCompanionId} onChange={(event) => setSelectedCompanionId(event.target.value)} className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus">
            <option value="">Select companion</option>
            {listedCompanions.map((companion) => (
              <option key={companion.userId} value={companion.userId}>
                {companion.nickname} / {companion.onlineStatus} / ¥{formatMoney(companion.pricePerHour)}/h
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void assign()} className="rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950">
            Assign
          </button>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_1.2fr]">
        <div>
          <h2 className="mb-3 text-base font-semibold">Paid Orders</h2>
          <DataTable
            columns={["Order", "Customer", "Amount", "Status"]}
            rows={pending.map((order) => [
              order.orderNo,
              order.customer?.displayName ?? "-",
              `¥${formatMoney(order.totalAmount)}`,
              <StatusBadge key={order.id} tone="warning">{order.status}</StatusBadge>
            ])}
          />
        </div>
        <div>
          <h2 className="mb-3 text-base font-semibold">Listed Companions</h2>
          <DataTable
            columns={["Name", "Online", "Price", "Email", "Action"]}
            rows={listedCompanions.map((companion) => [
              companion.nickname,
              companion.onlineStatus,
              `¥${formatMoney(companion.pricePerHour)}/h`,
              companion.email,
              <ActionButton key={companion.userId} onClick={() => setSelectedCompanionId(companion.userId)}>Select</ActionButton>
            ])}
          />
        </div>
      </section>
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
  if (!message) return "Dispatch failed";
  if (message.includes("Only PAID orders can be assigned")) return "Only PAID orders can be assigned";
  if (message.includes("Companion is not listed")) return "Companion is not listed or active";
  if (message.includes("already been assigned")) return "Order has already been assigned or changed";
  return message;
}
