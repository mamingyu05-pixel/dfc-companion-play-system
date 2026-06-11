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

export default function AvailableOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function loadOrders() {
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) return;
    const response = await fetch("/api/orders/companion/available", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("无法加载订单");
    setOrders((await response.json()) as Order[]);
  }

  useEffect(() => {
    void loadOrders().catch(() => setError("无法加载可接订单"));
  }, []);

  async function acceptOrder(orderId: string) {
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) return;
    setError("");
    setStatus("");
    const response = await fetch(`/api/orders/${orderId}/accept`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(message ?? "接单失败");
      return;
    }
    setStatus("接单成功");
    await loadOrders();
  }

  return (
    <CompanionShell>
      <SectionHeader title="可接订单" desc="这里只显示派给你的订单，或平台人工匹配开放给已上架陪玩的订单。" />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {orders.length ? (
          orders.map((order) => (
            <OrderCard
              key={order.id}
              order={{
                id: order.orderNo,
                mode: `${order.mode}${order.customer ? ` / ${order.customer.displayName}` : ""}`,
                hours: Number(order.hours),
                amount: Number(order.totalAmount),
                status: order.status
              }}
              action="接单"
              onAction={() => void acceptOrder(order.id)}
            />
          ))
        ) : (
          <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4 text-sm text-dfc-subtext">暂无可接订单。</div>
        )}
      </div>
    </CompanionShell>
  );
}

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success";
  return <div className={`mt-4 rounded-dfc-control border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}
