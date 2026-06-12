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
  const [adjustmentDirection, setAdjustmentDirection] = useState<"CREDIT" | "DEBIT">("CREDIT");
  const [passwordResetUserId, setPasswordResetUserId] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [passwordResetNote, setPasswordResetNote] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminRole, setAdminRole] = useState<"ADMIN" | "SUPER_ADMIN">("ADMIN");
  const [promoteUserId, setPromoteUserId] = useState("");
  const [promoteRole, setPromoteRole] = useState<"ADMIN" | "SUPER_ADMIN">("ADMIN");
  const [promoteNote, setPromoteNote] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function loadUsers() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;

    const response = await fetch("/api/admin/users", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("无法加载用户");
    setUsers((await response.json()) as AdminUser[]);
  }

  useEffect(() => {
    void loadUsers().catch(() => setError("无法加载真实用户数据"));
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
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(toFriendlyError(message));
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
      body: JSON.stringify({ amount: creditAmount, note: creditNote, direction: adjustmentDirection })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(toFriendlyError(message));
      return;
    }

    setStatus(adjustmentDirection === "CREDIT" ? "客户余额已增加，并已写入钱包流水" : "客户余额已扣减，并已写入冲正流水");
    setCreditAmount("");
    setCreditNote("");
    await loadUsers();
  }

  async function resetUserPassword() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    if (!passwordResetUserId) {
      setError("请先选择要重置密码的用户");
      return;
    }
    if (newUserPassword.length < 8) {
      setError("新密码至少 8 位");
      return;
    }

    setError("");
    setStatus("");
    const response = await fetch(`/api/admin/users/${passwordResetUserId}/password`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ password: newUserPassword, note: passwordResetNote })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(toFriendlyError(message));
      return;
    }

    setStatus("用户密码已重置，可以用新密码登录对应入口");
    setNewUserPassword("");
    setPasswordResetNote("");
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
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(toFriendlyError(message));
      return;
    }

    setStatus("管理员账号已创建");
    setAdminEmail("");
    setAdminName("");
    setAdminPassword("");
    setAdminRole("ADMIN");
    await loadUsers();
  }

  async function promoteExistingUserToAdmin() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    if (!promoteUserId) {
      setError("请先选择要设置为管理员的用户");
      return;
    }

    setError("");
    setStatus("");
    const response = await fetch(`/api/admin/users/${promoteUserId}/role`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ role: promoteRole, note: promoteNote })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(toFriendlyError(message));
      return;
    }

    setStatus("已把现有用户设置为管理员，该用户可用原邮箱和密码登录管理端");
    setPromoteUserId("");
    setPromoteRole("ADMIN");
    setPromoteNote("");
    await loadUsers();
  }

  const normalizedSearch = search.trim().toLowerCase();
  const filteredUsers = normalizedSearch
    ? users.filter((user) =>
        [user.id, user.email, user.displayName, user.role, user.status].some((value) => value.toLowerCase().includes(normalizedSearch))
      )
    : users;
  const customerOptions = users.filter((user) => user.role === "CUSTOMER" && user.status === "ACTIVE");
  const passwordResetOptions = users.filter((user) => user.status === "ACTIVE");
  const promotableUserOptions = users.filter((user) => (user.role === "CUSTOMER" || user.role === "ADMIN") && user.status === "ACTIVE");

  const rows = filteredUsers.map((user) => [
    user.id,
    <div key={`${user.id}-profile`}>
      <div className="font-medium text-dfc-text">{user.displayName}</div>
      <div className="mt-1 text-xs text-dfc-subtext">{user.email}</div>
      <div className="mt-1 text-xs text-dfc-muted">{new Date(user.createdAt).toLocaleString()}</div>
    </div>,
    user.role,
    <StatusBadge key={`${user.id}-status`} tone={user.status === "ACTIVE" ? "success" : "danger"}>{user.status}</StatusBadge>,
    <div key={`${user.id}-wallet`} className="text-xs leading-5">
      <div>余额 ¥{formatMoney(user.wallet?.availableBalance ?? "0")}</div>
      <div>收入 ¥{formatMoney(user.wallet?.availableIncome ?? "0")}</div>
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
      <SectionHeader title="用户管理" desc="搜索真实用户，给客户人工调账，并创建管理员账号。" />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <section className="mb-6 grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">搜索用户 / 人工调账</h2>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="mt-4 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
            placeholder="搜索昵称、邮箱、ID、角色或状态，例如 66"
          />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <select
              value={selectedCustomerId}
              onChange={(event) => setSelectedCustomerId(event.target.value)}
              className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
            >
              <option value="">选择要调账的客户</option>
              {customerOptions.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName} / {user.email}
                </option>
              ))}
            </select>
            <select
              value={adjustmentDirection}
              onChange={(event) => setAdjustmentDirection(event.target.value === "DEBIT" ? "DEBIT" : "CREDIT")}
              className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
            >
              <option value="CREDIT">增加余额</option>
              <option value="DEBIT">扣减余额 / 冲正</option>
            </select>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-1">
            <input
              value={creditAmount}
              onChange={(event) => setCreditAmount(event.target.value)}
              className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
              placeholder="金额，例如 300"
              inputMode="decimal"
            />
          </div>
          <input
            value={creditNote}
            onChange={(event) => setCreditNote(event.target.value)}
            className="mt-3 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
            placeholder="备注，例如微信转账已确认"
          />
          <button
            type="button"
            onClick={() => void creditCustomerBalance()}
            className={`mt-4 rounded-dfc-control px-4 py-3 text-sm font-semibold ${
              adjustmentDirection === "CREDIT" ? "bg-dfc-blue text-slate-950" : "bg-dfc-warning text-slate-950"
            }`}
          >
            {adjustmentDirection === "CREDIT" ? "给客户增加余额" : "扣减客户余额"}
          </button>
          <p className="mt-3 text-xs text-dfc-muted">扣减用于测试回滚、误加款冲正。系统会保留正反两条流水，禁止直接删账。</p>
        </div>

        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">重置用户密码</h2>
          <p className="mt-2 text-xs text-dfc-muted">客户忘记密码或测试账号密码混乱时使用。操作会写入后台日志。</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <select
              value={passwordResetUserId}
              onChange={(event) => setPasswordResetUserId(event.target.value)}
              className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
            >
              <option value="">选择要重置密码的用户</option>
              {passwordResetOptions.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName} / {user.email} / {user.role}
                </option>
              ))}
            </select>
            <input
              value={newUserPassword}
              onChange={(event) => setNewUserPassword(event.target.value)}
              className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
              placeholder="新密码，至少 8 位"
              type="password"
              autoComplete="new-password"
            />
          </div>
          <input
            value={passwordResetNote}
            onChange={(event) => setPasswordResetNote(event.target.value)}
            className="mt-3 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
            placeholder="备注，例如客户忘记密码"
          />
          <button type="button" onClick={() => void resetUserPassword()} className="mt-4 rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950">
            重置密码
          </button>
        </div>

        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">创建管理员账号</h2>
          <div className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0" aria-hidden="true">
            <input name="username" autoComplete="username" tabIndex={-1} />
            <input name="password" type="password" autoComplete="current-password" tabIndex={-1} />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <input
              name="new-admin-email"
              autoComplete="off"
              inputMode="email"
              value={adminEmail}
              onChange={(event) => setAdminEmail(event.target.value)}
              className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
              placeholder="管理员邮箱"
            />
            <input
              name="new-admin-display-name"
              autoComplete="off"
              value={adminName}
              onChange={(event) => setAdminName(event.target.value)}
              className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
              placeholder="管理员昵称"
            />
            <input
              name="new-admin-initial-password"
              autoComplete="new-password"
              value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)}
              className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
              placeholder="初始密码，至少 8 位"
              type="password"
            />
            <select name="new-admin-role" autoComplete="off" value={adminRole} onChange={(event) => setAdminRole(event.target.value === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN")} className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus">
              <option value="ADMIN">ADMIN</option>
              <option value="SUPER_ADMIN">SUPER_ADMIN</option>
            </select>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void createAdminAccount()} className="rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950">
              创建管理员
            </button>
            <button
              type="button"
              onClick={() => {
                setAdminEmail("");
                setAdminName("");
                setAdminPassword("");
                setAdminRole("ADMIN");
              }}
              className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-4 py-3 text-sm font-semibold text-dfc-subtext"
            >
              清空
            </button>
          </div>
          <div className="mt-6 border-t border-dfc-border pt-4">
            <h3 className="text-sm font-semibold">把已有用户设为管理员</h3>
            <p className="mt-2 text-xs text-dfc-muted">用于邮箱已经注册成客户账号的情况。会保留原邮箱和密码，只改变后台角色。</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <select
                value={promoteUserId}
                onChange={(event) => setPromoteUserId(event.target.value)}
                className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
              >
                <option value="">选择已有用户</option>
                {promotableUserOptions.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName} / {user.email} / {user.role}
                  </option>
                ))}
              </select>
              <select
                value={promoteRole}
                onChange={(event) => setPromoteRole(event.target.value === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN")}
                className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
              >
                <option value="ADMIN">ADMIN</option>
                <option value="SUPER_ADMIN">SUPER_ADMIN</option>
              </select>
            </div>
            <input
              value={promoteNote}
              onChange={(event) => setPromoteNote(event.target.value)}
              className="mt-3 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
              placeholder="备注，例如邮箱误注册为客户"
            />
            <button type="button" onClick={() => void promoteExistingUserToAdmin()} className="mt-4 rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950">
              设置为管理员
            </button>
          </div>
          <p className="mt-3 text-xs text-dfc-muted">只有 SUPER_ADMIN 可以创建管理员账号。</p>
        </div>
      </section>

      <DataTable columns={["ID", "资料", "角色", "状态", "钱包", "绑定", "操作"]} rows={rows} />
    </AdminShell>
  );
}

