"use client";

import { useEffect, useState } from "react";
import { AdminShell, DataTable, SectionHeader } from "../components";

type AdminLog = {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  target: string;
  createdAt: string;
};

export default function LogsPage() {
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadLogs() {
      const token = localStorage.getItem("dfc_admin_token");
      if (!token) return;

      const response = await fetch("/api/admin/logs", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error("无法加载真实操作日志");
      setLogs((await response.json()) as AdminLog[]);
    }

    void loadLogs().catch(() => setError("无法加载真实操作日志，请检查登录状态或 API 服务"));
  }, []);

  return (
    <AdminShell>
      <SectionHeader title="操作日志" desc="所有管理员操作都必须记录到 admin_logs。" />
      {error ? <div className="mb-4 rounded-dfc border border-dfc-danger bg-dfc-danger/10 p-3 text-sm text-dfc-danger">{error}</div> : null}
      <DataTable
        columns={["编号", "操作人", "动作", "对象类型", "对象", "时间"]}
        rows={logs.map((log) => [shortId(log.id), log.actor, formatAction(log.action), log.entityType, log.target || log.entityId || "-", formatDateTime(log.createdAt)])}
      />
    </AdminShell>
  );
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}...` : id;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatAction(action: string) {
  const map: Record<string, string> = {
    APPROVED_RECHARGE: "审核充值",
    REJECTED_RECHARGE: "拒绝充值",
    ADMIN_CREDIT_BALANCE: "人工加余额",
    ADMIN_DEBIT_BALANCE: "人工扣余额",
    ASSIGN_ORDER: "派单",
    CREATE_COMPANION: "创建陪玩",
    REVIEW_COMPLAINT: "处理投诉",
    CREATE_ADMIN: "创建管理员"
  };
  return map[action] ?? action;
}
