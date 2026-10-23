"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ActionButton, CompanionShell, MetricCard, OrderCard, SectionHeader, StatusBadge } from "../components";

type Order = {
  id: string;
  orderNo: string;
  game?: string;
  mode: string;
  hours: string;
  unitPrice?: string;
  totalAmount: string;
  status: string;
  dispatchVersion?: number;
  customer?: { displayName: string };
};

type DraftOrder = {
  id: string;
  draftNo: string;
  sourcePlatform: string;
  customerDisplayName: string;
  customerContact?: string | null;
  game: string;
  mode: string;
  hours?: string | null;
  priceTier: string;
  estimatedPricePerHour: string;
  budgetAmount?: string | null;
  note?: string | null;
  status: string;
  candidatesCount: number;
  selectedForMe: boolean;
  canApply: boolean;
  currentCandidate?: { id: string; status: string; note?: string | null; createdAt: string } | null;
  selectedCompanion?: { id: string; displayName: string; email: string } | null;
  convertedOrder?: { id: string; orderNo: string; status: string } | null;
  updatedAt: string;
};

const activeOrderStatuses = new Set(["ACCEPTED", "IN_PROGRESS"]);

export default function AvailableOrdersPage() {
  const [availableOrders, setAvailableOrders] = useState<Order[]>([]);
  const [myOrders, setMyOrders] = useState<Order[]>([]);
  const [drafts, setDrafts] = useState<DraftOrder[]>([]);
  const [declineReasons, setDeclineReasons] = useState<Record<string, string>>({});
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [loadingAction, setLoadingAction] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const activeAction = useRef(false);
  const queueLoadVersion = useRef(0);
  const [uncertainIds, setUncertainIds] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const [newOrderNotice, setNewOrderNotice] = useState("");
  const knownFormalIds = useRef<Set<string> | null>(null);
  const autoBusy = useRef(false);
  const uncertainRef = useRef(uncertainIds);
  uncertainRef.current = uncertainIds;
  const autoRefresh = useRef<() => Promise<void>>(async () => {});

  async function loadQueues(automatic = false) {
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) return;
    const version = ++queueLoadVersion.current;
    const headers = { Authorization: `Bearer ${token}` };
    const [availableResponse, myResponse, draftResponse] = await Promise.all([
      fetch("/api/orders/companion/available", { headers, cache: "no-store" }),
      fetch("/api/orders/companion/my", { headers, cache: "no-store" }),
      fetch("/api/orders/companion/drafts", { headers, cache: "no-store" })
    ]);

    if (!availableResponse.ok) throw new Error("无法加载正式可接订单");
    if (!myResponse.ok) throw new Error("无法加载我的订单");
    if (!draftResponse.ok) throw new Error("无法加载派单草稿");

    const [available, mine, draftList] = await Promise.all([availableResponse.json(), myResponse.json(), draftResponse.json()]);
    if (![available, mine, draftList].every(Array.isArray)) throw new Error("订单列表返回异常，请刷新核对");
    if (version !== queueLoadVersion.current) return;
    if (automatic && (document.visibilityState !== "visible" || activeAction.current || uncertainRef.current.length)) return;
    const formalIds = new Set<string>((available as Order[]).filter(order => !(mine as Order[]).some(row => row.id === order.id && row.status !== "ASSIGNED")).map(order => order.id));
    const added = knownFormalIds.current === null ? 0 : [...formalIds].filter(id => !knownFormalIds.current!.has(id)).length;
    knownFormalIds.current = formalIds;
    if (added) setNewOrderNotice(`有 ${added} 笔新订单可接，请查看正式可接订单。`);
    setAvailableOrders(available as Order[]);
    setMyOrders(mine as Order[]);
    setDrafts(draftList as DraftOrder[]);
    if (!automatic) setUncertainIds([]);
  }

  async function refreshQueues() {
    if (activeAction.current || refreshing) return;
    activeAction.current = true;
    setRefreshing(true);
    try { await loadQueues(); setError(""); }
    catch { setError("列表暂时无法刷新，已保留原操作信息，请稍后再核对"); }
    finally { activeAction.current = false; setRefreshing(false); }
  }

  useEffect(() => {
    void loadQueues().catch((err: Error) => setError(err.message || "无法加载接单数据"));
  }, []);

  autoRefresh.current = async () => {
    if (document.visibilityState !== "visible" || activeAction.current || autoBusy.current || uncertainRef.current.length) return;
    autoBusy.current = true;
    try { await loadQueues(true); }
    catch { setError(current => current || "自动刷新失败，已保留当前列表，请点刷新核对。"); }
    finally { autoBusy.current = false; }
  };
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => { if (timer !== undefined) clearInterval(timer); timer = undefined; };
    const sync = () => {
      stop();
      if (document.visibilityState === "visible") timer = setInterval(() => void autoRefresh.current(), 20_000);
      else queueLoadVersion.current++;
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => { stop(); queueLoadVersion.current++; document.removeEventListener("visibilitychange", sync); };
  }, []);

  async function patchOrder(orderId: string, action: "accept" | "start" | "complete" | "decline", successMessage: string) {
    if (activeAction.current || uncertainIds.includes(orderId)) return;
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) return;
    const previous = availableOrders.find(o => o.id === orderId) ?? myOrders.find(o => o.id === orderId);
    if (!previous) return;
    activeAction.current = true;
    queueLoadVersion.current++;
    let committed = false;
    setError("");
    setStatus("");
    setLoadingAction(`${action}:${orderId}`);
    try {
      const response = await fetch(`/api/orders/${orderId}/${action}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ dispatchVersion: (availableOrders.find(o => o.id === orderId) ?? myOrders.find(o => o.id === orderId))?.dispatchVersion, ...(action === "decline" ? { reason: declineReasons[orderId]?.trim() } : {}) })
      });
      const data = (await response.json().catch(() => ({}))) as Partial<Order> & { message?: string | string[] };
      if (!response.ok) {
        const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
        throw new Error(companionActionError(message));
      }
      const expected = { accept: "ACCEPTED", start: "IN_PROGRESS", complete: "AWAITING_ACCEPTANCE", decline: "PAID" }[action];
      if (data.id !== orderId || data.status !== expected) throw new Error("未收到本笔订单的有效回执");
      committed = true;
      const updated = { ...previous, ...data } as Order;
      setAvailableOrders(current => current.filter(row => row.id !== orderId));
      setMyOrders(current => action === "decline" ? current.filter(row => row.id !== orderId)
        : [...current.filter(row => row.id !== orderId), updated]);
      setStatus(`订单 ${previous.orderNo}：${successMessage}`);
      await loadQueues();
    } catch (err) {
      if (!committed) setUncertainIds(current => [...current, orderId]);
      setError(committed ? "本笔操作已成功，列表暂未刷新。请点“刷新核对”，不要重复点击原操作。"
        : `本笔结果待核对，请点“刷新核对”后再操作。${err instanceof Error ? err.message : "网络暂时不可用"}`);
    } finally {
      activeAction.current = false;
      setLoadingAction("");
    }
  }

  async function applyDraft(draftId: string) {
    const key = `draft:${draftId}`;
    if (activeAction.current || uncertainIds.includes(key)) return;
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) return;
    activeAction.current = true;
    queueLoadVersion.current++;
    let committed = false;
    setError("");
    setStatus("");
    setLoadingAction(`apply:${draftId}`);
    try {
      const response = await fetch(`/api/orders/companion/drafts/${draftId}/apply`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ note: draftNotes[draftId]?.trim() })
      });
      const data = (await response.json().catch(() => ({}))) as { id?: string; draftId?: string; message?: string | string[] };
      if (!response.ok) {
        const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
        throw new Error(companionActionError(message));
      }
      if (!data.id || data.draftId !== draftId) throw new Error("未收到本笔报名的有效回执");
      committed = true;
      setDrafts(current => current.map(draft => draft.id === draftId ? { ...draft, canApply: false } : draft));
      setStatus(`需求 ${drafts.find(draft => draft.id === draftId)?.draftNo || draftId}：报名已提交，等待客服或客户确认。正式订单仍需点击接单。`);
      setDraftNotes((current) => ({ ...current, [draftId]: "" }));
      await loadQueues();
    } catch (err) {
      if (!committed) setUncertainIds(current => [...current, key]);
      setError(committed ? "报名已提交，列表暂未刷新。请点“刷新核对”，不要重复报名。"
        : `报名结果待核对，备注已保留。请点“刷新核对”后再操作。${err instanceof Error ? err.message : "网络暂时不可用"}`);
    } finally {
      activeAction.current = false;
      setLoadingAction("");
    }
  }

  const activeOrders = useMemo(() => myOrders.filter((order) => activeOrderStatuses.has(order.status)), [myOrders]);
  const formalOrders = useMemo(() => availableOrders.filter(order => !myOrders.some(mine => mine.id === order.id && mine.status !== "ASSIGNED")), [availableOrders, myOrders]);
  const assignedNeedingCheck = myOrders.filter(order => order.status === "ASSIGNED" && !availableOrders.some(available => available.id === order.id));
  const stats = useMemo(() => {
    const amount = formalOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
    const hours = formalOrders.reduce((sum, order) => sum + Number(order.hours || 0), 0);
    return { amount, hours };
  }, [formalOrders]);

  return (
    <CompanionShell>
      <SectionHeader
        eyebrow="ORDER QUEUE"
        title="接单大厅"
        desc="正式订单只需点一次接单，成功后会显示订单号和下一步。招募报名与正式接单分开，备注选填；遇到结果不明先刷新核对。"
      />

      {newOrderNotice ? <p role="status" className="mt-4 text-sm text-dfc-success">{newOrderNotice}</p> : null}
      <section className="mt-5 grid gap-4 md:grid-cols-4">
        <MetricCard label="进行中" value={String(activeOrders.length)} hint="已接 / 服务中订单" tone="green" />
        <MetricCard label="派单草稿" value={String(drafts.length)} hint="AI / 人工派单" />
        <MetricCard label="正式可接" value={String(formalOrders.length)} hint="指定给你或开放抢单的订单" />
        <MetricCard label="队列金额" value={`¥${formatMoney(String(stats.amount))}`} hint="正式可接订单合计" tone="gold" />
      </section>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}
      <div className="mt-4"><ActionButton tone="secondary" disabled={refreshing || Boolean(loadingAction)} onClick={() => void refreshQueues()}>{refreshing ? "正在刷新…" : "刷新核对"}</ActionButton></div>

      <section className="mt-7">
        <SectionHeader title="我的进行中订单" desc="接单后会留在这里，按顺序开始服务、完成订单。" />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {activeOrders.length ? (
            activeOrders.map((order) => (
              <div key={order.id}><OrderCard
                key={order.id}
                order={toOrderCard(order)}
                action={nextOrderAction(order.status)?.label}
                disabled={refreshing || Boolean(loadingAction) || uncertainIds.includes(order.id)}
                onAction={() => {
                  const next = nextOrderAction(order.status);
                  if (next) void patchOrder(order.id, next.action, next.message);
                }}
              />
              </div>
            ))
          ) : (
            <EmptyState>暂无进行中订单。</EmptyState>
          )}
        </div>
      </section>

      {assignedNeedingCheck.length ? <div role="status" className="mt-4 text-sm text-dfc-warning">{assignedNeedingCheck.map(order => `订单 ${order.orderNo}`).join("、")} 当前未列入可接队列，请刷新核对；仍有异常联系管理员，不重复接单。</div> : null}

      <section className="mt-8">
        <SectionHeader title="正式可接订单" desc="只有客服已经指定给你，或平台开放给陪玩的正式订单会显示在这里。" />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {formalOrders.length ? (
            formalOrders.map((order) => (
              <div key={order.id}><OrderCard
                key={order.id}
                order={toOrderCard(order)}
                action="接单"
                disabled={refreshing || Boolean(loadingAction) || uncertainIds.includes(order.id)}
                onAction={() => void patchOrder(order.id, "accept", "接单成功，订单已进入我的进行中订单。")}
              />
              {myOrders.some(mine => mine.id === order.id && mine.status === "ASSIGNED") ? <details className="mt-3"><summary className="cursor-pointer text-xs text-dfc-muted">无法接单？填写原因退回</summary><div className="mt-2 flex gap-2"><input className="input" placeholder="拒接原因（必填）" value={declineReasons[order.id] || ""} onChange={e => setDeclineReasons(current => ({ ...current, [order.id]: e.target.value }))} /><button disabled={!declineReasons[order.id]?.trim() || refreshing || !!loadingAction || uncertainIds.includes(order.id)} className="shrink-0 text-sm text-rose-300 disabled:opacity-40" onClick={() => void patchOrder(order.id, "decline", "已退回客服待办，等待重新分配。")}>拒接并退回</button></div></details> : null}</div>
            ))
          ) : (
            <EmptyState>暂无正式可接订单。</EmptyState>
          )}
        </div>
      </section>

      <section className="mt-8">
        <SectionHeader title="招募需求（报名不等于接单）" desc="频道 Bot 发出的派单会同步到这里。报名信息会写入后台，客服再给老板确认最终人选。" />
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {drafts.length ? drafts.map((draft) => (
            <article key={draft.id} className="companion-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-black text-white">{draft.draftNo}</h2>
                  <p className="mt-1 text-sm text-dfc-subtext">
                    {gameLabel(draft.game)} / {draft.mode || "未填写模式"} / {draft.hours ?? "-"} 小时
                  </p>
                  <p className="mt-1 text-xs text-dfc-muted">
                    {draft.sourcePlatform} · {draft.customerDisplayName}{draft.customerContact ? ` / ${draft.customerContact}` : ""}
                  </p>
                </div>
                <StatusBadge tone={draftStatusTone(draft.status)}>{draftStatusText(draft.status)}</StatusBadge>
              </div>

              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <InfoCell label="参考报价" value={`¥${formatMoney(draft.estimatedPricePerHour)}/h`} />
                <InfoCell label="报名人数" value={`${draft.candidatesCount} 人`} />
                <InfoCell label="预算" value={draft.budgetAmount ? `¥${formatMoney(draft.budgetAmount)}` : "按后台报价"} />
              </div>

              {draft.note ? <p className="mt-4 rounded-dfc-control border border-cyan-300/15 bg-cyan-300/5 p-3 text-xs leading-5 text-dfc-subtext">{draft.note}</p> : null}
              {draft.currentCandidate ? (
                <p className="mt-4 rounded-dfc-control border border-dfc-success/35 bg-dfc-success/10 p-3 text-xs text-dfc-success">
                  你已报名：{draft.currentCandidate.note || "等待客服或老板确认。"}
                </p>
              ) : null}

              <details className="mt-3"><summary className="cursor-pointer text-sm text-cyan-100">补充报名备注（选填）</summary>
              <textarea
                className="mt-4 min-h-24 w-full rounded-dfc-control border border-cyan-300/20 bg-[#07111f] px-3 py-2 text-sm text-white outline-none transition placeholder:text-dfc-muted focus:border-cyan-300/55"
                placeholder="报名备注（选填）：可服务时间、打法或其他说明"
                value={draftNotes[draft.id] ?? ""}
                onChange={(event) => setDraftNotes((current) => ({ ...current, [draft.id]: event.target.value }))}
                disabled={!draft.canApply}
              />
              </details>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <ActionButton
                  onClick={() => void applyDraft(draft.id)}
                  disabled={!draft.canApply || refreshing || Boolean(loadingAction) || uncertainIds.includes(`draft:${draft.id}`)}
                >
                  {draft.canApply ? "报名需求" : draft.convertedOrder ? "已转正式订单" : draft.selectedForMe ? "老板已选你" : "已报名"}
                </ActionButton>
                {draft.convertedOrder ? <span className="text-xs text-dfc-muted">正式订单：{draft.convertedOrder.orderNo}</span> : null}
              </div>
            </article>
          )) : <EmptyState>暂无派单草稿。</EmptyState>}
        </div>
      </section>

    </CompanionShell>
  );
}

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success";
  return <div className={`mt-4 rounded-dfc-control border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

function companionActionError(message?: string) {
  if (!message) return "服务器暂未返回操作结果";
  if (/dispatchVersion|version|stale/i.test(message)) return "订单分配已更新，请刷新后查看最新安排";
  if (/another companion|active service order/i.test(message)) return "订单已由其他陪玩接单，或你仍有进行中的服务，请刷新核对";
  if (/duration has not elapsed/i.test(message)) return "约定服务时长尚未结束，暂不能报完成";
  if (/complaint/i.test(message)) return "订单有待处理争议，请联系管理员处理";
  if (/cannot be accepted|Only an in-progress|Only the assigned|deadline|expired/i.test(message)) return "订单状态已变化，请刷新核对最新状态";
  return /[\u4e00-\u9fff]/.test(message) ? message : "本笔操作未获确认，请刷新核对，必要时联系管理员";
}

function EmptyState({ children }: { children: string }) {
  return <div className="companion-card p-4 text-sm text-dfc-subtext">{children}</div>;
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-dfc-control border border-cyan-300/15 bg-[#07111f] p-3">
      <div className="text-xs text-dfc-muted">{label}</div>
      <div className="mt-1 font-black text-white">{value}</div>
    </div>
  );
}

function nextOrderAction(status: string): { label: string; action: "accept" | "start" | "complete"; message: string } | null {
  if (status === "ASSIGNED") return { label: "接单", action: "accept", message: "接单成功。" };
  if (status === "ACCEPTED") return { label: "开始服务", action: "start", message: "订单已开始。" };
  if (status === "IN_PROGRESS") return { label: "完成订单", action: "complete", message: "已报完成，收益待客户或管理员验收后结算。" };
  return null;
}

function toOrderCard(order: Order) {
  return {
    id: order.orderNo,
    mode: `${gameLabel(order.game)} / ${order.mode}`,
    customer: order.customer ? order.customer.displayName : undefined,
    hours: Number(order.hours),
    amount: Number(order.totalAmount),
    status: order.status
  };
}

function draftStatusText(status: string) {
  const map: Record<string, string> = {
    OPEN: "招募中",
    TRIALING: "招募沟通中",
    SELECTED: "已选择",
    CUSTOMER_CONFIRMED: "客户确认",
    CONVERTED: "已转单",
    CANCELLED: "已取消"
  };
  return map[status] ?? status;
}

function draftStatusTone(status: string): "default" | "warning" | "danger" | "success" {
  if (status === "CONVERTED" || status === "CUSTOMER_CONFIRMED") return "success";
  if (status === "CANCELLED") return "danger";
  if (status === "OPEN" || status === "TRIALING" || status === "SELECTED") return "warning";
  return "default";
}

function gameLabel(game?: string) {
  const map: Record<string, string> = {
    DELTA_FORCE: "三角洲行动",
    LEAGUE_OF_LEGENDS: "英雄联盟",
    VALORANT: "无畏契约",
    COUNTER_STRIKE_2: "CS2",
    PUBG: "PUBG 绝地求生",
    APEX_LEGENDS: "Apex 英雄",
    NARAKA_BLADEPOINT: "永劫无间",
    CALL_OF_DUTY: "塔科夫 / COD"
  };
  return game ? map[game] ?? game : "未填写游戏";
}

function formatMoney(value: string) {
  return Number(value || 0).toFixed(2);
}
