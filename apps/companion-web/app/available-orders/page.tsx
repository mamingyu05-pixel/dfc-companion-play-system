"use client";

import { useEffect, useMemo, useState } from "react";
import { CompanionShell, MetricCard, OrderCard, SectionHeader } from "../components";

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

  const stats = useMemo(() => {
    const amount = orders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
    const hours = orders.reduce((sum, order) => sum + Number(order.hours || 0), 0);
    return { amount, hours };
  }, [orders]);

  return (
    <CompanionShell>
      <SectionHeader eyebrow="Order Queue" title="可接订单" desc="这里只显示派给你，或平台人工匹配开放给已上架陪玩的订单。接单后请及时进入语音/游戏服务。" />

      <section className="mt-5 grid gap-4 md:grid-cols-3">
        <MetricCard label="可接订单" value={String(orders.length)} hint="当前队列" />
        <MetricCard label="订单金额" value={`¥${formatMoney(String(stats.amount))}`} hint="队列合计" tone="gold" />
        <MetricCard label="预计时长" value={`${formatMoney(String(stats.hours))}h`} hint="队列合计" tone="green" />
      </section>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {orders.length ? (
          orders.map((order) => (
            <OrderCard
              key={order.id}
              order={{
                id: order.orderNo,
                mode: order.mode,
                customer: order.customer ? `${order.customer.displayName} / ${order.customer.email}` : undefined,
                hours: Number(order.hours),
                amount: Number(order.totalAmount),
                status: order.status
              }}
              action="接单"
              onAction={() => void acceptOrder(order.id)}
            />
          ))
        ) : (
          <div className="companion-card p-4 text-sm text-dfc-subtext">暂无可接订单。</div>
        )}
      </div>
    </CompanionShell>
  );
}

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success";
  return <div className={`mt-4 rounded-dfc-control border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

function formatMoney(value: string) {
  return Number(value || 0).toFixed(2);
}
