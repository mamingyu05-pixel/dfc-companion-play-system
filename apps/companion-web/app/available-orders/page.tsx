"use client";

import { useEffect, useMemo, useState } from "react";
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
  customer?: { displayName: string; email: string };
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

const activeOrderStatuses = new Set(["ASSIGNED", "ACCEPTED", "IN_PROGRESS"]);

export default function AvailableOrdersPage() {
  const [availableOrders, setAvailableOrders] = useState<Order[]>([]);
  const [myOrders, setMyOrders] = useState<Order[]>([]);
  const [drafts, setDrafts] = useState<DraftOrder[]>([]);
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [loadingAction, setLoadingAction] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function loadQueues() {
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    const [availableResponse, myResponse, draftResponse] = await Promise.all([
      fetch("/api/orders/companion/available", { headers }),
      fetch("/api/orders/companion/my", { headers }),
      fetch("/api/orders/companion/drafts", { headers })
    ]);

    if (!availableResponse.ok) throw new Error("无法加载正式可接订单");
    if (!myResponse.ok) throw new Error("无法加载我的订单");
    if (!draftResponse.ok) throw new Error("无法加载派单草稿");

    setAvailableOrders((await availableResponse.json()) as Order[]);
    setMyOrders((await myResponse.json()) as Order[]);
    setDrafts((await draftResponse.json()) as DraftOrder[]);
  }

  useEffect(() => {
    void loadQueues().catch((err: Error) => setError(err.message || "无法加载接单数据"));
  }, []);

  async function patchOrder(orderId: string, action: "accept" | "start" | "complete", successMessage: string) {
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) return;
    setError("");
    setStatus("");
    setLoadingAction(`${action}:${orderId}`);
    try {
      const response = await fetch(`/api/orders/${orderId}/${action}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
      if (!response.ok) {
        const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
        setError(message ?? "操作失败");
        return;
      }
      setStatus(successMessage);
      await loadQueues();
    } finally {
      setLoadingAction("");
    }
  }

  async function applyDraft(draftId: string) {
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) return;
    setError("");
    setStatus("");
    setLoadingAction(`apply:${draftId}`);
    try {
      const response = await fetch(`/api/orders/companion/drafts/${draftId}/apply`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ note: draftNotes[draftId]?.trim() })
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
      if (!response.ok) {
        const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
        setError(message ?? "报名失败");
        return;
      }
      setStatus("报名已提交，客服和老板可以在后台看到你的报名信息。");
      setDraftNotes((current) => ({ ...current, [draftId]: "" }));
      await loadQueues();
    } finally {
      setLoadingAction("");
    }
  }

  const activeOrders = useMemo(() => myOrders.filter((order) => activeOrderStatuses.has(order.status)), [myOrders]);
  const stats = useMemo(() => {
    const amount = availableOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
    const hours = availableOrders.reduce((sum, order) => sum + Number(order.hours || 0), 0);
    return { amount, hours };
  }, [availableOrders]);

  return (
    <CompanionShell>
      <SectionHeader
        eyebrow="ORDER QUEUE"
        title="接单大厅"
        desc="这里会显示你正在服务的订单、AI/人工派单草稿，以及正式派给你的可接订单。报名时写清楚段位、打法、性格和可服务时间，老板更容易选你。"
      />

      <section className="mt-5 grid gap-4 md:grid-cols-4">
        <MetricCard label="进行中" value={String(activeOrders.length)} hint="已接 / 服务中订单" tone="green" />
        <MetricCard label="派单草稿" value={String(drafts.length)} hint="AI / 人工派单" />
        <MetricCard label="正式可接" value={String(availableOrders.length)} hint="已指定给你的订单" />
        <MetricCard label="队列金额" value={`¥${formatMoney(String(stats.amount))}`} hint="正式可接订单合计" tone="gold" />
      </section>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <section className="mt-7">
        <SectionHeader title="我的进行中订单" desc="接单后会留在这里，按顺序开始服务、完成订单。" />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {activeOrders.length ? (
            activeOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={toOrderCard(order)}
                action={nextOrderAction(order.status)?.label}
                onAction={() => {
                  const next = nextOrderAction(order.status);
                  if (next) void patchOrder(order.id, next.action, next.message);
                }}
              />
            ))
          ) : (
            <EmptyState>暂无进行中订单。</EmptyState>
          )}
        </div>
      </section>

      <section className="mt-8">
        <SectionHeader title="AI / 人工派单草稿" desc="频道 Bot 发出的派单会同步到这里。报名信息会写入后台，客服再给老板确认最终人选。" />
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

              <textarea
                className="mt-4 min-h-24 w-full rounded-dfc-control border border-cyan-300/20 bg-[#07111f] px-3 py-2 text-sm text-white outline-none transition placeholder:text-dfc-muted focus:border-cyan-300/55"
                placeholder="报名备注：例如 Apex 大师段，能带排位，话多活跃，可马上开，报价按后台价。"
                value={draftNotes[draft.id] ?? ""}
                onChange={(event) => setDraftNotes((current) => ({ ...current, [draft.id]: event.target.value }))}
                disabled={!draft.canApply}
              />
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <ActionButton
                  onClick={() => void applyDraft(draft.id)}
                  disabled={!draft.canApply || loadingAction === `apply:${draft.id}`}
                >
                  {draft.canApply ? "报名试音 / 接单" : draft.convertedOrder ? "已转正式订单" : draft.selectedForMe ? "老板已选你" : "已报名"}
                </ActionButton>
                {draft.convertedOrder ? <span className="text-xs text-dfc-muted">正式订单：{draft.convertedOrder.orderNo}</span> : null}
              </div>
            </article>
          )) : <EmptyState>暂无派单草稿。</EmptyState>}
        </div>
      </section>

      <section className="mt-8">
        <SectionHeader title="正式可接订单" desc="只有客服已经指定给你，或平台开放给陪玩的正式订单会显示在这里。" />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {availableOrders.length ? (
            availableOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={toOrderCard(order)}
                action="接单"
                onAction={() => void patchOrder(order.id, "accept", "接单成功，订单已进入我的进行中订单。")}
              />
            ))
          ) : (
            <EmptyState>暂无正式可接订单。</EmptyState>
          )}
        </div>
      </section>
    </CompanionShell>
  );
}

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success";
  return <div className={`mt-4 rounded-dfc-control border px-3 py-2 text-sm ${cls}`}>{children}</div>;
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
  if (status === "IN_PROGRESS") return { label: "完成订单", action: "complete", message: "订单已完成，收益将按规则结算。" };
  return null;
}

function toOrderCard(order: Order) {
  return {
    id: order.orderNo,
    mode: `${gameLabel(order.game)} / ${order.mode}`,
    customer: order.customer ? `${order.customer.displayName} / ${order.customer.email}` : undefined,
    hours: Number(order.hours),
    amount: Number(order.totalAmount),
    status: order.status
  };
}

function draftStatusText(status: string) {
  const map: Record<string, string> = {
    OPEN: "招募中",
    TRIALING: "试音中",
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
