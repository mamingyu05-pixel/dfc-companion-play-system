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
  const [search, setSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditNote, setCreditNote] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminRole, setAdminRole] = useState<"ADMIN" | "SUPER_ADMIN">("ADMIN");
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

  async function creditCustomerBalance() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    if (!selectedCustomerId) {
      setError("请先选择客户");
      return;
    }

    setError("");
    setStatus("");
    const response = await fetch(`/api/admin/users/${selectedCustomerId}/balance-adjustments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ amount: creditAmount, note: creditNote })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join("，") : data.message;
      setError(toChineseError(message));
      return;
    }

    setStatus("客户余额已增加，并已写入钱包流水");
    setCreditAmount("");
    setCreditNote("");
    await loadUsers();
  }

  async function createAdminAccount() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;

    setError("");
    setStatus("");
    const response = await fetch("/api/admin/admins", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: adminEmail,
        displayName: adminName,
        password: adminPassword,
        role: adminRole
      })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join("，") : data.message;
      setError(toChineseError(message));
      return;
    }

    setStatus("管理员账号已创建");
    setAdminEmail("");
    setAdminName("");
    setAdminPassword("");
    setAdminRole("ADMIN");
    await loadUsers();
  }

  const normalizedSearch = search.trim().toLowerCase();
  const filteredUsers = normalizedSearch
    ? users.filter((user) =>
        [user.id, user.email, user.displayName, user.role, user.status].some((value) =>
          value.toLowerCase().includes(normalizedSearch)
        )
      )
    : users;
  const customerOptions = users.filter((user) => user.role === "CUSTOMER" && user.status === "ACTIVE");

  const rows = filteredUsers.map((user) => [
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

      <section className="mb-6 grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">搜索用户 / 人工加余额</h2>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="mt-4 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
            placeholder="搜索昵称、邮箱、ID、角色，例如 66"
          />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <select
              value={selectedCustomerId}
              onChange={(event) => setSelectedCustomerId(event.target.value)}
              className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
            >
              <option value="">选择要加余额的客户</option>
              {customerOptions.map((user) => (
                <option key={user.id} value={user.id}>{user.displayName} · {user.email}</option>
              ))}
            </select>
            <input
              value={creditAmount}
              onChange={(event) => setCreditAmount(event.target.value)}
              className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
              placeholder="加余额金额，例如 300"
              inputMode="decimal"
            />
          </div>
          <input
            value={creditNote}
            onChange={(event) => setCreditNote(event.target.value)}
            className="mt-3 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
            placeholder="备注，例如 微信转账已确认"
          />
          <button
            type="button"
            onClick={() => void creditCustomerBalance()}
            className="mt-4 rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950"
          >
            给客户增加余额
          </button>
        </div>

        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">创建管理员账号</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <input
              value={adminEmail}
              onChange={(event) => setAdminEmail(event.target.value)}
              className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
              placeholder="管理员邮箱"
            />
            <input
              value={adminName}
              onChange={(event) => setAdminName(event.target.value)}
              className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
              placeholder="管理员名称"
            />
            <input
              value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)}
              className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
              placeholder="初始密码，至少 8 位"
              type="password"
            />
            <select
              value={adminRole}
              onChange={(event) => setAdminRole(event.target.value === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN")}
              className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
            >
              <option value="ADMIN">ADMIN</option>
              <option value="SUPER_ADMIN">SUPER_ADMIN</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => void createAdminAccount()}
            className="mt-4 rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950"
          >
            创建管理员
          </button>
          <p className="mt-3 text-xs text-dfc-muted">只有 SUPER_ADMIN 可以创建管理员账号。</p>
        </div>
      </section>

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
  if (message.includes("Only SUPER_ADMIN can create admin accounts")) return "只有超级管理员可以创建管理员账号";
  if (message.includes("Email is already registered")) return "这个邮箱已经注册过";
  if (message.includes("Password must be at least 8 characters")) return "密码至少需要 8 位";
  if (message.includes("Customer does not exist or is not active")) return "客户不存在或已被封禁";
  if (message.includes("amount must be a valid amount")) return "请输入正确金额";
  if (message.includes("amount must be greater than 0")) return "金额必须大于 0";
  return message;
}
