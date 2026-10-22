"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CustomerShell } from "../components";
import { EscrowProgress, EscrowPromise } from "../escrow";
import DemandGuide from "./demand-guide";
import { createOrderClient, type OrderView, type Selection } from "./order-client";
import { balanceShortfall, onlineLabel, sortedCompanions } from "./order-entry";

import { createSelectionDraft } from "./selection-draft";

const initial: OrderView = { busy: false, connected: false, pending: false, error: "", companions: [], preview: null, receipt: null, orders: [], availableBalance: "" };
const statusLabels: Record<string, string> = { PAID: "待派单", ASSIGNED: "待接单", ACCEPTED: "已接单", IN_PROGRESS: "服务中", AWAITING_ACCEPTANCE: "待验收", COMPLETED: "已完成", DISPUTED: "争议处理中", REFUNDED: "已退款", CANCELLED: "已取消" };
const nextSteps: Record<string, string> = { PAID: "订单已创建，等待派单；请勿重复提交。", ASSIGNED: "已派单，等待陪玩接受。", ACCEPTED: "陪玩已接受，等待开始服务。", IN_PROGRESS: "服务进行中，结束后核对服务与时长。", AWAITING_ACCEPTANCE: "请到我的订单查看自动验收倒计时并确认验收；有异议请在验收前提交投诉，未处理投诉会阻止自动验收。", COMPLETED: "订单已完成，可到我的订单打星写评价，每单只能评价一次。", DISPUTED: "请保留记录，等待管理员处理。", REFUNDED: "请到钱包核对退款记录。", CANCELLED: "此订单已取消，资金状态请核对钱包记录。" };

