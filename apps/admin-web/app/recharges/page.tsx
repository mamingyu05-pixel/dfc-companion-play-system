"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";
import { LazyImage } from "../lazy-image";
import Link from "next/link";
import { adminApi, BatchBar, BatchButton, ExportButton, SelectBox, sumYuan, useSelection } from "../batch-tools";

type RechargeRequest = {
  id: string;
  amount: string;
  screenshotUrl: string;
  screenshotInline?: boolean;
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
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const inFlight = useRef(new Set<string>());
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [uncertainIds, setUncertainIds] = useState<string[]>([]);
  const selection = useSelection();
  const [batchBusy, setBatchBusy] = useState(false);

  async function loadRecharges() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;

    const response = await fetch("/api/admin/recharges", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("无法加载充值审核列表");
    setRecharges((await response.json()) as RechargeRequest[]);
    setUncertainIds([]);
  }

  useEffect(() => {
    void loadRecharges().catch(() => setError("无法加载真实充值审核列表，请确认管理员已登录"));
  }, []);

  async function reviewRecharge(item: RechargeRequest, nextStatus: "APPROVED" | "REJECTED") {
    const id = item.id;
    if (inFlight.current.has(id) || uncertainIds.includes(id) || item.status !== "PENDING") return;
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    const action = nextStatus === "APPROVED" ? "通过" : nextStatus === "REJECTED" ? "拒绝" : "确认已人工打款";
    if (!window.confirm(`${action}本笔充值？\n编号：${id}\n用户：${item.customer.displayName} (${item.customer.email})\n金额：¥${formatMoney(item.amount)}\n备注：${reviewNotes[id] || "无"}`)) return;
    inFlight.current.add(id);
    setPendingIds((current) => [...current, id]);
    setError("");
    setStatus("");
    let committed = false;
    try {
      const response = await fetch(`/api/admin/recharges/${id}/review`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, note: reviewNotes[id] ?? "" })
      });
      const data = (await response.json().catch(() => ({}))) as { id?: string; status?: string; message?: string | string[] };
      if (!response.ok) {
        const message = Array.isArray(data.message) ? data.message.join("，") : data.message;
        throw new Error(toChineseError(message));
      }
      if (data.id !== id || data.status !== nextStatus) throw new Error("未收到本笔操作的有效结果");
      committed = true;
      setRecharges((current) => current.map((row) => row.id === id ? { ...row, status: nextStatus } : row));
      setReviewNotes((current) => ({ ...current, [id]: "" }));
      setStatus(`本笔充值已${action}：${id}，¥${formatMoney(item.amount)}`);
      await loadRecharges();
    } catch (err) {
      if (!committed) setUncertainIds((current) => [...current, id]);
      setError(committed ? "本笔操作已成功，但列表刷新失败；请刷新核对，勿重复操作"
        : `本笔结果待核对，备注已保留；请刷新列表核对后再操作。${err instanceof Error ? err.message : "请求失败"}`);
    } finally {
      inFlight.current.delete(id);
      setPendingIds((current) => current.filter((value) => value !== id));
    }
  }

  async function reviewSelected(nextStatus: "APPROVED" | "REJECTED") {
    const chosen = recharges.filter((item) => selection.has(item.id) && item.status === "PENDING");
    if (!chosen.length) return;
    const total = sumYuan(chosen.map((item) => item.amount));
    const action = nextStatus === "APPROVED" ? "通过" : "拒绝";
    if (!window.confirm(`批量${action} ${chosen.length} 笔充值？
合计金额：¥${total}
请确认每张截图都已核对。`)) return;
    setBatchBusy(true); setError(""); setStatus("");
    try {
      const result = await adminApi<{ done: number; failed: Array<{ id: string; error?: string }> }>("/api/admin/batch/recharges/review", {
        method: "POST", body: JSON.stringify({ ids: chosen.map((item) => item.id), status: nextStatus, expectedTotal: total })
      });
      setStatus(`已批量${action} ${result.done} 笔，合计 ¥${total}${result.failed.length ? `；${result.failed.length} 笔未处理，请逐笔核对` : ""}`);
      selection.clear();
    } catch (err) {
      setError(err instanceof Error ? toChineseError(err.message) : "批量处理失败");
    } finally {
      setBatchBusy(false);
      await loadRecharges().catch(() => setError("列表刷新失败，请手动刷新核对"));
    }
  }

  const stats = useMemo(() => {
    const pending = recharges.filter((item) => item.status === "PENDING");
    const approved = recharges.filter((item) => item.status === "APPROVED");
    const pendingAmount = pending.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return { pendingCount: pending.length, approvedCount: approved.length, pendingAmount };
  }, [recharges]);

  const pendingRows = recharges.filter((item) => item.status === "PENDING").map((item) => item.id);
  const selectedPending = recharges.filter((item) => selection.has(item.id) && item.status === "PENDING");
  const rows = recharges.map((item) => [
    item.status === "PENDING"
      ? <SelectBox key={`${item.id}-pick`} label={`选择 ${item.id}`} checked={selection.has(item.id)} onChange={() => selection.toggle(item.id)} />
      : <span key={`${item.id}-pick`} />,
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
    item.screenshotInline ? (
      <LazyImage key={`${item.id}-shot`} path={`/api/admin/recharges/${encodeURIComponent(item.id)}/screenshot`} field="screenshotUrl" label="查看截图" />
    ) : hasRechargeScreenshot(item.screenshotUrl) ? (
      <a key={`${item.id}-shot`} href={item.screenshotUrl} target="_blank" rel="noreferrer" className="font-bold text-cyan-200 hover:text-white">
        查看截图
      </a>
    ) : (
      <span key={`${item.id}-shot`} className="rounded-dfc-control border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-xs font-black text-cyan-100">
        客服确认
      </span>
    ),
    <StatusBadge key={`${item.id}-status`} tone={item.status === "APPROVED" ? "success" : item.status === "REJECTED" ? "danger" : "warning"}>
      {toRechargeStatus(item.status)}
    </StatusBadge>,
    item.status === "PENDING" ? (
      <div key={`${item.id}-actions`} className="flex flex-wrap gap-2">
        {item.status === "PENDING" || item.status === "APPROVED" ? <input aria-label={`审核备注 ${item.id}`} value={reviewNotes[item.id] ?? ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [item.id]: event.target.value }))} className="input" placeholder="本笔审核备注（选填）" /> : null}
        <ActionButton disabled={pendingIds.includes(item.id) || uncertainIds.includes(item.id)} onClick={() => void reviewRecharge(item, "APPROVED")}>通过</ActionButton>
        <ActionButton tone="danger" disabled={pendingIds.includes(item.id) || uncertainIds.includes(item.id)} onClick={() => void reviewRecharge(item, "REJECTED")}>拒绝</ActionButton>
      </div>
    ) : (
      <span key={`${item.id}-done`} className="text-xs text-dfc-muted">
        {item.reviewedBy ? item.reviewedBy.displayName : "已处理"}
      </span>
    )
  ]);

  return (
    <AdminShell>
      <SectionHeader eyebrow="Finance Review" title="充值审核" desc="核对客户转账截图或人工客服到账确认后再入账。通过后系统会增加客户余额并生成钱包流水。" />

      <section className="mb-5 grid gap-4 md:grid-cols-3">
        <Signal label="待审核" value={String(stats.pendingCount)} hint={`待核金额 ¥${formatMoney(String(stats.pendingAmount))}`} tone="gold" />
        <Signal label="已通过" value={String(stats.approvedCount)} hint="已写入钱包流水" tone="green" />
        <Signal label="总申请" value={String(recharges.length)} hint="当前列表记录" tone="cyan" />
      </section>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href="/staff-recharge" className="rounded border border-dfc-gold/60 bg-dfc-gold px-3 py-1.5 text-sm font-black text-slate-950">客户转账给客服？代客充值</Link>
        <ActionButton onClick={() => void loadRecharges().catch(() => setError("刷新失败，请保留原操作上下文"))}>刷新并核对状态</ActionButton>
        {pendingRows.length ? <BatchButton tone="plain" onClick={() => selection.toggleAll(pendingRows)}>全选待审核（{pendingRows.length}）</BatchButton> : null}
        <ExportButton kind="recharges" label="充值记录" />
      </div>

      <DataTable columns={["", "编号", "客户", "金额", "凭证", "状态", "操作"]} rows={rows} />
      <BatchBar count={selectedPending.length} onClear={selection.clear}>
        <span className="text-sm text-dfc-gold">合计 ¥{sumYuan(selectedPending.map((item) => item.amount))}</span>
        <BatchButton disabled={batchBusy} onClick={() => void reviewSelected("APPROVED")}>批量通过</BatchButton>
        <BatchButton tone="danger" disabled={batchBusy} onClick={() => void reviewSelected("REJECTED")}>批量拒绝</BatchButton>
      </BatchBar>
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

function hasRechargeScreenshot(url: string) {
  const value = url.trim();
  return value.startsWith("data:image/") || value.startsWith("http://") || value.startsWith("https://");
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
