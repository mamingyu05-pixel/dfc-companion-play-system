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
    if (!response.ok) throw new Error("无法加载订单");
    setOrders((await response.json()) as Order[]);
  }

  useEffect(() => {
    void loadOrders().catch(() => setError("无法加载我的订单"));
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
      setError(message ?? "订单操作失败");
      return;
    }
    setStatus(action === "start" ? "订单已开始" : "订单已完成并结算");
    await loadOrders();
  }

  const stats = useMemo(() => {
    const accepted = orders.filter((order) => order.status === "ACCEPTED").length;
    const active = orders.filter((order) => order.status === "IN_PROGRESS").length;
    const completed = orders.filter((order) => order.status === "COMPLETED").length;
    return { accepted, active, completed };
  }, [orders]);

  return (
    <CompanionShell>
      <SectionHeader eyebrow="My Service" title="我的订单" desc="进入语音/游戏服务后开始订单。服务完成后再点击完成，系统会结算收益。" />

      <section className="mt-5 grid gap-4 md:grid-cols-3">
        <MetricCard label="待开始" value={String(stats.accepted)} hint="已接单，待开始服务" tone="cyan" />
        <MetricCard label="服务中" value={String(stats.active)} hint="需要按时完成" tone="gold" />
        <MetricCard label="已完成" value={String(stats.completed)} hint="完成后进入收益流水" tone="green" />
      </section>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {orders.length ? (
          orders.map((order) => {
            const nextAction = order.status === "ACCEPTED" ? "开始" : order.status === "IN_PROGRESS" ? "完成" : undefined;
            return (
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
                action={nextAction}
                onAction={nextAction === "开始" ? () => void updateOrder(order.id, "start") : nextAction === "完成" ? () => void updateOrder(order.id, "complete") : undefined}
              />
            );
          })
        ) : (
          <div className="companion-card p-4 text-sm text-dfc-subtext">暂无订单。</div>
        )}
      </div>
    </CompanionShell>
  );
}

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success";
  return <div className={`mt-4 rounded-dfc-control border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}
