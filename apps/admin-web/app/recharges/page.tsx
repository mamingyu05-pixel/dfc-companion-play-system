"use client";

import { useEffect, useState } from "react";
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

  const rows = recharges.map((item) => [
    <div key={`${item.id}-id`}>
      <div className="font-medium text-dfc-text">{item.id}</div>
      <div className="mt-1 text-xs text-dfc-muted">{new Date(item.createdAt).toLocaleString("zh-CN")}</div>
    </div>,
    <div key={`${item.id}-customer`}>
      <div className="font-medium text-dfc-text">{item.customer.displayName}</div>
      <div className="mt-1 text-xs text-dfc-subtext">{item.customer.email}</div>
      <div className="mt-1 text-xs text-dfc-muted">当前余额：¥{formatMoney(item.customer.availableBalance)}</div>
    </div>,
    `¥${formatMoney(item.amount)}`,
    <a
      key={`${item.id}-shot`}
      href={item.screenshotUrl}
      target="_blank"
      rel="noreferrer"
      className="text-dfc-blue"
    >
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
      <SectionHeader title="充值审核" desc="真实读取充值申请。审核通过后增加客户余额并生成钱包流水。" />
      {error ? <div className="mb-4 rounded-dfc-control border border-dfc-danger/40 bg-dfc-danger/10 px-3 py-2 text-sm text-dfc-danger">{error}</div> : null}
      {status ? <div className="mb-4 rounded-dfc-control border border-dfc-success/40 bg-dfc-success/10 px-3 py-2 text-sm text-dfc-success">{status}</div> : null}
      <label className="mb-4 block max-w-xl">
        <span className="text-sm text-dfc-subtext">审核备注</span>
        <input
          value={reviewNote}
          onChange={(event) => setReviewNote(event.target.value)}
          className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
          placeholder="通过或拒绝时写入备注，可留空"
        />
      </label>
      <DataTable columns={["编号", "客户", "金额", "截图", "状态", "操作"]} rows={rows} />
    </AdminShell>
  );
}

function formatMoney(value: string) {
  return Number(value).toFixed(2);
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
