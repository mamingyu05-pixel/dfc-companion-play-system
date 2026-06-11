"use client";

import { FormEvent, useEffect, useState } from "react";
import { CustomerShell, SectionHeader } from "../components";

type Order = { id: string; orderNo: string; status: string; totalAmount: string };
type Complaint = { id: string; reason: string; status: string; resolution?: string | null; order: { orderNo: string } };

export default function CustomerComplaintsPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [orderId, setOrderId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function loadData() {
    const token = localStorage.getItem("dfc_customer_token");
    if (!token) return;
    const [ordersResponse, complaintsResponse] = await Promise.all([
      fetch("/api/orders/my", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/complaints/my", { headers: { Authorization: `Bearer ${token}` } })
    ]);
    if (!ordersResponse.ok || !complaintsResponse.ok) throw new Error("Failed to load complaints");
    const orderData = (await ordersResponse.json()) as Order[];
    setOrders(orderData);
    setOrderId((current) => current || orderData[0]?.id || "");
    setComplaints((await complaintsResponse.json()) as Complaint[]);
  }

  useEffect(() => {
    void loadData().catch(() => setError("Failed to load real complaint data"));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = localStorage.getItem("dfc_customer_token");
    if (!token) return;
    if (!orderId) {
      setError("Please select an order first");
      return;
    }
    setError("");
    setStatus("");
    const response = await fetch("/api/complaints", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ orderId, reason })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(message ?? "Failed to submit complaint");
      return;
    }
    setReason("");
    setStatus("Complaint submitted. Admin will handle it manually.");
    await loadData();
  }

  return (
    <CustomerShell>
      <SectionHeader title="Complaints and Refunds" desc="Submit order-related complaints. Phase 1 refunds are handled manually by admins." />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}
      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <form onSubmit={submit} className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">Submit Complaint</h2>
          <select value={orderId} onChange={(event) => setOrderId(event.target.value)} className="mt-4 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus">
            <option value="">Select order</option>
            {orders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.orderNo} / {order.status} / ¥{formatMoney(order.totalAmount)}
              </option>
            ))}
          </select>
          <textarea required value={reason} onChange={(event) => setReason(event.target.value)} className="mt-4 min-h-28 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" placeholder="Describe the issue, request and evidence" />
          <button className="mt-4 rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950">Submit Complaint</button>
        </form>
        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">My Complaint Records</h2>
          <div className="mt-4 space-y-3">
            {complaints.length ? (
              complaints.map((item) => (
                <div key={item.id} className="rounded-dfc-control border border-dfc-border bg-dfc-bg p-3 text-sm">
                  <div className="font-medium">
                    {item.order.orderNo} / {item.status}
                  </div>
                  <div className="mt-1 text-xs text-dfc-subtext">{item.reason}</div>
                  {item.resolution ? <div className="mt-2 text-xs text-dfc-blue">Resolution: {item.resolution}</div> : null}
                </div>
              ))
            ) : (
              <div className="text-sm text-dfc-subtext">No complaint records</div>
            )}
          </div>
        </div>
      </section>
    </CustomerShell>
  );
}

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success";
  return <div className={`mt-4 rounded-dfc-control border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

function formatMoney(value: string) {
  return Number(value || 0).toFixed(2);
}