export default function OrderPage() {
  const client = useRef<ReturnType<typeof createOrderClient> | null>(null);
  const closed = useRef(false);
  const entryApplied = useRef(false);
  const draftSubject = useRef<string | null>(null);
  const draft = useRef<ReturnType<typeof createSelectionDraft> | null>(null);
  const [entryMessage, setEntryMessage] = useState("");
  const [view, setView] = useState<OrderView>(initial);
  const [selection, setSelection] = useState<Selection>({ companionId: "", mode: "烽火地带", hours: "1" });
  const [kookUrl, setKookUrl] = useState("");
  const [showDemand, setShowDemand] = useState(false);
  useEffect(() => {
    closed.current = false;
    let draftStorage: Storage | null = null;
    try { draftStorage = window.sessionStorage; } catch { /* Current inputs remain usable. */ }
    draft.current = createSelectionDraft({ storage: draftStorage, scope: window.location.origin });
    client.current = createOrderClient({ fetcher: fetch, storage: localStorage, getToken: () => localStorage.getItem("dfc_customer_token"), makeRequestId: () => crypto.randomUUID(), scope: window.location.origin });
    void perform(() => client.current!.refresh());
    return () => { closed.current = true; };
  }, []);
  useEffect(() => {
    let disposed = false;
    void fetch("/api/auth/public-config").then(r => r.ok ? r.json() : null)
      .then(data => { if (!disposed) setKookUrl(data?.support?.orderKookUrl?.trim() || ""); }).catch(() => {});
    return () => { disposed = true; };
  }, []);
  function setDraftSubject(subject: string | null) {
    if (draftSubject.current === subject) return;
    draftSubject.current = subject;
    entryApplied.current = false;
    setSelection({ companionId: "", mode: "烽火地带", hours: "1" });
    setEntryMessage("");
  }
  async function perform(action: () => Promise<OrderView>, requiresSubject = false) {
    if (!client.current || client.current.state().busy) return;
    const activeClient = client.current;
    const before = activeClient.customerSubject();
    if (requiresSubject && (!before || before !== draftSubject.current)) {
      setDraftSubject(null);
      setView({ ...initial, error: "登录身份已变化，请刷新核对后再选择。" });
      return;
    }
    setDraftSubject(before);
    setView(current => before ? { ...current, busy: true } : { ...initial, busy: true });
    let next = await action();
    if (closed.current || client.current !== activeClient) return;
    const subject = client.current.customerSubject();
    if (before && subject !== before) next = client.current.cancelPreview();
    setDraftSubject(subject);
    if (!subject) { setView({ ...initial, error: next.error }); return; }
    setView(next);
    if (next.pending || next.receipt) {
      draft.current?.clear(subject);
      entryApplied.current = true;
      setEntryMessage("");
      return;
    }
    if (!entryApplied.current) {
      const restored = draft.current?.restore(subject, next, window.location.search);
      if (restored) {
        entryApplied.current = true;
        setSelection(restored.selection);
        setEntryMessage(restored.message);
      }
    }
  }
  function choose(next: Selection) {
    if (view.busy || view.pending) return;
    const subject = client.current?.customerSubject() ?? null;
    if (!subject || subject !== draftSubject.current) {
      setDraftSubject(null);
      if (client.current) setView({ ...initial, error: "登录身份已变化，请刷新核对后再选择。" });
      return;
    }
    setSelection(next);
    entryApplied.current = true;
    setEntryMessage(draft.current?.save(subject, next) || "");
    if (client.current) setView(client.current.cancelPreview());
  }
  const selected = view.companions.find(companion => companion.id === selection.companionId);
  const shortfall = view.preview ? balanceShortfall(view.availableBalance, view.preview.totalAmount) : null;
  if (showDemand) return <><button className="maycat-button m-4 px-4 py-2" onClick={() => setShowDemand(false)}>返回直接下单</button><DemandGuide /></>;
  return <CustomerShell>
    <h1 className="text-2xl font-black text-white">选陪玩，核对后下单</h1>
    <p className="mt-3 text-sm text-dfc-subtext">使用已登录客户账号与钱包余额。这里只下正式订单；先试音或预约请生成需求，沟通确认后再下单。</p>
    {view.error ? <p role="alert" className="mt-4 rounded-dfc border border-rose-300/30 p-3 text-rose-100">{view.error}</p> : null}
    {!view.connected ? <p role="status" className="mt-4">{view.busy ? "正在核验客户身份与订单服务…" : "订单服务待连接，当前不能提交。请检查登录或联系管理员。"}</p> : null}
    {view.pending ? <p role="status" className="mt-4 text-amber-100">原申请结果待核对，已暂停再次提交。请刷新核对；仍不明确时联系管理员处理。</p> : null}
    <div className="mt-4 flex flex-wrap gap-3">
      <button className="maycat-button-secondary px-4 py-2" disabled={view.busy} onClick={() => void perform(() => client.current!.refresh())}>{view.busy ? "正在处理…" : "刷新核对"}</button>
      <Link className="maycat-button-secondary px-4 py-2" href="/orders">我的订单与验收</Link>
      <Link className="maycat-button-secondary px-4 py-2" href="/recharge">钱包与充值</Link>
      <Link className="maycat-button-secondary px-4 py-2" href="/support">让客服帮我下单</Link>
      <Link className="maycat-button-secondary px-4 py-2" href="/guarantee">保底护航：达标才付</Link>
      <button className="text-sm text-cyan-100 underline" disabled={view.busy || view.pending} onClick={() => setShowDemand(true)}>先试音 / 预约：只生成需求</button>
    </div>
    {view.receipt ? <section role="status" className="maycat-card mt-5 p-5">
      <h2 className="text-lg font-black">订单 {view.receipt.orderNo}</h2>
      <p className="mt-2">{statusLabels[view.receipt.status] || "状态待核对"} · ¥{Number(view.receipt.totalAmount).toFixed(2)}</p>
      <EscrowProgress order={view.receipt} />
      <p className="mt-2">{nextSteps[view.receipt.status] || "请刷新核对；仍不明确时联系管理员，不重复下单。"}</p>
      <Link href={`/orders?record=${encodeURIComponent(view.receipt.id)}`} className="mt-3 inline-block text-sm text-cyan-200 underline">查看本单记录与时间线</Link>
      {kookUrl && !["COMPLETED", "REFUNDED", "CANCELLED"].includes(view.receipt.status) ? <a href={kookUrl} target="_blank" rel="noopener noreferrer" className="mt-3 block text-sm text-cyan-200 underline">去 KOOK 找陪玩</a> : null}
      <button className="maycat-button-secondary mt-4 px-4 py-2" disabled={view.busy || view.pending} onClick={() => {
        const subject = client.current!.customerSubject();
        if (!subject || subject !== draftSubject.current) {
          setDraftSubject(null);
          setView({ ...initial, error: "登录身份已变化，请刷新核对后再选择。" });
          return;
        }
        setDraftSubject(subject);
        setSelection({ companionId: "", mode: "烽火地带", hours: "1" });
        setEntryMessage(""); entryApplied.current = true;
        if (subject) draft.current?.clear(subject);
        setView(client.current!.beginNew());
      }}>另选服务</button>
    </section> : <section className="maycat-card mt-5 space-y-4 p-5">
      <h2 className="text-lg font-black">三角洲行动</h2>
      <label className="block">陪玩<select aria-label="陪玩" className="maycat-input mt-2 w-full p-3" value={selection.companionId} disabled={view.busy || view.pending || !view.connected} onChange={e => choose({ ...selection, companionId: e.target.value })}><option value="">请选择陪玩</option>{sortedCompanions(view.companions).map(companion => <option key={companion.id} value={companion.id}>{companion.nickname} · {onlineLabel(companion.onlineStatus)} · 参考 ¥{companion.pricePerHour}/时</option>)}</select></label>
      {entryMessage ? <p role="status">{entryMessage}</p> : null}
      {selected && selected.onlineStatus !== "ONLINE" ? <p role="status">这位陪玩现在不在线，接单可能较慢，也可以让客服帮你安排</p> : null}
      {view.connected && !view.busy && !view.companions.length ? <p>暂未查到可选陪玩，请刷新或联系管理员。</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label>模式<select aria-label="模式" className="maycat-input mt-2 w-full p-3" value={selection.mode} disabled={view.busy || view.pending} onChange={e => choose({ ...selection, mode: e.target.value })}><option>烽火地带</option><option>全面战场</option></select></label>
        <label>时长<select aria-label="时长" className="maycat-input mt-2 w-full p-3" value={selection.hours} disabled={view.busy || view.pending} onChange={e => choose({ ...selection, hours: e.target.value })}>{[1,2,3,4].map(hours => <option key={hours} value={hours}>{hours} 小时</option>)}</select></label>
      </div>
      <p className="text-sm text-dfc-subtext">无需再填账号、游戏和个人资料。可用余额 ¥{view.availableBalance || "待核对"}；最终金额以核对区为准。</p>
      {!view.preview ? <button className="maycat-button px-4 py-3" disabled={!selected || !view.connected || view.busy || view.pending} onClick={() => void perform(() => client.current!.prepare(selection), true)}>核对订单金额</button> : <div className="rounded-dfc border border-cyan-300/30 p-4">
        <h3 className="font-black">提交前确认</h3>
        <div className="mt-3"><EscrowPromise /></div>
        <p className="mt-2">{selected?.nickname} · {view.preview.mode} · {view.preview.hours} 小时</p>
        <p>单价 ¥{view.preview.unitPrice}/时 · 总额 ¥{view.preview.totalAmount}</p>
        <p className="mt-2 text-sm text-amber-100">点击下方按钮会创建正式订单，并从钱包余额冻结以上金额。不是充值或微信支付；试音须另行安排。价格变化时会停止提交，要求重新核对。</p>
        {shortfall ? <p role="status" className="mt-3 text-amber-100">余额还差 ¥{shortfall}，先去充值 <Link href="/recharge" className="underline">去充值</Link></p> : null}
        <button className="maycat-button mt-4 px-4 py-3" disabled={view.busy || view.pending || shortfall !== null} onClick={() => { if (shortfall === null) void perform(() => client.current!.submit(), true); }}>确认提交并冻结 ¥{view.preview.totalAmount}</button>
        <button className="ml-3 text-sm text-cyan-100 underline" disabled={view.busy} onClick={() => setView(client.current!.cancelPreview())}>返回修改</button>
      </div>}
    </section>}
  </CustomerShell>;
}
