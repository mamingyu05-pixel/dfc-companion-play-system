"use client";

import { useEffect, useMemo, useState } from "react";
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
    kookPricePerHour?: string | null;
    discordPricePerHour?: string | null;
  } | null;
  externalAccounts: Array<{
    platform: string;
    externalUserId: string;
    displayName?: string | null;
  }>;
};

const gameOptions = [
  ["DELTA_FORCE", "三角洲行动"],
  ["LEAGUE_OF_LEGENDS", "英雄联盟"],
  ["VALORANT", "无畏契约"],
  ["COUNTER_STRIKE_2", "CS2"],
  ["PUBG", "PUBG 绝地求生"],
  ["PUBG_MOBILE", "PUBG Mobile"],
  ["APEX_LEGENDS", "Apex 英雄"],
  ["NARAKA_BLADEPOINT", "永劫无间"],
  ["HONOR_OF_KINGS", "王者荣耀"],
  ["PEACEKEEPER_ELITE", "和平精英"],
  ["DOTA_2", "Dota 2"],
  ["OVERWATCH_2", "守望先锋 2"],
  ["RAINBOW_SIX_SIEGE", "彩虹六号：围攻"],
  ["ROCKET_LEAGUE", "火箭联盟"],
  ["EA_SPORTS_FC", "EA Sports FC"],
  ["STREET_FIGHTER_6", "街头霸王 6"],
  ["CALL_OF_DUTY", "使命召唤"],
  ["WILD_RIFT", "英雄联盟手游"],
  ["MOBILE_LEGENDS", "Mobile Legends"],
  ["MINECRAFT", "我的世界"],
  ["GENSHIN_IMPACT", "原神"],
  ["STEAM", "Steam 综合游戏"]
] as const;

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
  const [companionCustomerId, setCompanionCustomerId] = useState("");
  const [companionNickname, setCompanionNickname] = useState("");
  const [companionGame, setCompanionGame] = useState("DELTA_FORCE");
  const [companionGames, setCompanionGames] = useState<string[]>(["DELTA_FORCE"]);
  const [companionPricePerHour, setCompanionPricePerHour] = useState("");
  const [companionKookPricePerHour, setCompanionKookPricePerHour] = useState("");
  const [companionDiscordPricePerHour, setCompanionDiscordPricePerHour] = useState("");
  const [companionNote, setCompanionNote] = useState("");
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

  async function convertCustomerToCompanion() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    if (!companionCustomerId) {
      setError("请先选择要转为陪玩的客户");
      return;
    }

    setError("");
    setStatus("");
    const selectedGames = normalizeSelectedGames(companionGames, companionGame);
    const response = await fetch(`/api/admin/users/${companionCustomerId}/become-companion`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        nickname: companionNickname,
        game: selectedGames[0],
        games: selectedGames,
        pricePerHour: companionPricePerHour,
        kookPricePerHour: companionKookPricePerHour || undefined,
        discordPricePerHour: companionDiscordPricePerHour || undefined,
        note: companionNote
      })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(toFriendlyError(message));
      return;
    }

    setStatus("已把客户转为待审核陪玩。请到陪玩管理页完善资料并审核上架。");
    setCompanionCustomerId("");
    setCompanionNickname("");
    setCompanionGame("DELTA_FORCE");
    setCompanionGames(["DELTA_FORCE"]);
    setCompanionPricePerHour("");
    setCompanionKookPricePerHour("");
    setCompanionDiscordPricePerHour("");
    setCompanionNote("");
    await loadUsers();
  }

  const normalizedSearch = search.trim().toLowerCase();
  const filteredUsers = normalizedSearch
    ? users.filter((user) => getSearchableUserText(user).includes(normalizedSearch))
    : users;
  const customerOptions = users.filter((user) => user.role === "CUSTOMER" && user.status === "ACTIVE");
  const companionCandidateOptions = users.filter(
    (user) => ["CUSTOMER", "ADMIN", "SUPER_ADMIN", "COMPANION"].includes(user.role) && user.status === "ACTIVE" && !user.companionProfile
  );
  const passwordResetOptions = users.filter((user) => user.status === "ACTIVE");
  const promotableUserOptions = users.filter((user) => (user.role === "CUSTOMER" || user.role === "ADMIN") && user.status === "ACTIVE");

  const stats = useMemo(() => {
    const customers = users.filter((user) => user.role === "CUSTOMER").length;
    const companions = users.filter((user) => Boolean(user.companionProfile)).length;
    const admins = users.filter((user) => user.role === "ADMIN" || user.role === "SUPER_ADMIN").length;
    const banned = users.filter((user) => user.status === "BANNED").length;
    return { customers, companions, admins, banned };
  }, [users]);

  const rows = filteredUsers.map((user) => [
    shortId(user.id),
    <div key={`${user.id}-profile`}>
      <div className="font-semibold text-white">{user.displayName}</div>
      <div className="mt-1 text-xs text-dfc-subtext">{formatAccountEmail(user.email)}</div>
      {user.externalAccounts.length ? (
        <div className="mt-1 space-y-1 text-xs text-cyan-200">
          {user.externalAccounts.map((account) => (
            <div key={`${user.id}-${account.platform}-${account.externalUserId}`}>{formatExternalAccount(account)}</div>
          ))}
        </div>
      ) : null}
      <div className="mt-1 text-xs text-dfc-muted">{formatDateTime(user.createdAt)}</div>
      {user.companionProfile?.kookPricePerHour || user.companionProfile?.discordPricePerHour ? (
        <div className="mt-1 text-xs text-dfc-gold">
          {user.companionProfile.kookPricePerHour ? `KOOK ¥${formatMoney(user.companionProfile.kookPricePerHour)}/h ` : ""}
          {user.companionProfile.discordPricePerHour ? `DC ¥${formatMoney(user.companionProfile.discordPricePerHour)}/h` : ""}
        </div>
      ) : null}
      {user.companionProfile ? <div className="mt-1 text-xs text-cyan-200">{user.companionProfile.nickname} / ¥{formatMoney(user.companionProfile.pricePerHour)}/h</div> : null}
    </div>,
    <IdentityBadges key={`${user.id}-roles`} user={user} />,
    <StatusBadge key={`${user.id}-status`} tone={hasInvalidExternalAccount(user) ? "warning" : user.status === "ACTIVE" ? "success" : "danger"}>
      {hasInvalidExternalAccount(user) ? "异常占位" : toUserStatus(user.status)}
    </StatusBadge>,
    <div key={`${user.id}-wallet`} className="text-xs leading-5">
      <div className="font-black text-dfc-gold">余额 ¥{formatMoney(user.wallet?.availableBalance ?? "0")}</div>
      <div className="text-dfc-muted">冻结 ¥{formatMoney(user.wallet?.frozenBalance ?? "0")}</div>
      <div className="text-dfc-muted">收益 ¥{formatMoney(user.wallet?.availableIncome ?? "0")}</div>
    </div>,
    <div key={`${user.id}-bind`} className="text-xs leading-5">
      <div>Discord：{bindingLabel(user, "DISCORD")}</div>
      <div>KOOK：{bindingLabel(user, "KOOK")}</div>
    </div>,
    user.status === "ACTIVE" ? (
      <ActionButton key={`${user.id}-ban`} tone="danger" onClick={() => void updateStatus(user.id, "BANNED")}>封禁</ActionButton>
    ) : (
      <ActionButton key={`${user.id}-activate`} tone="secondary" onClick={() => void updateStatus(user.id, "ACTIVE")}>解封</ActionButton>
    )
  ]);

  return (
    <AdminShell>
      <SectionHeader eyebrow="Account Control" title="用户管理" desc="搜索真实用户，处理人工调账、重置密码、封禁解封，并创建或提升管理员账号。资金动作必须写备注。" />

      <section className="mb-5 grid gap-4 md:grid-cols-4">
        <Signal label="客户" value={String(stats.customers)} hint="可充值下单" tone="cyan" />
        <Signal label="陪玩" value={String(stats.companions)} hint="可接单结算" tone="green" />
        <Signal label="管理员" value={String(stats.admins)} hint="后台权限账号" tone="gold" />
        <Signal label="封禁" value={String(stats.banned)} hint="不可登录或操作" tone="danger" />
      </section>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <section className="mb-6 grid gap-4 xl:grid-cols-2">
        <AdminPanel title="给现有账号开通陪玩身份" hint="适合老客户、管理员前期兼职陪玩。保留原角色、账号、钱包、绑定和历史记录，只新增待审核陪玩资料。">
          <div className="grid gap-3 md:grid-cols-2">
            <select
              value={companionCustomerId}
              onChange={(event) => {
                const nextId = event.target.value;
                setCompanionCustomerId(nextId);
                const selected = users.find((item) => item.id === nextId);
                if (selected && !companionNickname) setCompanionNickname(selected.displayName);
              }}
              className="input"
            >
              <option value="">选择要开通陪玩身份的账号</option>
              {companionCandidateOptions.map((user) => (
                <option key={user.id} value={user.id}>{userOptionLabel(user)}</option>
              ))}
            </select>
            <input value={companionNickname} onChange={(event) => setCompanionNickname(event.target.value)} className="input" placeholder="陪玩昵称" />
            <select
              value={companionGame}
              onChange={(event) => {
                const nextGame = event.target.value;
                setCompanionGame(nextGame);
                setCompanionGames((current) => normalizeSelectedGames(current, nextGame));
              }}
              className="input"
            >
              {gameOptions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
            <input value={companionPricePerHour} onChange={(event) => setCompanionPricePerHour(event.target.value)} className="input" placeholder="每小时价格，例如 100" inputMode="decimal" />
            <input value={companionKookPricePerHour} onChange={(event) => setCompanionKookPricePerHour(event.target.value)} className="input" placeholder="KOOK 单价，可不填" inputMode="decimal" />
            <input value={companionDiscordPricePerHour} onChange={(event) => setCompanionDiscordPricePerHour(event.target.value)} className="input" placeholder="Discord 单价，可不填" inputMode="decimal" />
          </div>
          <GameMultiSelect selectedGames={companionGames} primaryGame={companionGame} onChange={setCompanionGames} />
          <input value={companionNote} onChange={(event) => setCompanionNote(event.target.value)} className="input mt-3" placeholder="备注，例如老客户申请入驻，已完成试音考核" />
          <ActionButton onClick={() => void convertCustomerToCompanion()}>开通待审核陪玩身份</ActionButton>
        </AdminPanel>

        <AdminPanel title="搜索用户 / 人工调账" hint="客户余额手动增加或扣减都会写入钱包流水。">
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="input" placeholder="搜索昵称、邮箱、ID、角色或状态" />
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)} className="input">
              <option value="">选择要调账的客户</option>
              {customerOptions.map((user) => (
                <option key={user.id} value={user.id}>{userOptionLabel(user)}</option>
              ))}
            </select>
            <select value={adjustmentDirection} onChange={(event) => setAdjustmentDirection(event.target.value === "DEBIT" ? "DEBIT" : "CREDIT")} className="input">
              <option value="CREDIT">增加余额</option>
              <option value="DEBIT">扣减余额 / 冲正</option>
            </select>
          </div>
          <input value={creditAmount} onChange={(event) => setCreditAmount(event.target.value)} className="input mt-3" placeholder="金额，例如 300" inputMode="decimal" />
          <input value={creditNote} onChange={(event) => setCreditNote(event.target.value)} className="input mt-3" placeholder="备注，例如微信转账已确认" />
          <button type="button" onClick={() => void creditCustomerBalance()} className={`mt-4 rounded-dfc-control border px-4 py-3 text-sm font-black ${adjustmentDirection === "CREDIT" ? "border-cyan-300/60 bg-cyan-300 text-slate-950" : "border-dfc-gold/60 bg-dfc-gold text-slate-950"}`}>
            {adjustmentDirection === "CREDIT" ? "给客户增加余额" : "扣减客户余额"}
          </button>
        </AdminPanel>

        <AdminPanel title="重置用户密码" hint="用于客户忘记密码或测试账号密码混乱。操作会写入后台日志。">
          <div className="grid gap-3 md:grid-cols-2">
            <select value={passwordResetUserId} onChange={(event) => setPasswordResetUserId(event.target.value)} className="input">
              <option value="">选择要重置密码的用户</option>
              {passwordResetOptions.map((user) => (
                <option key={user.id} value={user.id}>{userOptionLabel(user)} / {user.role}</option>
              ))}
            </select>
            <input value={newUserPassword} onChange={(event) => setNewUserPassword(event.target.value)} className="input" placeholder="新密码，至少 8 位" type="password" autoComplete="new-password" />
          </div>
          <input value={passwordResetNote} onChange={(event) => setPasswordResetNote(event.target.value)} className="input mt-3" placeholder="备注，例如客户忘记密码" />
          <ActionButton onClick={() => void resetUserPassword()}>重置密码</ActionButton>
        </AdminPanel>

        <AdminPanel title="创建管理员账号" hint="仅 SUPER_ADMIN 可创建。新账号会进入管理后台权限体系。">
          <div className="grid gap-3 md:grid-cols-2">
            <input name="new-admin-email" autoComplete="off" inputMode="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} className="input" placeholder="管理员邮箱" />
            <input name="new-admin-display-name" autoComplete="off" value={adminName} onChange={(event) => setAdminName(event.target.value)} className="input" placeholder="管理员昵称" />
            <input name="new-admin-initial-password" autoComplete="new-password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} className="input" placeholder="初始密码，至少 8 位" type="password" />
            <select name="new-admin-role" autoComplete="off" value={adminRole} onChange={(event) => setAdminRole(event.target.value === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN")} className="input">
              <option value="ADMIN">ADMIN</option>
              <option value="SUPER_ADMIN">SUPER_ADMIN</option>
            </select>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton onClick={() => void createAdminAccount()}>创建管理员</ActionButton>
            <ActionButton tone="secondary" onClick={() => { setAdminEmail(""); setAdminName(""); setAdminPassword(""); setAdminRole("ADMIN"); }}>清空</ActionButton>
          </div>
        </AdminPanel>

        <AdminPanel title="把已有用户设为管理员" hint="保留原邮箱和密码，只变更后台角色。陪玩账号不能直接提升。">
          <div className="grid gap-3 md:grid-cols-2">
            <select value={promoteUserId} onChange={(event) => setPromoteUserId(event.target.value)} className="input">
              <option value="">选择已有用户</option>
              {promotableUserOptions.map((user) => (
                <option key={user.id} value={user.id}>{userOptionLabel(user)} / {user.role}</option>
              ))}
            </select>
            <select value={promoteRole} onChange={(event) => setPromoteRole(event.target.value === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN")} className="input">
              <option value="ADMIN">ADMIN</option>
              <option value="SUPER_ADMIN">SUPER_ADMIN</option>
            </select>
          </div>
          <input value={promoteNote} onChange={(event) => setPromoteNote(event.target.value)} className="input mt-3" placeholder="备注，例如邮箱误注册为客户" />
          <ActionButton onClick={() => void promoteExistingUserToAdmin()}>设置为管理员</ActionButton>
        </AdminPanel>
      </section>

      <DataTable columns={["ID", "资料", "角色", "状态", "钱包", "绑定", "操作"]} rows={rows} />
    </AdminShell>
  );
}

function AdminPanel({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="admin-panel">
      <h2 className="text-base font-black text-white">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-dfc-muted">{hint}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function GameMultiSelect({ selectedGames, primaryGame, onChange }: { selectedGames: string[]; primaryGame: string; onChange: (games: string[]) => void }) {
  return (
    <div className="mt-3 rounded-dfc border border-cyan-300/15 bg-[#050711]/50 p-3">
      <div className="text-xs font-black text-dfc-muted">可接游戏，多选</div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {gameOptions.map(([code, name]) => {
          const checked = selectedGames.includes(code);
          const locked = code === primaryGame;
          return (
            <label key={code} className={`rounded-dfc-control border px-3 py-2 text-xs transition ${checked ? "border-cyan-300/60 bg-cyan-300/10 text-white" : "border-cyan-300/15 bg-[#07111f] text-dfc-subtext"}`}>
              <input
                type="checkbox"
                checked={checked}
                disabled={locked}
                onChange={(event) => {
                  const next = event.target.checked ? [...selectedGames, code] : selectedGames.filter((item) => item !== code);
                  onChange(normalizeSelectedGames(next, primaryGame));
                }}
                className="mr-2 accent-cyan-300"
              />
              {name}
              {locked ? <span className="ml-2 text-dfc-gold">主</span> : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function normalizeSelectedGames(values: string[], primaryGame: string) {
  const validGames = new Set(gameOptions.map(([code]) => code));
  return Array.from(new Set([primaryGame, ...values].filter((value) => validGames.has(value as (typeof gameOptions)[number][0]))));
}

function Signal({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: "cyan" | "gold" | "green" | "danger" }) {
  const styles = {
    cyan: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
    gold: "border-dfc-gold/30 bg-dfc-gold/10 text-dfc-gold",
    green: "border-dfc-success/30 bg-dfc-success/10 text-dfc-success",
    danger: "border-dfc-danger/30 bg-dfc-danger/10 text-dfc-danger"
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

function IdentityBadges({ user }: { user: AdminUser }) {
  const badges = [
    { label: toUserRole(user.role), tone: user.role === "SUPER_ADMIN" ? "danger" : user.role === "ADMIN" ? "warning" : "default" },
    user.companionProfile ? { label: "陪玩", tone: user.companionProfile.status === "LISTED" ? "success" : "warning" } : null,
    user.externalAccounts.some((account) => account.platform === "DISCORD") ? { label: "Discord", tone: "default" } : null,
    user.externalAccounts.some((account) => account.platform === "KOOK") ? { label: "KOOK", tone: "default" } : null
  ].filter(Boolean) as Array<{ label: string; tone: "default" | "warning" | "danger" | "success" }>;

  return (
    <div className="flex max-w-44 flex-wrap gap-2">
      {badges.map((badge, index) => (
        <StatusBadge key={`${badge.label}-${index}`} tone={badge.tone}>{badge.label}</StatusBadge>
      ))}
    </div>
  );
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}...` : id;
}

function formatMoney(value: string) {
  return Number(value || 0).toFixed(2);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function getSearchableUserText(user: AdminUser) {
  return [
    user.id,
    user.email,
    user.displayName,
    user.role,
    user.status,
    ...user.externalAccounts.flatMap((account) => [
      account.platform,
      account.externalUserId,
      account.displayName ?? ""
    ])
  ].join(" ").toLowerCase();
}

function formatExternalAccount(account: AdminUser["externalAccounts"][number]) {
  if (!isValidExternalAccount(account)) {
    return `${account.platform}：异常占位ID ${account.externalUserId}`;
  }
  const nickname = account.displayName?.trim() || "未同步昵称";
  return `${account.platform}：${nickname} / ${shortId(account.externalUserId)}`;
}

function bindingLabel(user: AdminUser, platform: "DISCORD" | "KOOK") {
  const account = user.externalAccounts.find((item) => item.platform === platform);
  if (!account) return "未绑定";
  if (!isValidExternalAccount(account)) return `异常占位ID：${account.externalUserId}`;

  const nickname = account.displayName?.trim();
  return nickname ? `已绑定：${nickname}` : `已绑定：${shortId(account.externalUserId)}`;
}

function isValidExternalAccount(account: AdminUser["externalAccounts"][number]) {
  if (account.platform === "KOOK") return /^\d{6,}$/.test(account.externalUserId);
  if (account.platform === "DISCORD") return /^\d{15,22}$/.test(account.externalUserId);
  return true;
}

function hasInvalidExternalAccount(user: AdminUser) {
  return user.externalAccounts.some((account) => !isValidExternalAccount(account));
}

function userOptionLabel(user: AdminUser) {
  const accountText = user.externalAccounts.map(formatExternalAccount).join(" / ");
  return accountText ? `${user.displayName} / ${accountText}` : `${user.displayName} / ${user.email}`;
}

function formatAccountEmail(email: string) {
  if (email.endsWith("@platform.maycatplay.local")) return "平台频道用户";
  return email.endsWith("@oauth.maycatplay.local") ? "第三方注册" : email;
}

function toUserRole(role: string) {
  if (role === "CUSTOMER") return "客户";
  if (role === "COMPANION") return "陪玩";
  if (role === "ADMIN") return "管理员";
  if (role === "SUPER_ADMIN") return "超级管理员";
  return role;
}

function toUserStatus(status: string) {
  if (status === "ACTIVE") return "正常";
  if (status === "BANNED") return "已封禁";
  return status;
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
  if (message.includes("Only customer accounts can become companion")) return "只有客户账号可以转为陪玩";
  if (message.includes("User must be active before becoming companion")) return "用户必须是正常状态才能转为陪玩";
  if (message.includes("Companion profile already exists")) return "该用户已经有陪玩资料";
  if (message.includes("Display name is already taken")) return "该昵称在目标角色下已存在，请先修改昵称";
  if (message.includes("nickname and pricePerHour are required")) return "请填写陪玩昵称和每小时价格";
  if (message.includes("pricePerHour must be a valid amount")) return "请输入正确的每小时价格";
  if (message.includes("pricePerHour must be greater than 0")) return "每小时价格必须大于 0";
  if (message.includes("Customer does not exist or is not active")) return "客户不存在或不可用";
  if (message.includes("amount must be a valid amount")) return "请输入正确金额";
  if (message.includes("amount must be greater than 0")) return "金额必须大于 0";
  if (message.includes("Insufficient available balance")) return "客户可用余额不足，不能扣减到负数";
  if (message.includes("Database migration is not applied")) return "服务端数据库还没更新，请先执行数据库迁移";
  if (message.includes("Related account or wallet data is invalid")) return "客户钱包数据异常，请检查该客户账号";
  return message;
}
