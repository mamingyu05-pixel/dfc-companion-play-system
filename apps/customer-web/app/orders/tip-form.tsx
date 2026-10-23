"use client";

import { useState } from "react";

const QUICK = ["5", "10", "20", "50"];

/** Optional thank-you to the companion, paid from the wallet; it does not change the order's own settlement. */
export function TipForm({ orderId, companionName, tipped, onTipped }: { orderId: string; companionName: string; tipped: string; onTipped: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("10");
  // One id per attempt: a retried tap after an unclear failure pays once.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function send() {
    const value = amount.trim();
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(value) || Number(value) < 1 || Number(value) > 500) { setMessage("小费填 1 到 500 元"); return; }
    if (!window.confirm(`从余额给「${companionName}」小费 ¥${Number(value).toFixed(2)}？`)) return;
    setBusy(true); setMessage("");
    try {
      let token: string | null = null;
      try { token = localStorage.getItem("dfc_customer_token"); } catch { /* handled below */ }
      if (!token) throw new Error("请先登录");
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/tip`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: value, requestId })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join("；") : data.message || "没有成功，请重试");
      setRequestId(crypto.randomUUID());
      setOpen(false);
      setMessage(`谢谢！小费 ¥${Number(value).toFixed(2)} 已送达。`);
      onTipped();
    } catch (e) {
      setMessage(`${e instanceof Error ? e.message : "没有成功"}。可以再点一次，不会重复扣款。`);
    } finally { setBusy(false); }
  }

  return (
    <div className="mb-3 text-sm">
      {Number(tipped) > 0 ? <p className="mb-1 text-dfc-subtext">已给小费 ¥{tipped}</p> : null}
      {!open ? (
        <button type="button" className="maycat-button-secondary px-3 py-1.5 text-sm" onClick={() => setOpen(true)}>给陪玩小费</button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {QUICK.map(q => (
            <button key={q} type="button" onClick={() => setAmount(q)}
              className={`maycat-choice px-3 py-1.5 ${amount === q ? "maycat-choice-active" : ""}`}>¥{q}</button>
          ))}
          <input aria-label="小费金额" inputMode="decimal" className="maycat-input w-24 p-1.5" value={amount} onChange={e => setAmount(e.target.value)} />
          <button type="button" className="maycat-button px-3 py-1.5" disabled={busy} onClick={() => void send()}>{busy ? "正在送出…" : "送出"}</button>
          <button type="button" className="text-cyan-200 underline" disabled={busy} onClick={() => setOpen(false)}>取消</button>
        </div>
      )}
      {message ? <p role="status" className="mt-1 text-dfc-subtext">{message}</p> : null}
    </div>
  );
}
