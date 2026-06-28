"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

type AdminOrder = {
  id: string;
  orderNo: string;
  game: string;
  mode: string;
  hours: string;
  originalUnitPrice?: string | null;
  unitPrice: string;
  discountPerHour?: string;
  originalAmount?: string | null;
  totalAmount: string;
  status: string;
  notes?: string | null;
  voiceTrialRequested: boolean;
  customer?: { email: string; displayName: string };
  companion?: { email: string; displayName: string } | null;
  orderGroup?: {
    id: string;
    groupNo: string;
    companionCount: number;
    originalAmount: string;
    discountAmount: string;
    totalAmount: string;
  } | null;
  createdAt: string;
};

type OrderDraft = {
  id: string;
  draftNo: string;
  sourcePlatform: "WEB" | "DISCORD" | "KOOK";
  customerPlatformUserId?: string | null;
  customerDisplayName?: string | null;
  game: string;
  mode: string;
  hours?: string | null;
  budgetAmount?: string | null;
  status: string;
  note?: string | null;
  createdAt: string;
  customer?: { email: string; displayName: string } | null;
  convertedOrder?: { id: string; orderNo: string; status: string } | null;
  candidates: Array<{ id: string; status: string }>;
  publishedPlatforms?: Array<{
    platform: "DISCORD" | "KOOK" | string;
    status: "SENT" | "FAILED" | string;
    channelId?: string | null;
    messageId?: string | null;
    error?: string | null;
    createdAt: string;
  }>;
};

const closedDraftStatuses = new Set(["CONVERTED", "CANCELLED"]);

