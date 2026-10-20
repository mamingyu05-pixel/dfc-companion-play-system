"use client";

import { useState } from "react";

export function ReviewForm({ orderId, onSubmitted }: { orderId: string; onSubmitted: () => Promise<void> }) {
  const [stars, setStars] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  async function submit() {
    if (busy || !stars || [...comment].length > 200) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/orders/${orderId}/review`, { method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("dfc_customer_token")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ stars: Number(stars), comment }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "评价提交失败");
      setSubmitted(true);
      await onSubmitted();
    } catch (e) { setError(e instanceof Error ? e.message : "评价提交失败，请刷新核对"); }
    finally { setBusy(false); }
  }
  if (submitted) return <p role="status">已评价，感谢反馈。</p>;
  return <form className="my-4 space-y-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <label className="block">服务评分（必填） <select required value={stars} onChange={event => setStars(event.target.value)} className="input">
      <option value="">请选择星级</option>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}星</option>)}
    </select></label>
    <label className="block">一句评价（选填，最多200字）<textarea className="input block w-full" value={comment} onChange={event => setComment(event.target.value)} /></label>
    <p className="text-xs">{[...comment].length}/200字 · 每单只能评价一次</p>
    {error && <p role="alert">{error}</p>}
    <button className="maycat-button px-4 py-2" disabled={busy || !stars || [...comment].length > 200}>{busy ? "正在提交…" : "提交评价"}</button>
  </form>;
}
