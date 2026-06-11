"use client";

import { useEffect, useState } from "react";
import { CompanionShell, OrderCard, SectionHeader } from "../components";

type CompanionOrder = {
  orderNo: string;
  mode: string;
  status: string;
  hours: string;
  totalAmount: string;
  companionIncome: string;
  customerName: string;
};

export default function MyOrdersPage() {
  const [orders, setOrders] = useState<CompanionOrder[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) return;

    void fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("无法加载订单");
        const data = (await response.json()) as { companionOrders?: CompanionOrder[] };
        setOrders(data.companionOrders ?? []);
      })
      .catch(() => setError("无法加载我的订单，请刷新页面"));
  }, []);

  return (
    <CompanionShell>
      <SectionHeader title="我的订单" desc="这里只显示当前陪玩账号的已接订单、进行中订单和历史订单。" />
      {error ? <div className="mt-4 rounded-dfc-control border border-dfc-danger/40 bg-dfc-danger/10 px-3 py-2 text-sm text-dfc-danger">{error}</div> : null}
      <section className="mt-6 grid gap-4 md:grid-cols-2">
        {orders.length ? (
          orders.map((order) => (
            <OrderCard
              key={order.orderNo}
              order={{
                id: order.orderNo,
                mode: `${order.customerName} · ${order.mode}`,
                hours: Number(order.hours),
                amount: Number(order.companionIncome || order.totalAmount),
                status: order.status
              }}
              action={order.status === "IN_PROGRESS" ? "完成订单" : undefined}
            />
          ))
        ) : (
          <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4 text-sm text-dfc-subtext">
            当前账号还没有订单。
          </div>
        )}
      </section>
    </CompanionShell>
  );
}
