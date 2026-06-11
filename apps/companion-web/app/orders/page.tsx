"use client";

import { useEffect, useState } from "react";
import { CompanionShell, OrderCard, SectionHeader } from "../components";

type Order = {
  id: string;
  orderNo: string;
  mode: string;
  hours: string;
  totalAmount: string;
  status: string;
  customer?: { displayName: string; email: string };
};

export default function CompanionOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function loadOrders() {
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) return;
    const response = await fetch("/api/orders/companion/my", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("Failed to load orders");
    setOrders((await response.json()) as Order[]);
  }

  useEffect(() => {
    void loadOrders().catch(() => setError("Failed to load your orders"));
  }, []);

  async function updateOrder(orderId: string, action: "start" | "complete") {
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) return;
    setError("");
    setStatus("");
    const response = await fetch(`/api/orders/${orderId}/${action}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(message ?? `Failed to ${action} order`);
      return;
    }
    setStatus(action === "start" ? "Order started" : "Order completed and settled");
    await loadOrders();
  }

  return (
    <CompanionShell>
      <SectionHeader title="My Orders" desc="Start accepted orders after entering voice/game service. Complete orders only after service is finished." />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {orders.length ? (
          orders.map((order) => {
            const nextAction = order.status === "ACCEPTED" ? "Start" : order.status === "IN_PROGRESS" ? "Complete" : undefined;
            return (
              <OrderCard
                key={order.id}
                order={{
                  id: order.orderNo,
                  mode: `${order.mode}${order.customer ? ` / ${order.customer.displayName}` : ""}`,
                  hours: Number(order.hours),
                  amount: Number(order.totalAmount),
                  status: order.status
                }}
                action={nextAction}
                onAction={nextAction === "Start" ? () => void updateOrder(order.id, "start") : nextAction === "Complete" ? () => void updateOrder(order.id, "complete") : undefined}
              />
            );
          })
        ) : (
          <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4 text-sm text-dfc-subtext">No orders yet.</div>
        )}
      </div>
    </CompanionShell>
  );
}

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success";
  return <div className={`mt-4 rounded-dfc-control border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}
