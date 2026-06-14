"use client";

import { useEffect, useMemo, useState } from "react";
import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

type RechargeRequest = {
  id: string;
  amount: string;
  screenshotUrl: string;
  note?: string | null;
  status: string;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  customer: {
    id: string;
    email: string;
    displayName: string;
    availableBalance: string;
  };
  reviewedBy?: {
    email: string;
    displayName: string;
  } | null;
};

export default function RechargesPage() {
  const [recharges, setRecharges] = useState<RechargeRequest[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [reviewNote, setReviewNote] = useState("");

  async function loadRecharges() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;

    const response = await fetch("/api/admin/recharges", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("无法加载充值审核列表");
    setRecharges((await response.json()) as RechargeRequest[]);
  }

  useEffect(() => {
    void loadRecharges().catch(() => setError("无法加载真实充值审核列表，请确认管理员已登录"));
  }, []);

  async function reviewRecharge(id: string, nextStatus: "APPROVED" | "REJECTED") {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;

    setError("");
    setStatus("");
    const response = await fetch(`/api/admin/recharges/${id}/review`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status: nextStatus, note: reviewNote })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join("，") : data.message;
      setError(toChineseError(message));
      return;
    }

    setReviewNote("");
    setStatus(nextStatus === "APPROVED" ? "充值已通过，客户余额已增加" : "充值已拒绝");
    await loadRecharges();
  }

  const stats = useMemo(() => {
    const pending = recharges.filter((item) => item.status === "PENDING");
    const approved = recharges.filter((item) => item.status === "APPROVED");
    const pendingAmount = pending.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return { pendingCount: pending.length, approvedCount: approved.length, pendingAmount };
  }, [recharges]);

  const rows = recharges.map((item) => [
    <div key={`${item.id}-id`}>
      <div className="font-black text-white">{shortId(item.id)}</div>
      <div className="mt-1 text-xs text-dfc-muted">{formatDateTime(item.createdAt)}</div>
      {item.note ? <div className="mt-1 max-w-56 truncate text-xs text-dfc-subtext">备注：{item.note}</div> : null}
    </div>,
    <div key={`${item.id}-customer`}>
      <div className="font-semibold text-white">{item.customer.displayName}</div>
      <div className="mt-1 text-xs text-dfc-subtext">{item.customer.email}</div>
      <div className="mt-1 text-xs text-dfc-muted">当前余额 ¥{formatMoney(item.customer.availableBalance)}</div>
    </div>,
    <span key={`${item.id}-amount`} className="font-black tabular-nums text-dfc-gold">¥{formatMoney(item.amount)}</span>,
    <a key={`${item.id}-shot`} href={item.screenshotUrl} target="_blank" rel="noreferrer" className="font-bold text-cyan-200 hover:text-white">
      查看截图
    </a>,
    <StatusBadge key={`${item.id}-status`} tone={item.status === "APPROVED" ? "success" : item.status === "REJECTED" ? "danger" : "warning"}>
      {toRechargeStatus(item.status)}
    </StatusBadge>,
    item.status === "PENDING" ? (
      <div key={`${item.id}-actions`} className="flex flex-wrap gap-2">
        <ActionButton onClick={() => void reviewRecharge(item.id, "APPROVED")}>通过</ActionButton>
        <ActionButton tone="danger" onClick={() => void reviewRecharge(item.id, "REJECTED")}>拒绝</ActionButton>
      </div>
    ) : (
      <span key={`${item.id}-done`} className="text-xs text-dfc-muted">
        {item.reviewedBy ? item.reviewedBy.displayName : "已处理"}
      </span>
    )
  ]);

  return (
    <AdminShell>
      <SectionHeader eyebrow="Finance Review" title="充值审核" desc="核对客户转账截图后再入账。通过后系统会增加客户余额并生成钱包流水。" />

      <section className="mb-5 grid gap-4 md:grid-cols-3">
        <Signal label="待审核" value={String(stats.pendingCount)} hint={`待核金额 ¥${formatMoney(String(stats.pendingAmount))}`} tone="gold" />
        <Signal label="已通过" value={String(stats.approvedCount)} hint="已写入钱包流水" tone="green" />
        <Signal label="总申请" value={String(recharges.length)} hint="当前列表记录" tone="cyan" />
      </section>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <section className="admin-panel mb-5">
        <div className="grid gap-3 lg:grid-cols-[1fr_320px] lg:items-end">
          <div>
            <h2 className="text-base font-black text-white">审核备注</h2>
            <p className="mt-1 text-xs text-dfc-muted">通过或拒绝时会随审核动作提交，可留空。</p>
          </div>
          <input value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} className="input" placeholder="例如：到账金额一致，截图清晰" />
        </div>
      </section>

      <DataTable columns={["编号", "客户", "金额", "凭证", "状态", "操作"]} rows={rows} />
    </AdminShell>
  );
}

function Signal({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: "cyan" | "gold" | "green" }) {
  const styles = {
    cyan: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
    gold: "border-dfc-gold/30 bg-dfc-gold/10 text-dfc-gold",
    green: "border-dfc-success/30 bg-dfc-success/10 text-dfc-success"
  };
  return (
    <div className={`rounded-dfc border p-4 ${styles[tone]}`}>
      <div className="text-xs font-black">{label}</div>
      <div className="mt-2 text-3xl font-black tabular-nums">{value}</div>
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

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}...` : id;
}

function toRechargeStatus(status: string) {
  if (status === "PENDING") return "待审核";
  if (status === "APPROVED") return "已通过";
  if (status === "REJECTED") return "已拒绝";
  return status;
}

function toChineseError(message?: string) {
  if (!message) return "操作失败";
  if (message.includes("Recharge request was already reviewed")) return "这条充值申请已经审核过";
  if (message.includes("Recharge request not found")) return "充值申请不存在";
  return message;
}
