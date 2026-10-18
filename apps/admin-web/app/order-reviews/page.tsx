"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "../components";

type Review = { id: string; stars: number; comment: string; hidden: boolean; order: { orderNo: string; customer: { displayName: string }; companion: { displayName: string } | null } };

export default function OrderReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [hours, setHours] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function request(path: string, method = "GET", body?: unknown) {
    const response = await fetch(`/api/admin/${path}`, { method,
      headers: { Authorization: `Bearer ${localStorage.getItem("dfc_admin_token")}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "操作失败");
    return data;
  }
  async function load() {
    const [rows, setting] = await Promise.all([request("order-reviews"), request("order-acceptance-settings")]);
    setReviews(rows); setHours(String(setting.hours));
  }
  async function act(action: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await action(); await load(); setNotice(message); }
    catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(false); }
  }
  useEffect(() => { void act(load, ""); }, []);
  return <AdminShell>
    <h1 className="text-2xl font-black">订单评价与自动验收</h1>
    {error && <p role="alert" className="my-3 text-red-200">{error}</p>}
    {notice && <p role="status" className="my-3">{notice}</p>}
    <section className="admin-panel my-5 space-y-3">
      <label>报完成后自动验收小时数 <input aria-label="自动验收小时数" type="number" step="any" value={hours} onChange={e => setHours(e.target.value)} className="input" /></label>
      <p>默认48小时，由公司代定，可修改。修改后适用于所有待验收订单；有未处理投诉的订单不会自动验收。</p>
      <button className="maycat-button px-4 py-2" disabled={busy || !Number.isFinite(Number(hours)) || Number(hours) <= 0} onClick={() => void act(() => request("order-acceptance-settings", "PATCH", { hours: Number(hours) }), "自动验收时限已保存")}>保存时限</button>
    </section>
    <button disabled={busy} className="maycat-button-secondary px-4 py-2" onClick={() => void act(load, "已刷新")}>刷新评价</button>
    {!busy && !error && !reviews.length && <p className="my-4">暂无评价</p>}
    {reviews.map(review => <article key={review.id} className="admin-panel my-4 space-y-2">
      <p>{review.order.orderNo} · 客户：{review.order.customer.displayName} · 陪玩：{review.order.companion?.displayName || "待核对"}</p>
      <p>{review.stars}星 · {review.hidden ? "已隐藏（不计入前台评分）" : "公开"}</p>
      <p className="whitespace-pre-wrap break-words">{review.comment || "未填写评语"}</p>
      {!review.hidden && <button disabled={busy} className="maycat-button-secondary px-4 py-2" onClick={() => void act(() => request(`order-reviews/${review.id}/hide`, "PATCH"), "评价已隐藏，前台评分已排除")}>隐藏评价</button>}
    </article>)}
  </AdminShell>;
}