function Alert({ children, tone }: { children: string; tone: "danger" | "success" }) {
  const cls = tone === "danger" ? "border-dfc-danger/40 bg-dfc-danger/10 text-dfc-danger" : "border-dfc-success/40 bg-dfc-success/10 text-dfc-success";
  return <div className={`mb-4 rounded-dfc-control border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

function formatMoney(value: string) {
  return Number(value || 0).toFixed(2);
}

function toFriendlyError(message?: string) {
  if (!message) return "操作失败";
  if (message.includes("Admin cannot ban self")) return "不能封禁自己的管理员账号";
  if (message.includes("Invalid user status")) return "无效账号状态";
  if (message.includes("Only SUPER_ADMIN can create admin accounts")) return "只有超级管理员可以创建管理员账号";
  if (message.includes("Only SUPER_ADMIN can update admin roles")) return "只有超级管理员可以设置管理员角色";
  if (message.includes("Only SUPER_ADMIN can reset admin passwords")) return "只有超级管理员可以重置管理员密码";
  if (message.includes("Email is already registered")) return "该邮箱已注册";
  if (message.includes("Password must be at least 8 characters")) return "密码至少 8 位";
  if (message.includes("User does not exist")) return "用户不存在";
  if (message.includes("User must be active before becoming admin")) return "用户必须是 ACTIVE 状态才能设置为管理员";
  if (message.includes("Companion accounts cannot be promoted to admin")) return "陪玩账号不能直接设置为管理员，请单独创建管理员账号";
  if (message.includes("Display name is already taken")) return "该昵称在目标角色下已存在，请先修改昵称";
  if (message.includes("Customer does not exist or is not active")) return "客户不存在或不可用";
  if (message.includes("amount must be a valid amount")) return "请输入正确金额";
  if (message.includes("amount must be greater than 0")) return "金额必须大于 0";
  if (message.includes("Insufficient available balance")) return "客户可用余额不足，不能扣减到负数";
  if (message.includes("Database migration is not applied")) return "服务器数据库还没更新，请先执行数据库迁移";
  if (message.includes("Related account or wallet data is invalid")) return "客户钱包数据异常，请检查该客户账号";
  return message;
}