function isClosedDraft(draft: Pick<OrderDraft, "status">) {
  return closedDraftStatuses.has(draft.status);
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [drafts, setDrafts] = useState<OrderDraft[]>([]);
  const [error, setError] = useState("");
  const [actioningDraftId, setActioningDraftId] = useState("");
  const [actioningOrderId, setActioningOrderId] = useState("");

  async function loadOrders() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    const [ordersResponse, draftsResponse] = await Promise.all([
      fetch("/api/admin/orders", { headers }),
      fetch("/api/admin/order-drafts", { headers })
    ]);
    if (!ordersResponse.ok || !draftsResponse.ok) throw new Error("无法加载订单");
    setOrders((await ordersResponse.json()) as AdminOrder[]);
    setDrafts((await draftsResponse.json()) as OrderDraft[]);
  }

  useEffect(() => {
    void loadOrders().catch(() => setError("无法加载真实订单数据"));
  }, []);

  const activeDrafts = useMemo(() => drafts.filter((draft) => !isClosedDraft(draft)), [drafts]);

  async function failDraft(draftId: string) {
    if (!window.confirm("确认把这条派单草稿标记为流单吗？适用于长时间无人接单、客户失联或需求取消。")) return;
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) {
      setError("请先登录管理员账号");
      return;
    }
    try {
      setActioningDraftId(draftId);
      setError("");
      const response = await fetch(`/api/admin/order-drafts/${draftId}/fail`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ note: "长时间无人接单，人工标记流单" })
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
        const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
        throw new Error(message || "标记流单失败");
      }
      await loadOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "标记流单失败");
    } finally {
      setActioningDraftId("");
    }
  }

  async function cancelOrder(order: AdminOrder) {
    if (!canCancelOrder(order)) return;
    const message = order.orderGroup
      ? `确认取消并退款 ${order.orderNo}？如果订单组人数降到折扣门槛以下，系统会自动取消剩余订单折扣并重算钱包冻结金额。`
      : `确认取消并退款 ${order.orderNo}？`;
    if (!window.confirm(message)) return;
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) {
      setError("请先登录管理员账号");
      return;
    }
    try {
      setActioningOrderId(order.id);
      setError("");
      const response = await fetch(`/api/admin/orders/${order.id}/cancel`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ note: "管理员取消未开始订单" })
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
        const detail = Array.isArray(data.message) ? data.message.join(", ") : data.message;
        throw new Error(detail || "取消订单失败");
      }
      await loadOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "取消订单失败");
    } finally {
      setActioningOrderId("");
    }
  }

  const stats = useMemo(() => {
    const paid = orders.filter((order) => order.status === "PAID").length;
    const active = orders.filter((order) => ["ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(order.status)).length;
    const completed = orders.filter((order) => order.status === "COMPLETED").length;
    const amount = orders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
    const openDrafts = activeDrafts.length;
    return { paid, active, completed, amount, openDrafts };
  }, [orders, activeDrafts]);

  return (
    <AdminShell>
      <SectionHeader eyebrow="Order Control" title="订单管理" desc="查看数据库真实订单。已支付订单进入派单页分配陪玩，进行中订单重点关注服务状态和投诉风险。" />

      <section className="mb-5 grid gap-4 md:grid-cols-4">
        <Signal label="待派单" value={String(stats.paid)} hint="PAID 订单" tone="gold" />
        <Signal label="服务中" value={String(stats.active)} hint="已派单 / 已接单 / 进行中" tone="cyan" />
        <Signal label="已完成" value={String(stats.completed)} hint="完成后进入结算" tone="green" />
        <Signal label="AI草稿" value={String(stats.openDrafts)} hint="KOOK / Discord 派单草稿" tone="purple" />
      </section>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <section className="mb-6">
        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-black text-white">AI 派单草稿</h2>
            <p className="mt-1 text-xs text-dfc-muted">频道 Bot 发出的派单先进入这里。客户确认陪玩并转正式订单后，才会出现在下方正式订单列表。</p>
          </div>
          <Link href="/order-drafts" className="rounded-dfc-control border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100 hover:border-cyan-300/60">
            进入客服派单台
          </Link>
        </div>
        <DataTable
          columns={["草稿号", "客户来源", "已发布", "客户", "游戏", "模式", "备注", "时长", "预算", "报名", "状态", "人工操作"]}
          rows={activeDrafts.slice(0, 8).map((draft) => [
            <Link key={`${draft.id}-no`} href="/order-drafts" className="font-black text-cyan-200">{draft.draftNo}</Link>,
            <PlatformBadge key={`${draft.id}-source`} platform={draft.sourcePlatform} />,
            <PublishedPlatforms key={`${draft.id}-published`} platforms={draft.publishedPlatforms ?? []} />,
            draft.customer ? <Person key={`${draft.id}-customer`} name={draft.customer.displayName} email={draft.customer.email} /> : <Person key={`${draft.id}-platform-customer`} name={draft.customerDisplayName ?? "频道客户"} email={draft.customerPlatformUserId ?? "未绑定站内客户"} />,
            gameName(draft.game),
            draft.mode || "-",
            <span key={`${draft.id}-note`} className="line-clamp-2 text-xs text-dfc-subtext">{draft.note || "-"}</span>,
            draft.hours ? `${formatMoney(draft.hours)}h` : "-",
            draft.budgetAmount ? <span key={`${draft.id}-budget`} className="font-black tabular-nums text-dfc-gold">¥{formatMoney(draft.budgetAmount)}</span> : <span key={`${draft.id}-budget-empty`} className="text-dfc-muted">按报价</span>,
            `${draft.candidates.length} 人`,
            <StatusBadge key={`${draft.id}-status`} tone={draftStatusTone(draft.status)}>{toDraftStatus(draft.status)}</StatusBadge>,
            <DraftActions key={`${draft.id}-actions`} draft={draft} actioningDraftId={actioningDraftId} onFail={() => void failDraft(draft.id)} />
          ])}
        />
      </section>

      <div className="mb-3">
        <h2 className="text-lg font-black text-white">正式订单</h2>
        <p className="mt-1 text-xs text-dfc-muted">只有客户余额确认、陪玩确认并转订单后，才会进入正式订单流程。</p>
      </div>

      <DataTable
        columns={["订单号", "订单组", "客户", "陪玩", "游戏", "模式", "备注", "时长", "金额", "试音", "状态", "创建时间", "操作"]}
        rows={orders.map((order) => [
          <span key={`${order.id}-no`} className="font-black text-white">{order.orderNo}</span>,
          <OrderGroupBadge key={`${order.id}-group`} order={order} />,
          order.customer ? <Person key={`${order.id}-customer`} name={order.customer.displayName} email={order.customer.email} /> : "-",
          order.companion ? <Person key={`${order.id}-companion`} name={order.companion.displayName} email={order.companion.email} /> : <span className="text-dfc-gold">平台待匹配</span>,
          gameName(order.game),
          order.mode,
          <span key={`${order.id}-notes`} className="line-clamp-2 text-xs text-dfc-subtext">{order.notes || "-"}</span>,
          `${formatMoney(order.hours)}h`,
          <OrderAmount key={`${order.id}-amount`} order={order} />,
          order.voiceTrialRequested ? <StatusBadge key={`${order.id}-voice`} tone="warning">需要</StatusBadge> : <span className="text-dfc-muted">不需要</span>,
          <StatusBadge key={`${order.id}-status`} tone={statusTone(order.status)}>{toOrderStatus(order.status)}</StatusBadge>,
          formatDateTime(order.createdAt),
          canCancelOrder(order) ? (
            <button
              key={`${order.id}-cancel`}
              type="button"
              disabled={actioningOrderId === order.id}
              onClick={() => void cancelOrder(order)}
              className="rounded-dfc-control border border-dfc-danger/40 bg-dfc-danger/10 px-3 py-2 text-xs font-black text-dfc-danger transition hover:bg-dfc-danger hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
            >
              {actioningOrderId === order.id ? "处理中" : "取消退款"}
            </button>
          ) : <span key={`${order.id}-no-action`} className="text-dfc-muted">-</span>
        ])}
      />
    </AdminShell>
  );
}

function Person({ name, email }: { name: string; email: string }) {
  return (
    <div>
      <div className="font-semibold text-white">{name}</div>
      <div className="mt-1 text-xs text-dfc-muted">{email}</div>
    </div>
  );
}

function OrderGroupBadge({ order }: { order: AdminOrder }) {
  if (!order.orderGroup) return <span className="text-dfc-muted">单人</span>;
  return (
    <div>
      <div className="font-black text-cyan-100">{order.orderGroup.groupNo}</div>
      <div className="mt-1 text-xs text-dfc-muted">{order.orderGroup.companionCount} 人 / 折扣 ¥{formatMoney(order.orderGroup.discountAmount)}</div>
    </div>
  );
}

function OrderAmount({ order }: { order: AdminOrder }) {
  const originalAmount = Number(order.originalAmount ?? order.totalAmount);
  const totalAmount = Number(order.totalAmount || 0);
  const discount = Math.max(0, originalAmount - totalAmount);
  if (discount <= 0) {
    return <span className="font-black tabular-nums text-dfc-gold">¥{formatMoney(order.totalAmount)}</span>;
  }
  return (
    <div className="text-right">
      <div className="text-xs text-dfc-muted line-through">原价 ¥{formatMoney(String(originalAmount))}</div>
      <div className="mt-1 text-xs text-cyan-200">多陪玩折扣 -¥{formatMoney(String(discount))}</div>
      <div className="mt-1 font-black tabular-nums text-dfc-gold">¥{formatMoney(order.totalAmount)}</div>
    </div>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
  return <StatusBadge tone={platform === "KOOK" ? "warning" : platform === "DISCORD" ? "default" : "success"}>{platformLabel(platform)}</StatusBadge>;
}

function PublishedPlatforms({ platforms }: { platforms: NonNullable<OrderDraft["publishedPlatforms"]> }) {
  if (!platforms.length) return <span className="text-dfc-muted">未记录</span>;

  return (
    <div className="flex flex-wrap gap-1">
      {platforms.map((item) => (
        <StatusBadge key={`${item.platform}-${item.messageId ?? item.createdAt}`} tone={item.status === "SENT" ? "success" : "danger"}>
          {platformLabel(item.platform)} {item.status === "SENT" ? "已发" : "失败"}
        </StatusBadge>
      ))}
    </div>
  );
}

function DraftActions({ draft, actioningDraftId, onFail }: { draft: OrderDraft; actioningDraftId: string; onFail: () => void }) {
  const closed = draft.status === "CONVERTED" || draft.status === "CANCELLED";
  return (
    <div className="flex flex-wrap gap-2">
      <Link href={`/order-drafts?draftId=${draft.id}`} className="rounded-dfc-control border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100 hover:border-cyan-300/60">
        处理
      </Link>
      <button
        type="button"
        disabled={closed || actioningDraftId === draft.id}
        onClick={onFail}
        className="rounded-dfc-control border border-dfc-danger/40 bg-dfc-danger/10 px-3 py-2 text-xs font-black text-dfc-danger transition hover:bg-dfc-danger hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
      >
        {actioningDraftId === draft.id ? "处理中" : "流单"}
      </button>
    </div>
  );
}

function Signal({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: "cyan" | "gold" | "green" | "purple" }) {
  const styles = {
    cyan: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
    gold: "border-dfc-gold/30 bg-dfc-gold/10 text-dfc-gold",
    green: "border-dfc-success/30 bg-dfc-success/10 text-dfc-success",
    purple: "border-fuchsia-300/25 bg-fuchsia-300/10 text-fuchsia-100"
  };
  return (
    <div className={`rounded-dfc border p-4 ${styles[tone]}`}>
      <div className="text-xs font-black">{label}</div>
      <div className="mt-2 text-2xl font-black tabular-nums">{value}</div>
      <div className="mt-1 text-xs opacity-80">{hint}</div>
    </div>
  );
}

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success";
  return <div className={`mb-4 rounded-dfc-control border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

function formatMoney(value: string) {
  return Number(value || 0).toFixed(2);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function platformLabel(platform: string) {
  if (platform === "DISCORD") return "Discord";
  if (platform === "KOOK") return "KOOK";
  if (platform === "WEB") return "后台";
  return platform;
}

function gameName(code: string) {
  const names: Record<string, string> = {
    DELTA_FORCE: "三角洲行动",
    LEAGUE_OF_LEGENDS: "英雄联盟",
    VALORANT: "无畏契约",
    COUNTER_STRIKE_2: "CS2",
    PUBG: "PUBG 绝地求生",
    APEX_LEGENDS: "Apex 英雄",
    NARAKA_BLADEPOINT: "永劫无间",
    CALL_OF_DUTY: "塔科夫 / COD"
  };
  return names[code] ?? code;
}

function toOrderStatus(status: string) {
  const map: Record<string, string> = {
    PENDING_PAYMENT: "待支付",
    PAID: "待派单",
    ASSIGNED: "已派单",
    ACCEPTED: "已接单",
    IN_PROGRESS: "进行中",
    COMPLETED: "已完成",
    CANCELLED: "已取消",
    REFUND_REQUESTED: "退款申请",
    REFUNDED: "已退款",
    DISPUTED: "争议中"
  };
  return map[status] ?? status;
}

function canCancelOrder(order: AdminOrder) {
  return ["PAID", "ASSIGNED", "ACCEPTED"].includes(order.status);
}

function toDraftStatus(status: string) {
  const map: Record<string, string> = {
    OPEN: "招募中",
    TRIALING: "试音中",
    SELECTED: "已选陪玩",
    CUSTOMER_CONFIRMED: "客户确认",
    CONVERTED: "已转订单",
    CANCELLED: "已取消"
  };
  return map[status] ?? status;
}

function statusTone(status: string): "default" | "warning" | "danger" | "success" {
  if (status === "COMPLETED") return "success";
  if (status === "CANCELLED" || status === "REFUNDED" || status === "DISPUTED") return "danger";
  if (status === "PAID" || status === "ASSIGNED" || status === "ACCEPTED" || status === "IN_PROGRESS") return "warning";
  return "default";
}

function draftStatusTone(status: string): "default" | "warning" | "danger" | "success" {
  if (status === "CONVERTED") return "success";
  if (status === "CANCELLED") return "danger";
  if (status === "TRIALING" || status === "SELECTED" || status === "CUSTOMER_CONFIRMED") return "warning";
  return "default";
}
