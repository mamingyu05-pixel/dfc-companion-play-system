"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CustomerShell } from "../components";
import { EscrowProgress, EscrowPromise } from "../escrow";

type ServicePackage = { id: string; category: string; name: string; description: string | null; price: string };
type Companion = { id: string; nickname: string; onlineStatus: string };
type Preview = { totalAmount: string; mode: string; packageId: string; companionId: string | null;
  originalTotalAmount?: string; memberDiscount?: { level: number; name: string; rate: string } | null };
type Receipt = { id: string; orderNo: string; status: string; totalAmount: string };

function tokenNow() { try { return localStorage.getItem("dfc_customer_token"); } catch { return null; } }

async function request(path: string, init: { method?: string; body?: unknown } = {}) {
  const token = tokenNow();
  if (!token) throw new Error("请先登录客户账号");
  const response = await fetch(`/api${path}`, {
    method: init.method ?? "GET", cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join("；") : data.message || "操作未完成，请重试");
  return data;
}

// Fixed-price services (指定大红, 跑刀, 3x3 保险箱...) staff list in admin. Same escrow as every order.
export default function PackagesPage() {
  const [packages, setPackages] = useState<ServicePackage[]>([]);
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [balance, setBalance] = useState("");
  const [packageId, setPackageId] = useState("");
  const [companionId, setCompanionId] = useState("");
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  // One id per confirmed quote: resubmitting after an unclear failure replays the same order instead of freezing twice.
  const [requestId, setRequestId] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const [list, people, wallet] = await Promise.all([
          request("/orders/service-packages"), request("/orders/companions/options?game=DELTA_FORCE"), request("/wallet/customer-summary")
        ]);
        if (!Array.isArray(list) || !Array.isArray(people)) throw new Error("列表返回不完整，请刷新。");
        setPackages(list); setCompanions(people);
        setBalance(String(wallet?.wallet?.availableBalance ?? ""));
        const wanted = new URLSearchParams(window.location.search).get("packageId");
        if (wanted && list.some((p: ServicePackage) => p.id === wanted)) setPackageId(wanted);
      } catch (e) { setError(e instanceof Error ? e.message : "加载失败，请刷新"); }
      finally { setBusy(false); }
    })();
  }, []);

  function change(next: () => void) { next(); setPreview(null); setRequestId(""); setError(""); }
  const categories = [...new Set(packages.map(p => p.category))];
  const shortfall = preview && balance !== "" && Number(balance) < Number(preview.totalAmount)
    ? (Number(preview.totalAmount) - Number(balance)).toFixed(2) : null;

  async function quote() {
    setBusy(true); setError("");
    try {
      setPreview(await request("/orders/package/preview", { method: "POST", body: { packageId, ...(companionId ? { companionId } : {}) } }));
      setRequestId(crypto.randomUUID());
    } catch (e) { setError(e instanceof Error ? e.message : "报价失败"); }
    finally { setBusy(false); }
  }
  async function submit() {
    if (!preview || !requestId) return;
    setBusy(true); setError("");
    try {
      setReceipt(await request("/orders/package", { method: "POST", body: {
        requestId, packageId: preview.packageId, ...(preview.companionId ? { companionId: preview.companionId } : {}),
        expectedTotalAmount: preview.totalAmount, ...(notes.trim() ? { notes: notes.trim() } : {})
      } }));
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "提交失败"}。可再次点击提交核对，同一次确认不会重复冻结。`);
    } finally { setBusy(false); }
  }

  return <CustomerShell>
    <div className="dfc-title">
      <h1>套餐服务</h1>
      <p>一口价套餐：指定大红、跑刀、保险箱任务等。钱先由平台托管，交付后你确认验收，才结算给陪玩。</p>
    </div>
    <div className="mt-4"><EscrowPromise compact /></div>
    {error ? <p role="alert" className="mt-4 rounded-dfc border border-rose-300/30 p-3 text-rose-100">{error}</p> : null}
    {receipt ? <section role="status" className="maycat-card mt-5 p-5">
      <h2 className="text-lg font-black">订单 {receipt.orderNo} 已提交</h2>
      <EscrowProgress order={receipt} />
      <p className="text-sm text-dfc-subtext">客服会尽快派单，陪玩交付后在「我的订单」里确认验收。</p>
      <Link href={`/orders?record=${encodeURIComponent(receipt.id)}`} className="mt-3 inline-block text-sm text-cyan-200 underline">去我的订单</Link>
    </section> : <section className="maycat-card mt-5 space-y-5 p-5">
      {busy && !packages.length ? <p role="status">正在加载套餐…</p> : null}
      {!busy && !packages.length ? <p>暂时没有上架的套餐，可以在客服频道说需求，客服为你报价。</p> : null}
      {categories.map(category => (
        <div key={category}>
          <h2 className="mb-2 text-sm font-black text-dfc-muted">{category}</h2>
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label={category}>
            {packages.filter(p => p.category === category).map(p => (
              <button key={p.id} type="button" role="radio" aria-checked={packageId === p.id} onClick={() => change(() => setPackageId(p.id))}
                className={`maycat-choice p-4 text-left ${packageId === p.id ? "maycat-choice-active" : ""}`}>
                <div className="text-base font-black text-white">{p.name}</div>
                {p.description ? <div className="mt-1 text-sm text-dfc-subtext">{p.description}</div> : null}
                <div className="mt-2 text-lg font-black text-dfc-gold">¥{p.price}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
      <label className="block">陪玩（可选）<select aria-label="陪玩" className="maycat-input mt-2 w-full p-3" value={companionId}
        onChange={e => change(() => setCompanionId(e.target.value))}>
        <option value="">由客服安排</option>
        {companions.map(c => <option key={c.id} value={c.id}>{c.nickname}{c.onlineStatus === "ONLINE" ? " · 在线" : ""}</option>)}
      </select></label>
      <label className="block">备注（可选）<input className="maycat-input mt-2 w-full p-3" maxLength={200} value={notes}
        placeholder="大区、开打时间、指定物资" onChange={e => setNotes(e.target.value)} /></label>
      <p className="text-sm text-dfc-subtext">可用余额 ¥{balance || "待核对"}</p>
      {!preview ? <button className="maycat-button px-4 py-3" disabled={busy || !packageId} onClick={() => void quote()}>核对金额</button> : <div className="rounded-dfc border border-cyan-300/30 p-4">
        <h3 className="font-black">提交前确认</h3>
        <p className="mt-2">{preview.mode} · 总额 ¥{preview.totalAmount}</p>
        {preview.memberDiscount && preview.originalTotalAmount ? (
          <p className="mt-1 text-sm"><span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand-ink">{preview.memberDiscount.name} · {(Number(preview.memberDiscount.rate) * 10).toFixed(1).replace(/\.0$/, "")} 折</span><span className="ml-2 text-dfc-muted line-through">原价 ¥{preview.originalTotalAmount}</span></p>
        ) : null}
        <p className="mt-2 text-sm text-amber-100">点击后从钱包冻结以上金额。交付后你确认验收，才结算给陪玩；有问题可在验收前投诉。</p>
        {shortfall ? <p role="status" className="mt-3 text-amber-100">余额还差 ¥{shortfall}，<Link href="/recharge" className="underline">去充值</Link></p> : null}
        <button className="maycat-button mt-4 px-4 py-3" disabled={busy || shortfall !== null} onClick={() => void submit()}>确认提交并冻结 ¥{preview.totalAmount}</button>
        <button className="ml-3 text-sm text-cyan-100 underline" disabled={busy} onClick={() => change(() => undefined)}>返回修改</button>
      </div>}
    </section>}
  </CustomerShell>;
}
