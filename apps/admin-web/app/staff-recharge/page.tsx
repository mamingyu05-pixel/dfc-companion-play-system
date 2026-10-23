"use client";

import { useEffect, useState } from "react";
import { AdminShell, SectionHeader } from "../components";
import { adminApi } from "../batch-tools";

type Customer = { id: string; displayName: string; balance: string; platforms: string[] };
const METHODS = [{ value: "WECHAT", label: "微信" }, { value: "ALIPAY", label: "支付宝" }, { value: "BANK", label: "银行卡" }, { value: "OTHER", label: "其他" }];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const newRequestId = () => crypto.randomUUID();

export default function StaffRechargePage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("WECHAT");
  const [note, setNote] = useState("");
  const [screenshot, setScreenshot] = useState("");
  // One id per intended payment: a retry after a timeout replays instead of crediting twice.
  const [requestId, setRequestId] = useState(newRequestId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    const term = query.trim();
    if (!term || customer?.displayName === term) { setResults([]); return; }
    const timer = setTimeout(() => {
      adminApi<Customer[]>(`/api/admin/customers/search?q=${encodeURIComponent(term)}`).then(setResults).catch(e => setError(e.message));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, customer]);

  function readImage(file: File | undefined | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("只能上传图片"); return; }
    if (file.size > MAX_IMAGE_BYTES) { setError("截图不能超过 2MB"); return; }
    const reader = new FileReader();
    reader.onload = () => setScreenshot(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function submit() {
    if (!customer) return;
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) { setError("请填写正确的金额"); return; }
    const label = METHODS.find(m => m.value === method)?.label;
    if (!window.confirm(`给「${customer.displayName}」入账 ¥${Number(amount).toFixed(2)}（${label}）？\n入账后立即到余额，并计入累计充值和会员等级。`)) return;
    setBusy(true); setError(""); setDone("");
    try {
      const result = await adminApi<{ replayed: boolean }>("/api/admin/recharges/staff-record", {
        method: "POST", body: JSON.stringify({ customerId: customer.id, amount, method, note, screenshotUrl: screenshot || undefined, requestId })
      });
      setDone(`${result.replayed ? "这笔之前已经入账过，没有重复入账" : "已入账"}：${customer.displayName} ¥${Number(amount).toFixed(2)}（${label}）`);
      setCustomer(null); setQuery(""); setAmount(""); setNote(""); setScreenshot(""); setRequestId(newRequestId());
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "入账失败"}。如果不确定是否已入账，直接再点一次「确认入账」，系统不会重复入账。`);
    } finally { setBusy(false); }
  }

  return (
    <AdminShell>
      <SectionHeader title="代客充值" eyebrow="Staff Recharge"
        desc="客户把钱转给客服后，在这里替客户入账。和网页充值审核走同一套账：余额、流水、累计充值、会员等级和 KOOK 角色都会更新。" />
      {error ? <p role="alert" className="mb-4 rounded border border-red-300 p-3 text-red-200">{error}</p> : null}
      {done ? <p role="status" className="mb-4 rounded border border-green-300/50 p-3 text-green-200">{done}</p> : null}

      <section className="admin-panel max-w-xl space-y-4">
        <div>
          <label className="mb-1 block text-sm font-black text-white" htmlFor="customer-search">1. 找到客户</label>
          {customer ? (
            <div className="flex items-center justify-between rounded border border-cyan-300/40 p-3">
              <div>
                <div className="font-black text-white">{customer.displayName}</div>
                <div className="text-xs text-dfc-muted">当前余额 ¥{Number(customer.balance).toFixed(2)}{customer.platforms.length ? ` · ${customer.platforms.join(" / ")}` : ""}</div>
              </div>
              <button className="text-xs text-cyan-200" onClick={() => { setCustomer(null); setQuery(""); }}>换一个</button>
            </div>
          ) : (
            <>
              <input id="customer-search" className="input w-full" placeholder="输入昵称、KOOK 昵称或 KOOK ID" value={query} onChange={e => setQuery(e.target.value)} />
              {results.length ? (
                <ul className="mt-2 divide-y divide-cyan-300/10 rounded border border-cyan-300/20">
                  {results.map(r => (
                    <li key={r.id}>
                      <button className="w-full px-3 py-2 text-left hover:bg-cyan-300/10" onClick={() => { setCustomer(r); setQuery(r.displayName); setResults([]); }}>
                        <span className="font-semibold text-white">{r.displayName}</span>
                        <span className="ml-2 text-xs text-dfc-muted">余额 ¥{Number(r.balance).toFixed(2)}{r.platforms.length ? ` · ${r.platforms.join(" / ")}` : ""}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : query.trim() && !customer ? <p className="mt-2 text-xs text-dfc-muted">没有找到。客户还没建档的话，先到「导入 KOOK 成员」导入，或让客户私聊机器人发「首次使用」。</p> : null}
            </>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm font-black text-white" htmlFor="amount">2. 实收金额（元）</label>
          <input id="amount" className="input w-40" inputMode="decimal" placeholder="例如 200" value={amount} onChange={e => setAmount(e.target.value.trim())} />
          <div className="mt-2 flex flex-wrap gap-2">
            {METHODS.map(m => (
              <button key={m.value} onClick={() => setMethod(m.value)}
                className={`rounded border px-3 py-1 text-sm ${method === m.value ? "border-cyan-300 bg-cyan-300/20 text-white" : "border-cyan-300/20 text-dfc-subtext"}`}>{m.label}</button>
            ))}
          </div>
        </div>

        <div>
          <span className="mb-1 block text-sm font-black text-white">3. 转账截图（建议上传，方便对账）</span>
          <div tabIndex={0} onPaste={e => readImage(e.clipboardData.files[0])}
            className="rounded border border-dashed border-cyan-300/40 p-3 text-xs text-dfc-muted focus:border-cyan-300 focus:outline-none">
            {screenshot ? <img src={screenshot} alt="转账截图" className="max-h-48 rounded" /> : "点这里后按 Ctrl+V 粘贴截图，或选择文件："}
            <input type="file" accept="image/*" className="mt-2 block text-xs" onChange={e => readImage(e.target.files?.[0])} />
          </div>
          <input className="input mt-2 w-full" maxLength={200} placeholder="备注（选填），例如：转账单号尾号 1234" value={note} onChange={e => setNote(e.target.value)} />
        </div>

        <button className="w-full rounded border border-cyan-300/60 bg-cyan-300 px-4 py-3 text-base font-black text-slate-950 disabled:opacity-50"
          disabled={busy || !customer || !amount} onClick={() => void submit()}>{busy ? "入账中…" : "确认入账"}</button>
      </section>
    </AdminShell>
  );
}
