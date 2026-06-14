"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { CustomerShell } from "../components";

type Order = { id: string; orderNo: string; status: string; totalAmount: string };
type Complaint = { id: string; reason: string; status: string; resolution?: string | null; order: { orderNo: string } };

const complaintTypes = ["服务未开始", "沟通异常", "时长争议", "退款协商", "其他问题"];

export default function CustomerComplaintsPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [orderId, setOrderId] = useState("");
  const [complaintType, setComplaintType] = useState(complaintTypes[0]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadData() {
    const token = localStorage.getItem("dfc_customer_token");
    if (!token) return;
    const [ordersResponse, complaintsResponse] = await Promise.all([
      fetch("/api/orders/my", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/complaints/my", { headers: { Authorization: `Bearer ${token}` } })
    ]);
    if (!ordersResponse.ok || !complaintsResponse.ok) throw new Error("无法加载投诉数据");
    const orderData = (await ordersResponse.json()) as Order[];
    setOrders(orderData);
    setOrderId((current) => current || orderData[0]?.id || "");
    setComplaints((await complaintsResponse.json()) as Complaint[]);
  }

  useEffect(() => {
    void loadData().catch(() => setError("无法加载真实投诉数据"));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = localStorage.getItem("dfc_customer_token");
    if (!token) return;
    if (!orderId) {
      setError("请先选择订单");
      return;
    }
    setError("");
    setStatus("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/complaints", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ orderId, reason: `[${complaintType}] ${reason}` })
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
      if (!response.ok) {
        const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
        throw new Error(message ?? "提交投诉失败");
      }
      setReason("");
      setStatus("投诉已提交，管理员会人工处理。");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交投诉失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  const selectedOrder = orders.find((order) => order.id === orderId);
  const pendingCount = complaints.filter((complaint) => complaint.status === "PENDING").length;
  const resolvedCount = complaints.filter((complaint) => complaint.status !== "PENDING").length;

  return (
    <CustomerShell>
      <section className="maycat-complaint-hero overflow-hidden rounded-dfc border border-cyan-300/20 p-4 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div>
            <div className="maycat-chip px-3 py-1 text-xs font-black uppercase tracking-[0.18em]">Maycat Case Desk</div>
            <h1 className="maycat-text-glow mt-5 max-w-3xl text-4xl font-black leading-tight text-white md:text-5xl">
              提交问题工单，等待人工处理。
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-dfc-subtext md:text-base">
              投诉、退款和订单争议由管理员人工处理。请选择对应订单，写清楚时间、问题、诉求和证据，客服会根据后台记录核对。
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <CaseMetric label="可选订单" value={String(orders.length)} hint="当前账号订单" />
            <CaseMetric label="处理中" value={String(pendingCount)} hint="等待管理员处理" />
            <CaseMetric label="已处理" value={String(resolvedCount)} hint="含通过/拒绝/关闭" />
          </div>
        </div>
      </section>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_420px]">
        <form onSubmit={submit} className="maycat-card p-4 md:p-5">
          <div className="border-b border-cyan-300/15 pb-4">
            <h2 className="text-lg font-black text-white">提交投诉</h2>
            <p className="mt-1 text-xs leading-5 text-dfc-muted">只处理当前账号订单相关问题。请勿提交密码、验证码或私密账号信息。</p>
          </div>

          <label className="mt-4 block">
            <span className="text-sm font-semibold text-cyan-50/80">关联订单</span>
            <select value={orderId} onChange={(event) => setOrderId(event.target.value)} className="maycat-input mt-2 px-3 py-3 text-sm">
              <option value="">选择订单</option>
              {orders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.orderNo} / {order.status} / ¥{formatMoney(order.totalAmount)}
                </option>
              ))}
            </select>
          </label>

          {selectedOrder ? (
            <div className="mt-3 rounded-dfc-control border border-cyan-300/20 bg-[#07111f]/70 p-3 text-sm">
              <div className="font-black text-white">{selectedOrder.orderNo}</div>
              <div className="mt-1 text-xs text-dfc-subtext">
                状态：{selectedOrder.status} · 金额：¥{formatMoney(selectedOrder.totalAmount)}
              </div>
            </div>
          ) : null}

          <div className="mt-4">
            <span className="text-sm font-semibold text-cyan-50/80">问题类型</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {complaintTypes.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setComplaintType(type)}
                  className={`rounded-dfc-control border px-3 py-2 text-sm font-semibold transition ${
                    complaintType === type ? "border-dfc-warning bg-dfc-warning/10 text-dfc-warning" : "border-cyan-300/20 bg-[#07111f]/70 text-dfc-subtext hover:text-cyan-100"
                  }`}
                  aria-pressed={complaintType === type}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          <label className="mt-4 block">
            <span className="text-sm font-semibold text-cyan-50/80">问题说明</span>
            <textarea
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="maycat-input mt-2 min-h-36 resize-y px-3 py-3 text-sm"
              placeholder="请写清楚：发生时间、陪玩昵称、问题经过、你的诉求、是否有截图或聊天记录。"
            />
          </label>

          <div className="mt-4 rounded-dfc-control border border-dfc-warning/30 bg-dfc-warning/10 px-3 py-3 text-xs leading-5 text-dfc-warning">
            建议先保留语音/聊天截图、付款记录和订单号。当前版本先提交文字工单，证据可通过客服补充。
          </div>

          <button disabled={isSubmitting || !orderId || !reason.trim()} className="maycat-button mt-5 w-full px-4 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-60">
            {isSubmitting ? "提交中..." : "提交投诉"}
          </button>
        </form>

        <aside className="space-y-6">
          <section className="maycat-price-console p-4 lg:sticky lg:top-24">
            <h2 className="text-base font-black text-white">处理说明</h2>
            <div className="mt-4 space-y-3 text-sm leading-6 text-dfc-subtext">
              <RuleLine text="管理员会核对订单、钱包流水、派单记录和客服记录。" />
              <RuleLine text="退款、补偿或驳回都会由后台人工处理。" />
              <RuleLine text="如果需要图片证据，请到客服页联系人工客服补充。" />
              <RuleLine text="恶意投诉或重复提交会影响后续人工处理优先级。" />
            </div>
            <Link href="/support" className="maycat-button-secondary mt-4 block px-4 py-3 text-center text-sm font-black">
              联系人工客服
            </Link>
          </section>

          <section className="maycat-card p-4">
            <h2 className="text-lg font-black text-white">我的投诉记录</h2>
          <div className="mt-4 space-y-3">
            {complaints.length ? (
              complaints.map((item) => (
                  <article key={item.id} className="maycat-case-record text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-black text-white">{item.order.orderNo}</div>
                      <span className={`rounded-dfc-control px-2 py-1 text-xs font-black ${complaintStatusClass(item.status)}`}>
                        {toComplaintStatus(item.status)}
                      </span>
                  </div>
                  <div className="mt-1 text-xs text-dfc-subtext">{item.reason}</div>
                    {item.resolution ? <div className="mt-2 text-xs text-cyan-300">处理结果：{item.resolution}</div> : null}
                  </article>
              ))
            ) : (
                <div className="rounded-dfc-control border border-cyan-300/20 bg-[#050711]/70 px-3 py-4 text-sm text-dfc-subtext">
                  暂无投诉记录。提交后会在这里显示处理状态。
                </div>
            )}
          </div>
          </section>
        </aside>
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

function CaseMetric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-dfc border border-cyan-300/20 bg-[#07111f]/70 p-4 backdrop-blur">
      <div className="text-xs text-dfc-muted">{label}</div>
      <div className="mt-2 text-3xl font-black tabular-nums text-white">{value}</div>
      <div className="mt-1 text-xs text-cyan-100/70">{hint}</div>
    </div>
  );
}

function RuleLine({ text }: { text: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-dfc-warning" />
      <span>{text}</span>
    </div>
  );
}

function toComplaintStatus(status: string) {
  if (status === "PENDING") return "处理中";
  if (status === "RESOLVED") return "已处理";
  if (status === "REJECTED") return "已驳回";
  return status;
}

function complaintStatusClass(status: string) {
  if (status === "RESOLVED") return "bg-dfc-success/10 text-dfc-success";
  if (status === "REJECTED") return "bg-dfc-danger/10 text-dfc-danger";
  return "bg-dfc-warning/10 text-dfc-warning";
}
