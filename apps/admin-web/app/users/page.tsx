"use client";

import { useEffect, useRef, useState } from "react";
import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";
import { adminApi, BatchBar, BatchButton, ExportButton, SelectBox, useSelection } from "../batch-tools";
import { createMoneyIntentClient, emptyMoneyIntentState, type MoneyIntentState } from "@dfc/ui";

import { createLatestUserLoader, emptyUserLoadState, userDirectoryPath, userOptionsPath, decodeUserDirectory, decodeUserOptions, lastUserPage, type AdminUser, type UserStats, type UserDirectory, type UserOptions, type UserOptionPurpose, type UserLoadState } from "./user-directory-client";

const gameOptions = [
  ["DELTA_FORCE", "三角洲行动"],
  ["LEAGUE_OF_LEGENDS", "英雄联盟"],
  ["VALORANT", "无畏契约"],
  ["COUNTER_STRIKE_2", "CS2"],
  ["PUBG", "PUBG 绝地求生"],
  ["APEX_LEGENDS", "Apex 英雄"],
  ["NARAKA_BLADEPOINT", "永劫无间"],
  ["CALL_OF_DUTY", "塔科夫 / COD"]
] as const;

export default function UsersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const query = useDebouncedUserSearch(search);
  const [directory, setDirectory] = useState<UserLoadState<UserDirectory>>(emptyUserLoadState);
  const directoryLoader = useRef<ReturnType<typeof createLatestUserLoader<UserDirectory>> | null>(null);
  const directoryRequest = useRef({ query, page });
  directoryRequest.current = { query, page };
  const lastStats = useRef<UserStats | null>(null);
  const [optionsRevision, setOptionsRevision] = useState(0);
  const [customerSearch, setCustomerSearch] = useState("");
  const [companionSearch, setCompanionSearch] = useState("");
  const [passwordSearch, setPasswordSearch] = useState("");
  const [promotionSearch, setPromotionSearch] = useState("");
  const selection = useSelection();
  const [batchBusy, setBatchBusy] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditNote, setCreditNote] = useState("");
  const [adjustmentDirection, setAdjustmentDirection] = useState<"CREDIT" | "DEBIT">("CREDIT");
  const adjustmentMoney = useRef<ReturnType<typeof createMoneyIntentClient> | null>(null);
  const [adjustmentIntent, setAdjustmentIntent] = useState<MoneyIntentState>(emptyMoneyIntentState);
  const adjustmentLocked = adjustmentIntent.busy || !adjustmentIntent.connected || adjustmentIntent.phase !== "empty";
  const [passwordResetUserId, setPasswordResetUserId] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [passwordResetNote, setPasswordResetNote] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminRole, setAdminRole] = useState<"ADMIN" | "SUPER_ADMIN">("ADMIN");
  const [promoteUserId, setPromoteUserId] = useState("");
  const [promoteRole, setPromoteRole] = useState<"CUSTOMER" | "ADMIN" | "SUPER_ADMIN">("ADMIN");
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
  const [isUserTableOpen, setIsUserTableOpen] = useState(true);

  async function loadUsers(refreshOptions = true) {
    if (refreshOptions) setOptionsRevision(value => value + 1);
    const request = directoryRequest.current;
    const result = await directoryLoader.current?.load(userDirectoryPath(request.query, request.page), value => decodeUserDirectory(value, request.page));
    if (result && request.query === directoryRequest.current.query && request.page === directoryRequest.current.page && request.page > lastUserPage(result.total, result.limit)) {
      setPage(lastUserPage(result.total, result.limit));
      selection.clear();
    }
    return result;
  }

  useEffect(() => {
    const loader = createLatestUserLoader<UserDirectory>({ fetcher: fetch, getToken: () => localStorage.getItem("dfc_admin_token"),
      onChange: state => {
        if (state.data) lastStats.current = state.data.stats;
        else if (!state.loading) lastStats.current = null;
        setDirectory(state);
      } });
    directoryLoader.current = loader;
    selection.clear();
    void loadUsers(false);
    return () => { loader.dispose(); if (directoryLoader.current === loader) directoryLoader.current = null; };
  }, [query, page]);

  function changeSearch(value: string) { selection.clear(); setSearch(value); setPage(1); }
  function changePage(value: number) { selection.clear(); setPage(value); }

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

  async function runAdjustment(action: () => Promise<MoneyIntentState>) {
    if (!adjustmentMoney.current || adjustmentMoney.current.state().busy) return null;
    setAdjustmentIntent({ ...adjustmentMoney.current.state(), busy: true });
    const next = await action();
    setAdjustmentIntent(next); setError(next.error ? toFriendlyError(next.error) : "");
    if (next.body) {
      setSelectedCustomerId(next.targetId ?? ""); setCreditAmount(String(next.body.amount));
      setCreditNote(String(next.body.note ?? "")); setAdjustmentDirection(next.body.direction === "DEBIT" ? "DEBIT" : "CREDIT");
    } else if (adjustmentIntent.subject && next.subject !== adjustmentIntent.subject) {
      setSelectedCustomerId(""); setCreditAmount(""); setCreditNote(""); setCustomerSearch(""); setStatus("");
    }
    return next;
  }

  useEffect(() => {
    adjustmentMoney.current = createMoneyIntentClient({ purpose: "manual-adjustment",
      storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key) },
      fetcher: fetch, getToken: () => localStorage.getItem("dfc_admin_token"), makeRequestId: () => crypto.randomUUID(), scope: window.location.origin });
    void runAdjustment(() => adjustmentMoney.current!.refresh());
  }, []);

  async function refreshAfterAdjustment(next: MoneyIntentState | null) {
    if (next?.phase !== "confirmed" || next.error) return;
    setStatus("原人工调账已确认，最新余额请核对刷新后的用户列表。");
    try { if (!await loadUsers()) setStatus("原人工调账已确认，用户余额尚未刷新。请刷新用户列表，不要重新调账。"); }
    catch { setStatus("原人工调账已确认，用户余额尚未刷新。请刷新用户列表，不要重新调账。"); }
  }

  async function creditCustomerBalance() {
    if (adjustmentLocked || !adjustmentMoney.current || !customerLookup.selectedAvailable) return;
    if (!selectedCustomerId) { setError("请先选择客户"); return; }
    setStatus("");
    const customer = customerLookup.selectedUser;
    const next = await runAdjustment(() => adjustmentMoney.current!.submit({ customerId: selectedCustomerId, amount: creditAmount.trim(), note: creditNote, direction: adjustmentDirection }, customer?.displayName ?? selectedCustomerId));
    await refreshAfterAdjustment(next);
  }

  async function retryAdjustment() {
    const next = await runAdjustment(() => adjustmentMoney.current!.retry());
    await refreshAfterAdjustment(next);
  }

  async function newAdjustment() {
    const next = await runAdjustment(() => adjustmentMoney.current!.beginNew());
    if (next?.phase === "empty" && !next.error) {
      setSelectedCustomerId(""); setCreditAmount(""); setCreditNote(""); setAdjustmentDirection("CREDIT"); setCustomerSearch(""); setStatus("");
    }
  }

  async function resetUserPassword() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    if (!passwordResetUserId || !passwordLookup.selectedAvailable) {
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
    if (!promoteUserId || !promotionLookup.selectedAvailable) {
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

    setStatus(promoteRole === "CUSTOMER" ? "已取消该用户的后台管理员权限" : "已更新现有用户的后台权限，该用户可用原邮箱和密码登录管理端");
    setPromoteUserId("");
    setPromoteRole("ADMIN");
    setPromoteNote("");
    await loadUsers();
  }

  async function convertCustomerToCompanion() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    if (!companionCustomerId || !companionLookup.selectedAvailable) {
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

  const customerLookup = useUserOptions("balance-adjustment", customerSearch, selectedCustomerId, optionsRevision);
  const companionLookup = useUserOptions("companion-onboarding", companionSearch, companionCustomerId, optionsRevision);
  const passwordLookup = useUserOptions("password-reset", passwordSearch, passwordResetUserId, optionsRevision);
  const promotionLookup = useUserOptions("admin-promotion", promotionSearch, promoteUserId, optionsRevision);
  const customerOptions = customerLookup.items;
  const companionCandidateOptions = companionLookup.items;
  const passwordResetOptions = passwordLookup.items;
  const promotableUserOptions = promotionLookup.items;
  const listPath = userDirectoryPath(query, page);
  const searchPending = normalizeSearchValue(search) !== query;
  const pageData = directory.path === listPath && !searchPending ? directory.data : null;
  const listReady = Boolean(pageData) && !directory.loading && !directory.error && !searchPending;
  const filteredUsers = listReady ? pageData!.items : [];
  const stats = lastStats.current;
  const maxPage = pageData ? lastUserPage(pageData.total, pageData.limit) : page;

  // Staff accounts are never batch-selectable; the server refuses them too.
  const selectableIds = filteredUsers.filter((user) => user.role === "CUSTOMER" || user.role === "COMPANION").map((user) => user.id);
  async function batchStatus(next: "ACTIVE" | "BANNED") {
    if (!listReady || selection.selected.some(id => !selectableIds.includes(id))) { selection.clear(); setError("列表已变化，请在当前页重新选择账号。"); return; }
    const label = next === "BANNED" ? "封禁" : "解封";
    if (!window.confirm(`批量${label} ${selection.selected.length} 个账号？`)) return;
    setBatchBusy(true); setError(""); setStatus("");
    try {
      const result = await adminApi<{ updated: number }>("/api/admin/batch/users/status", { method: "POST", body: JSON.stringify({ ids: selection.selected, status: next }) });
      setStatus(`已批量${label} ${result.updated} 个账号`);
      selection.clear();
      await loadUsers();
    } catch (err) { setError(err instanceof Error ? err.message : "批量操作失败"); }
    finally { setBatchBusy(false); }
  }
  const rows = filteredUsers.map((user) => [
    selectableIds.includes(user.id)
      ? <SelectBox key={`${user.id}-pick`} label={`选择 ${user.displayName}`} checked={selection.has(user.id)} onChange={() => selection.toggle(user.id)} />
      : <span key={`${user.id}-pick`} />,
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
      <div className="mb-4"><ExportButton kind="users" label="用户" /></div>

      <section className="mb-5 grid gap-4 md:grid-cols-4">
        <Signal label="客户" value={stats ? String(stats.customers) : "待核对"} hint="可充值下单" tone="cyan" />
        <Signal label="陪玩" value={stats ? String(stats.companions) : "待核对"} hint="可接单结算" tone="green" />
        <Signal label="管理员" value={stats ? String(stats.admins) : "待核对"} hint="后台权限账号" tone="gold" />
        <Signal label="封禁" value={stats ? String(stats.banned) : "待核对"} hint="不可登录或操作" tone="danger" />
      </section>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <section className="mb-6 grid gap-4 xl:grid-cols-2">
        <AdminPanel title="给现有账号开通陪玩身份" hint="适合老客户、管理员前期兼职陪玩。保留原角色、账号、钱包、绑定和历史记录，只新增待审核陪玩资料。">
          <input value={companionSearch} onChange={event => setCompanionSearch(event.target.value)} className="input mb-3" maxLength={512} placeholder="搜索要开通陪玩的账号" />
          <div className="grid gap-3 md:grid-cols-2">
            <select
              value={companionCustomerId}
              disabled={companionLookup.loading}
              onChange={(event) => {
                const nextId = event.target.value;
                setCompanionCustomerId(nextId);
                const selected = companionCandidateOptions.find((item) => item.id === nextId);
                if (selected && !companionNickname) setCompanionNickname(selected.displayName);
              }}
              className="input"
            >
              <option value="">选择要开通陪玩身份的账号</option>
              <RetainedUserOption selectedId={companionCustomerId} lookup={companionLookup} />
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
          <UserOptionsHint lookup={companionLookup} selectedId={companionCustomerId} />
          <GameMultiSelect selectedGames={companionGames} primaryGame={companionGame} onChange={setCompanionGames} onPrimaryGameChange={setCompanionGame} />
          <input value={companionNote} onChange={(event) => setCompanionNote(event.target.value)} className="input mt-3" placeholder="备注，例如老客户申请入驻，已完成试音考核" />
          <ActionButton disabled={!companionLookup.selectedAvailable} onClick={() => void convertCustomerToCompanion()}>开通待审核陪玩身份</ActionButton>
        </AdminPanel>

        <AdminPanel title="搜索用户 / 人工调账" hint="客户余额手动增加或扣减都会写入钱包流水。">
          <button type="button" disabled={adjustmentIntent.busy} onClick={() => void runAdjustment(() => adjustmentMoney.current!.refresh())}>核对登录与原调账</button>
          {adjustmentIntent.phase !== "empty" ? <section role="status" className="mt-3 rounded border border-cyan-300/30 p-3">
            <p>原调账申请：{String(adjustmentIntent.body?.requestId)}</p>
            <p>{adjustmentIntent.targetLabel || adjustmentIntent.targetId} · {adjustmentIntent.body?.direction === "DEBIT" ? "扣减余额" : "增加余额"} ¥{String(adjustmentIntent.body?.amount)}</p>
            <p>{adjustmentIntent.phase === "confirmed" ? "原调账回执已确认并保留。它不是实时余额；最新余额请核对用户列表。明确另记一笔后才会生成新编号。" : "原调账结果待核对，客户、方向、金额和备注已保留。请使用原编号核对，不要另记一笔。"}</p>
            {adjustmentIntent.receipt?.transaction ? <p>原流水：{String((adjustmentIntent.receipt.transaction as { id?: string }).id)}</p> : null}
            {adjustmentIntent.phase === "confirmed" ? <button type="button" disabled={adjustmentIntent.busy} onClick={() => void newAdjustment()}>另记一笔调账</button>
              : <button type="button" disabled={adjustmentIntent.busy} onClick={() => void retryAdjustment()}>核对原调账</button>}
          </section> : null}
          <input value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} className="input" maxLength={512} placeholder="搜索昵称、邮箱、ID、角色或状态" />
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <select disabled={adjustmentLocked || customerLookup.loading} value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)} className="input">
              <option value="">选择要调账的客户</option>
              {adjustmentIntent.targetId && !customerOptions.some(user => user.id === adjustmentIntent.targetId) ? <option value={adjustmentIntent.targetId}>原客户：{adjustmentIntent.targetLabel || adjustmentIntent.targetId}</option> : null}
              {!adjustmentIntent.targetId ? <RetainedUserOption selectedId={selectedCustomerId} lookup={customerLookup} /> : null}
              {customerOptions.map((user) => (
                <option key={user.id} value={user.id}>{userOptionLabel(user)}</option>
              ))}
            </select>
            <select disabled={adjustmentLocked} value={adjustmentDirection} onChange={(event) => setAdjustmentDirection(event.target.value === "DEBIT" ? "DEBIT" : "CREDIT")} className="input">
              <option value="CREDIT">增加余额</option>
              <option value="DEBIT">扣减余额 / 冲正</option>
            </select>
          </div>
          {adjustmentIntent.phase === "empty" ? <UserOptionsHint lookup={customerLookup} selectedId={selectedCustomerId} /> : <p className="mt-2 text-xs text-dfc-muted">原调账客户已保留，核对结果不受当前目录搜索影响。</p>}
          <input disabled={adjustmentLocked} value={creditAmount} onChange={(event) => setCreditAmount(event.target.value)} className="input mt-3" placeholder="金额，例如 300" inputMode="decimal" />
          <input disabled={adjustmentLocked} value={creditNote} onChange={(event) => setCreditNote(event.target.value)} className="input mt-3" placeholder="备注，例如微信转账已确认" />
          <button type="button" disabled={adjustmentLocked || !customerLookup.selectedAvailable} onClick={() => void creditCustomerBalance()} className={`mt-4 rounded-dfc-control border px-4 py-3 text-sm font-black ${adjustmentDirection === "CREDIT" ? "border-cyan-300/60 bg-cyan-300 text-slate-950" : "border-dfc-gold/60 bg-dfc-gold text-slate-950"}`}>
            {adjustmentDirection === "CREDIT" ? "给客户增加余额" : "扣减客户余额"}
          </button>
        </AdminPanel>

        <AdminPanel title="重置用户密码" hint="用于客户忘记密码或测试账号密码混乱。操作会写入后台日志。">
          <input value={passwordSearch} onChange={event => setPasswordSearch(event.target.value)} className="input mb-3" maxLength={512} placeholder="搜索要重置密码的账号" />
          <div className="grid gap-3 md:grid-cols-2">
            <select disabled={passwordLookup.loading} value={passwordResetUserId} onChange={(event) => setPasswordResetUserId(event.target.value)} className="input">
              <option value="">选择要重置密码的用户</option>
              <RetainedUserOption selectedId={passwordResetUserId} lookup={passwordLookup} />
              {passwordResetOptions.map((user) => (
                <option key={user.id} value={user.id}>{userOptionLabel(user)} / {user.role}</option>
              ))}
            </select>
            <input value={newUserPassword} onChange={(event) => setNewUserPassword(event.target.value)} className="input" placeholder="新密码，至少 8 位" type="password" autoComplete="new-password" />
          </div>
          <UserOptionsHint lookup={passwordLookup} selectedId={passwordResetUserId} />
          <input value={passwordResetNote} onChange={(event) => setPasswordResetNote(event.target.value)} className="input mt-3" placeholder="备注，例如客户忘记密码" />
          <ActionButton disabled={!passwordLookup.selectedAvailable} onClick={() => void resetUserPassword()}>重置密码</ActionButton>
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

        <AdminPanel title="更新已有用户后台角色" hint="保留原邮箱、密码、钱包、平台绑定和陪玩资料，只调整后台角色。选 CUSTOMER 可取消误设的管理员权限。">
          <input value={promotionSearch} onChange={event => setPromotionSearch(event.target.value)} className="input mb-3" maxLength={512} placeholder="搜索要更新角色的账号" />
          <div className="grid gap-3 md:grid-cols-2">
            <select disabled={promotionLookup.loading} value={promoteUserId} onChange={(event) => setPromoteUserId(event.target.value)} className="input">
              <option value="">选择已有用户</option>
              <RetainedUserOption selectedId={promoteUserId} lookup={promotionLookup} />
              {promotableUserOptions.map((user) => (
                <option key={user.id} value={user.id}>{userOptionLabel(user)} / {user.role}</option>
              ))}
            </select>
            <select
              value={promoteRole}
              onChange={(event) => {
                const nextRole = event.target.value;
                setPromoteRole(nextRole === "SUPER_ADMIN" ? "SUPER_ADMIN" : nextRole === "CUSTOMER" ? "CUSTOMER" : "ADMIN");
              }}
              className="input"
            >
              <option value="CUSTOMER">CUSTOMER（取消管理员）</option>
              <option value="ADMIN">ADMIN</option>
              <option value="SUPER_ADMIN">SUPER_ADMIN</option>
            </select>
          </div>
          <UserOptionsHint lookup={promotionLookup} selectedId={promoteUserId} />
          <input value={promoteNote} onChange={(event) => setPromoteNote(event.target.value)} className="input mt-3" placeholder="备注，例如邮箱误注册为客户" />
          <ActionButton disabled={!promotionLookup.selectedAvailable} onClick={() => void promoteExistingUserToAdmin()}>更新后台角色</ActionButton>
        </AdminPanel>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex flex-col gap-3 rounded-dfc border border-cyan-300/15 bg-[#0a1020]/75 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-black text-white">用户列表</h2>
            <p className="mt-1 text-xs text-dfc-muted">
              当前页 {filteredUsers.length} 个账号，共 {pageData ? pageData.total : "待核对"} 个匹配账号；每页 50 个。
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 md:w-auto md:min-w-[420px] md:flex-row md:items-center">
            <input
              value={search}
              onChange={(event) => changeSearch(event.target.value)}
              className="input md:min-w-72"
              maxLength={512}
              placeholder="搜索昵称、邮箱、ID、Discord / KOOK"
            />
            {search ? (
              <button
                type="button"
                onClick={() => changeSearch("")}
                className="rounded-dfc-control border border-cyan-300/20 bg-[#050711] px-3 py-2 text-xs font-black text-dfc-subtext transition hover:border-cyan-300/50 hover:text-cyan-100"
              >
                清空
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setIsUserTableOpen((value) => !value)}
              className="shrink-0 rounded-dfc-control border border-cyan-300/30 bg-[#050711] px-4 py-2 text-xs font-black text-cyan-100 transition hover:border-cyan-300/60"
            >
              {isUserTableOpen ? "收起列表" : "展开列表"}
            </button>
          </div>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-3" aria-label="用户目录分页">
          <button type="button" className="rounded-dfc-control border px-3 py-2 disabled:opacity-40" disabled={!listReady || page <= 1} onClick={() => changePage(page - 1)}>上一页</button>
          <span className="text-sm">第 {page} / {pageData ? maxPage : "待核对"} 页</span>
          <button type="button" className="rounded-dfc-control border px-3 py-2 disabled:opacity-40" disabled={!listReady || page >= maxPage} onClick={() => changePage(page + 1)}>下一页</button>
          <button type="button" className="rounded-dfc-control border px-3 py-2 disabled:opacity-40" disabled={directory.loading || searchPending} onClick={() => void loadUsers()}>刷新列表</button>
        </div>
        {directory.error ? <div role="alert" className="mb-3 text-sm text-dfc-danger">{directory.error}</div> : null}
        {listReady && !filteredUsers.length ? <p className="mb-3 text-sm">没有匹配的用户，请更换搜索条件。</p> : null}
        {isUserTableOpen && listReady ? (
          <DataTable
            columns={[<SelectBox key="all" label="全选当前页的客户和陪玩" checked={selectableIds.length > 0 && selectableIds.every((id) => selection.has(id))} onChange={() => selection.toggleAll(selectableIds)} />, "ID", "资料", "角色", "状态", "钱包", "绑定", "操作"]}
            rows={rows}
            maxHeightClassName="max-h-[620px]"
            stickyHeader
          />
        ) : (
          <div className="rounded-dfc border border-cyan-300/15 bg-[#050711]/75 px-4 py-6 text-sm text-dfc-subtext">
            {isUserTableOpen ? (directory.error ? "用户列表尚未确认，请重试加载。" : "正在加载用户列表…") : "用户列表已收起。需要查看、封禁或搜索结果时点击“展开列表”。"}
          </div>
        )}
        <BatchBar count={selection.selected.length} onClear={selection.clear}>
          <BatchButton tone="danger" disabled={batchBusy || !listReady} onClick={() => void batchStatus("BANNED")}>批量封禁</BatchButton>
          <BatchButton tone="plain" disabled={batchBusy || !listReady} onClick={() => void batchStatus("ACTIVE")}>批量解封</BatchButton>
        </BatchBar>
      </section>
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

function GameMultiSelect({
  selectedGames,
  primaryGame,
  onChange,
  onPrimaryGameChange
}: {
  selectedGames: string[];
  primaryGame: string;
  onChange: (games: string[]) => void;
  onPrimaryGameChange: (game: string) => void;
}) {
  return (
    <div className="mt-3 rounded-dfc border border-cyan-300/15 bg-[#050711]/50 p-3">
      <div className="text-xs font-black text-dfc-muted">可接游戏，多选</div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {gameOptions.map(([code, name]) => {
          const checked = selectedGames.includes(code);
          const isPrimary = code === primaryGame;
          return (
            <label key={code} className={`rounded-dfc-control border px-3 py-2 text-xs transition ${checked ? "border-cyan-300/60 bg-cyan-300/10 text-white" : "border-cyan-300/15 bg-[#07111f] text-dfc-subtext"}`}>
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => {
                  if (event.target.checked) {
                    onChange(normalizeSelectedGames([...selectedGames, code], primaryGame));
                    return;
                  }
                  const next = selectedGames.filter((item) => item !== code);
                  if (!next.length) return;
                  if (isPrimary) {
                    const nextPrimary = next[0];
                    onPrimaryGameChange(nextPrimary);
                    onChange(normalizeSelectedGames(next, nextPrimary));
                    return;
                  }
                  onChange(normalizeSelectedGames(next, primaryGame));
                }}
                className="mr-2 accent-cyan-300"
              />
              {name}
              {isPrimary ? <span className="ml-2 text-dfc-gold">主显示</span> : null}
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

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase();
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

function isMergedPlatformPlaceholderUser(user: AdminUser) {
  return user.status === "BANNED" && user.email.endsWith("@platform.maycatplay.local") && user.displayName.startsWith("Merged platform placeholder ");
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
  if (message.includes("Companion nickname is already taken")) return "该陪玩昵称已被使用，请换一个陪玩昵称";
  if (message.includes("Existing account display name conflicts")) return "该账号显示名和同角色账号冲突，请先修改账号昵称，或确认是否选错账号";
  if (message.includes("Display name is already taken")) return "该账号显示名和同角色账号冲突，请先修改账号昵称，或确认是否选错账号";
  if (message.includes("Referral code conflicts")) return "邀请码生成冲突，请重试一次";
  if (message.includes("Companion account data conflicts")) return "陪玩资料数据冲突，请检查是否重复开通，或换一个陪玩昵称";
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

function useDebouncedUserSearch(value: string) {
  const normalized = normalizeSearchValue(value);
  const [query, setQuery] = useState(normalized);
  useEffect(() => {
    if (query === normalized) return;
    const timer = setTimeout(() => setQuery(normalized), 250);
    return () => clearTimeout(timer);
  }, [normalized, query]);
  return query;
}

function useUserOptions(purpose: UserOptionPurpose, search: string, selectedId: string, revision: number) {
  const query = useDebouncedUserSearch(search);
  const [state, setState] = useState<UserLoadState<UserOptions>>(emptyUserLoadState);
  const selectedUser = useRef<AdminUser | null>(null);
  const path = userOptionsPath(purpose, query, selectedId);
  useEffect(() => {
    const loader = createLatestUserLoader<UserOptions>({ fetcher: fetch, getToken: () => localStorage.getItem("dfc_admin_token"), onChange: setState });
    void loader.load(path, value => decodeUserOptions(value, purpose, selectedId));
    return () => loader.dispose();
  }, [path, purpose, selectedId, revision]);
  const current = state.path === path && normalizeSearchValue(search) === query;
  const data = current ? state.data : null;
  const found = state.data?.items.find(user => user.id === selectedId);
  if (found) selectedUser.current = found;
  else if (selectedUser.current?.id !== selectedId) selectedUser.current = null;
  const loading = !current || state.loading;
  return { items: data?.items ?? [], loading, error: current ? state.error : "", hasMore: Boolean(data?.hasMore),
    selectedUser: selectedUser.current, selectedAvailable: Boolean(selectedId && data?.selectedId === selectedId && !loading && !state.error) };
}

function UserOptionsHint({ lookup, selectedId }: { lookup: ReturnType<typeof useUserOptions>; selectedId: string }) {
  if (lookup.loading) return <p className="mt-2 text-xs text-dfc-muted">正在查找账号…</p>;
  if (lookup.error) return <p role="alert" className="mt-2 text-xs text-dfc-danger">{lookup.error} 请更换关键词或刷新列表。</p>;
  if (selectedId && !lookup.selectedAvailable) return <p className="mt-2 text-xs text-dfc-danger">原选择已不在可用候选中，请重新选择账号。</p>;
  if (lookup.hasMore) return <p className="mt-2 text-xs text-dfc-muted">还有更多账号，请输入昵称、邮箱或 ID 缩小范围。</p>;
  if (!lookup.items.length) return <p className="mt-2 text-xs text-dfc-muted">没有匹配到可用账号，请换关键词再搜。</p>;
  return null;
}

function RetainedUserOption({ selectedId, lookup }: { selectedId: string; lookup: ReturnType<typeof useUserOptions> }) {
  return selectedId && !lookup.items.some(user => user.id === selectedId)
    ? <option value={selectedId} disabled>原选择：{lookup.selectedUser ? userOptionLabel(lookup.selectedUser) : selectedId}</option> : null;
}
