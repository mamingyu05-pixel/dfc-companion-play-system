"use client";

import { useEffect, useState } from "react";
import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

type AdminUser = {
  id: string;
  email: string;
  role: string;
  status: string;
  displayName: string;
  createdAt: string;
  wallet: {
    availableBalance: string;
    frozenBalance: string;
    availableIncome: string;
    pendingIncome: string;
  } | null;
  companionProfile: {
    nickname: string;
    status: string;
    onlineStatus: string;
    pricePerHour: string;
  } | null;
  externalAccounts: Array<{
    platform: string;
    externalUserId: string;
    displayName?: string | null;
  }>;
};

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function loadUsers() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;

    const response = await fetch("/api/admin/users", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("无法加载用户列表");
    setUsers((await response.json()) as AdminUser[]);
  }

  useEffect(() => {
    void loadUsers().catch(() => setError("无法加载真实用户列表，请确认管理员已登录"));
  }, []);

  async function updateStatus(userId: string, nextStatus: "ACTIVE" | "BANNED") {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;

    setError("");
    setStatus("");
    const response = await fetch(`/api/admin/users/${userId}/status`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status: nextStatus })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join("，") : data.message;
      setError(toChineseError(message));
      return;
    }

    setStatus(nextStatus === "ACTIVE" ? "用户已解封" : "用户已封禁");
    await loadUsers();
  }

  const rows = users.map((user) => [
    user.id,
    <div key={`${user.id}-profile`}>
      <div className="font-medium text-dfc-text">{user.displayName}</div>
      <div className="mt-1 text-xs text-dfc-subtext">{user.email}</div>
      <div className="mt-1 text-xs text-dfc-muted">注册：{new Date(user.createdAt).toLocaleString("zh-CN")}</div>
    </div>,
    user.role,
    <StatusBadge key={`${user.id}-status`} tone={user.status === "ACTIVE" ? "success" : "danger"}>{user.status}</StatusBadge>,
    <div key={`${user.id}-wallet`} className="text-xs leading-5">
      <div>余额：¥{formatMoney(user.wallet?.availableBalance ?? "0")}</div>
      <div>收入：¥{formatMoney(user.wallet?.availableIncome ?? "0")}</div>
    </div>,
    <div key={`${user.id}-bind`} className="text-xs leading-5">
      <div>Discord：{user.externalAccounts.some((item) => item.platform === "DISCORD") ? "已绑定" : "未绑定"}</div>
      <div>KOOK：{user.externalAccounts.some((item) => item.platform === "KOOK") ? "已绑定" : "未绑定"}</div>
    </div>,
    user.status === "ACTIVE" ? (
      <ActionButton key={`${user.id}-ban`} tone="danger" onClick={() => void updateStatus(user.id, "BANNED")}>封禁</ActionButton>
    ) : (
      <ActionButton key={`${user.id}-activate`} tone="secondary" onClick={() => void updateStatus(user.id, "ACTIVE")}>解封</ActionButton>
    )
  ]);

  return (
    <AdminShell>
      <SectionHeader title="用户管理" desc="真实读取 users 表，管理客户、陪玩、管理员账号。" />
      {error ? <div className="mb-4 rounded-dfc-control border border-dfc-danger/40 bg-dfc-danger/10 px-3 py-2 text-sm text-dfc-danger">{error}</div> : null}
      {status ? <div className="mb-4 rounded-dfc-control border border-dfc-success/40 bg-dfc-success/10 px-3 py-2 text-sm text-dfc-success">{status}</div> : null}
      <DataTable columns={["用户", "资料", "角色", "状态", "钱包", "绑定", "操作"]} rows={rows} />
    </AdminShell>
  );
}

function formatMoney(value: string) {
  return Number(value).toFixed(2);
}

function toChineseError(message?: string) {
  if (!message) return "操作失败";
  if (message.includes("Admin cannot ban self")) return "不能封禁自己的管理员账号";
  if (message.includes("Invalid user status")) return "无效的账号状态";
  return message;
}
