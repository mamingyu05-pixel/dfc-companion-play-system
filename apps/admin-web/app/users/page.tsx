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
    if (!response.ok) throw new Error("Failed to load users");
    setUsers((await response.json()) as AdminUser[]);
  }

  useEffect(() => {
    void loadUsers().catch(() => setError("Failed to load real user data"));
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

    setStatus(nextStatus === "ACTIVE" ? "User activated" : "User banned");
    await loadUsers();
  }

  async function creditCustomerBalance() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    if (!selectedCustomerId) {
      setError("Please select a customer");
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
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(toFriendlyError(message));
      return;
    }

    setStatus("Customer balance credited and wallet transaction recorded");
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
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(toFriendlyError(message));
      return;
    }

    setStatus("Admin account created");
    setAdminEmail("");
    setAdminName("");
    setAdminPassword("");
    setAdminRole("ADMIN");
    await loadUsers();
  }

  const normalizedSearch = search.trim().toLowerCase();
  const filteredUsers = normalizedSearch
    ? users.filter((user) =>
        [user.id, user.email, user.displayName, user.role, user.status].some((value) => value.toLowerCase().includes(normalizedSearch))
      )
    : users;
  const customerOptions = users.filter((user) => user.role === "CUSTOMER" && user.status === "ACTIVE");

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
      <div>Balance ¥{formatMoney(user.wallet?.availableBalance ?? "0")}</div>
      <div>Income ¥{formatMoney(user.wallet?.availableIncome ?? "0")}</div>
    </div>,
    <div key={`${user.id}-bind`} className="text-xs leading-5">
      <div>Discord: {user.externalAccounts.some((item) => item.platform === "DISCORD") ? "Bound" : "Unbound"}</div>
      <div>KOOK: {user.externalAccounts.some((item) => item.platform === "KOOK") ? "Bound" : "Unbound"}</div>
    </div>,
    user.status === "ACTIVE" ? (
      <ActionButton key={`${user.id}-ban`} tone="danger" onClick={() => void updateStatus(user.id, "BANNED")}>Ban</ActionButton>
    ) : (
      <ActionButton key={`${user.id}-activate`} tone="secondary" onClick={() => void updateStatus(user.id, "ACTIVE")}>Activate</ActionButton>
    )
  ]);

  return (
    <AdminShell>
      <SectionHeader title="User Management" desc="Search real users, credit customer balance manually and create admin accounts." />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <section className="mb-6 grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">Search Users / Manual Balance Credit</h2>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="mt-4 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
            placeholder="Search name, email, ID, role or status, e.g. 66"
          />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <select
              value={selectedCustomerId}
              onChange={(event) => setSelectedCustomerId(event.target.value)}
              className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
            >
              <option value="">Select customer to credit</option>
              {customerOptions.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName} / {user.email}
                </option>
              ))}
            </select>
            <input
              value={creditAmount}
              onChange={(event) => setCreditAmount(event.target.value)}
              className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
              placeholder="Amount, e.g. 300"
              inputMode="decimal"
            />
          </div>
          <input
            value={creditNote}
            onChange={(event) => setCreditNote(event.target.value)}
            className="mt-3 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
            placeholder="Note, e.g. WeChat transfer confirmed"
          />
          <button type="button" onClick={() => void creditCustomerBalance()} className="mt-4 rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950">
            Credit Customer Balance
          </button>
        </div>

        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">Create Admin Account</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <input value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" placeholder="Admin email" />
            <input value={adminName} onChange={(event) => setAdminName(event.target.value)} className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" placeholder="Admin display name" />
            <input value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus" placeholder="Initial password, at least 8 chars" type="password" />
            <select value={adminRole} onChange={(event) => setAdminRole(event.target.value === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN")} className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus">
              <option value="ADMIN">ADMIN</option>
              <option value="SUPER_ADMIN">SUPER_ADMIN</option>
            </select>
          </div>
          <button type="button" onClick={() => void createAdminAccount()} className="mt-4 rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950">
            Create Admin
          </button>
          <p className="mt-3 text-xs text-dfc-muted">Only SUPER_ADMIN can create admin accounts.</p>
        </div>
      </section>

      <DataTable columns={["ID", "Profile", "Role", "Status", "Wallet", "Bindings", "Action"]} rows={rows} />
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
  if (!message) return "Operation failed";
  if (message.includes("Admin cannot ban self")) return "Admin cannot ban own account";
  if (message.includes("Invalid user status")) return "Invalid user status";
  if (message.includes("Only SUPER_ADMIN can create admin accounts")) return "Only SUPER_ADMIN can create admin accounts";
  if (message.includes("Email is already registered")) return "Email is already registered";
  if (message.includes("Password must be at least 8 characters")) return "Password must be at least 8 characters";
  if (message.includes("Customer does not exist or is not active")) return "Customer does not exist or is not active";
  if (message.includes("amount must be a valid amount")) return "Please enter a valid amount";
  if (message.includes("amount must be greater than 0")) return "Amount must be greater than 0";
  return message;
}
