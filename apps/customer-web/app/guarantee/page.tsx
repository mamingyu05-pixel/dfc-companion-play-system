"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GUARANTEE_RULES, platformLabel, type GuaranteePackage } from "@dfc/ui";
import { CustomerShell } from "../components";
import { EscrowPromise } from "../escrow";
import { useFixedOrder } from "../use-fixed-order";

type Companion = { id: string; nickname: string; onlineStatus: string };

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
  if (tokenNow() !== token) throw new Error("登录身份已变化，请刷新核对。");
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join("；") : data.message || "操作未完成，请重试");
  return data;
}

export default function GuaranteePage() {
  const [packages, setPackages] = useState<GuaranteePackage[]>([]);
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [balance, setBalance] = useState("");
  const [platform, setPlatform] = useState<"PC" | "MOBILE">("PC");
  const [packageId, setPackageId] = useState("");
  const [companionId, setCompanionId] = useState("");
  const [notes, setNotes] = useState("");
  const order = useFixedOrder("guarantee");
  const { preview, receipt, pending } = order.state;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const busy = loading || order.state.busy;
  const locked = busy || pending || !order.state.connected;
  const error = order.state.error || loadError;

  useEffect(() => {
    let disposed = false;
    setPackages([]); setCompanions([]); setBalance(""); setPackageId(""); setCompanionId(""); setNotes("");
    if (!order.state.subject) { setLoading(false); return; }
    setLoading(true); setLoadError("");
    void (async () => {
      try {
        const [list, people, wallet] = await Promise.all([
          request("/orders/guarantee-packages"), request("/orders/companions/options?game=DELTA_FORCE"), request("/wallet/customer-summary")
        ]);
        if (disposed) return;
        if (!Array.isArray(list) || !Array.isArray(people)) throw new Error("列表返回不完整，请刷新。");
        setPackages(list); setCompanions(people);
        setBalance(String(wallet?.wallet?.availableBalance ?? ""));
        const wanted = new URLSearchParams(window.location.search).get("companionId");
        if (wanted && people.some((c: Companion) => c.id === wanted)) setCompanionId(wanted);
      } catch (e) { if (!disposed) setLoadError(e instanceof Error ? e.message : "加载失败，请刷新"); }
      finally { if (!disposed) setLoading(false); }
    })();
    return () => { disposed = true; };
  }, [order.state.subject]);

  function change(next: () => void) { if (order.change()) next(); }
  async function beginNew() {
    const next = await order.beginNew();
    if (next?.connected && !next.pending && !next.receipt && !next.error) { setPackageId(""); setCompanionId(""); setNotes(""); }
  }
  const visible = packages.filter(p => p.platform === platform);
  const shortfall = preview && balance !== "" && Number(balance) < Number(preview.totalAmount)
    ? (Number(preview.totalAmount) - Number(balance)).toFixed(2) : null;


  return <CustomerShell>
    <h1 className="text-2xl font-black text-white">三角洲保底护航</h1>
    <p className="mt-2 text-sm text-dfc-subtext">按仓库净增结果收费：达到保底才结算给陪玩，钱在此之前由平台托管。</p>
    <div className="mt-4"><EscrowPromise compact /></div>
    <section aria-label="护航规则" className="mt-4 rounded-dfc border border-amber-300/30 bg-amber-300/[0.06] p-4 text-sm">
      <h2 className="font-black text-amber-100">护航规则</h2>
      <ul className="mt-2 space-y-1 text-dfc-subtext">{GUARANTEE_RULES.map(rule => <li key={rule}>· {rule}</li>)}</ul>
    </section>
    {error ? <p role="alert" className="mt-4 rounded-dfc border border-rose-300/30 p-3 text-rose-100">{error}</p> : null}
    <button className="maycat-button-secondary mt-4 px-4 py-2" disabled={order.state.busy} onClick={() => void order.refresh()}>刷新核对原申请</button>
    {pending ? <section role="status" className="mt-4 rounded-dfc border border-amber-300/30 p-4 text-amber-100">
      <p>原{order.state.pendingKind === "package" ? "套餐" : "保底"}申请结果待核对，金额 ¥{preview?.totalAmount}。服务、备注与申请编号已保留，当前不能修改或另建订单。</p>
      <button className="maycat-button-secondary mt-3 px-4 py-2" disabled={order.state.busy} onClick={() => void order.retry()}>用原编号重试并核对</button>
    </section> : null}
    {receipt ? <section role="status" className="maycat-card mt-5 p-5">
      <h2 className="text-lg font-black">原提交回执 · 订单 {receipt.orderNo}</h2>
      <p className="mt-2 font-black">原提交金额 ¥{receipt.totalAmount}</p>
      <p className="mt-2 text-sm text-dfc-subtext">本页保留原订单提交时的确认记录。最新状态、结算与退款请到「我的订单」查看。</p>
      <Link href={`/orders?record=${encodeURIComponent(receipt.id)}`} className="mt-3 inline-block text-sm text-cyan-200 underline">去我的订单</Link>
      <button className="maycat-button-secondary ml-3 mt-3 px-4 py-2" disabled={order.state.busy} onClick={() => void beginNew()}>另下一单</button>
    </section> : <section className="maycat-card mt-5 space-y-4 p-5">
      <div className="flex gap-2" role="radiogroup" aria-label="平台">
        {(["PC", "MOBILE"] as const).map(p => <button key={p} type="button" role="radio" aria-checked={platform === p} disabled={locked}
          className={platform === p ? "maycat-button px-4 py-2" : "maycat-button-secondary px-4 py-2"}
          onClick={() => change(() => { setPlatform(p); setPackageId(""); })}>{platformLabel(p)}</button>)}
      </div>
      {busy && !packages.length ? <p role="status">正在加载档位…</p> : null}
      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="保底档位">
        {visible.map(p => <button key={p.id} type="button" role="radio" aria-checked={packageId === p.id} disabled={locked}
          onClick={() => change(() => setPackageId(p.id))}
          className={`rounded-dfc border p-4 text-left ${packageId === p.id ? "border-cyan-300 bg-cyan-300/10" : "border-cyan-300/20"}`}>
          <div className="text-2xl font-black text-white">{p.targetWan}W</div>
          <div className="mt-1 text-sm text-dfc-subtext">保底净增 {p.targetWan} 万哈夫币</div>
          <div className="mt-2 text-lg font-black text-dfc-gold">¥{p.price}</div>
        </button>)}
      </div>
      {!busy && !visible.length ? <p>该平台暂无可下单档位，请联系客服。</p> : null}
      <label className="block">陪玩（可选）<select aria-label="陪玩" className="maycat-input mt-2 w-full p-3" value={companionId} disabled={locked}
        onChange={e => change(() => setCompanionId(e.target.value))}>
        <option value="">由客服安排</option>
        {companions.map(c => <option key={c.id} value={c.id}>{c.nickname}{c.onlineStatus === "ONLINE" ? " · 在线" : ""}</option>)}
      </select></label>
      <label className="block">备注（可选）<input className="maycat-input mt-2 w-full p-3" maxLength={200} value={notes} disabled={locked}
        placeholder="大区、开打时间、地图偏好" onChange={e => { if (order.canEdit()) setNotes(e.target.value); }} /></label>
      <p className="text-sm text-dfc-subtext">可用余额 ¥{balance || "待核对"}</p>
      {!preview ? <button className="maycat-button px-4 py-3" disabled={locked || !packageId} onClick={() => void order.prepare({ packageId, ...(companionId ? { companionId } : {}) })}>核对金额</button> : <div className="rounded-dfc border border-cyan-300/30 p-4">
        <h3 className="font-black">提交前确认</h3>
        <p className="mt-2">{preview.mode} · 总额 ¥{preview.totalAmount}</p>
        {preview.memberDiscount && preview.originalTotalAmount ? (
          <p className="mt-1 text-sm"><span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand-ink">{preview.memberDiscount.name} · {(Number(preview.memberDiscount.rate) * 10).toFixed(1).replace(/\.0$/, "")} 折</span><span className="ml-2 text-dfc-muted line-through">原价 ¥{preview.originalTotalAmount}</span></p>
        ) : null}
        <p className="mt-2 text-sm text-amber-100">点击后从钱包冻结以上金额。净增达标、你确认验收后才结算给陪玩；未达标可申请客服裁决。</p>
        {shortfall ? <p role="status" className="mt-3 text-amber-100">余额还差 ¥{shortfall}，<Link href="/recharge" className="underline">去充值</Link></p> : null}
        <button className="maycat-button mt-4 px-4 py-3" disabled={locked || shortfall !== null} onClick={() => void order.submit(notes)}>确认提交并冻结 ¥{preview.totalAmount}</button>
        <button className="ml-3 text-sm text-cyan-100 underline" disabled={locked} onClick={() => change(() => undefined)}>返回修改</button>
      </div>}
    </section>}
  </CustomerShell>;
}
