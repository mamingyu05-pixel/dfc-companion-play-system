"use client";

import { useEffect, useMemo, useState } from "react";
import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

type Companion = {
  userId: string;
  email: string;
  nickname: string;
  avatarUrl?: string | null;
  game: string;
  games?: string[];
  status: string;
  onlineStatus: string;
  deltaForceRank: string;
  pricePerHour: string;
  kookPricePerHour?: string | null;
  discordPricePerHour?: string | null;
  entertainmentPricePerHour?: string | null;
  rankedPricePerHour?: string | null;
  highRankedPricePerHour?: string | null;
  commissionRate: string;
  availableIncome: string;
  pendingIncome: string;
  externalAccounts: Array<{
    platform: string;
    externalUserId: string;
    displayName?: string | null;
  }>;
};

const gameCodes = [
  "DELTA_FORCE",
  "LEAGUE_OF_LEGENDS",
  "VALORANT",
  "COUNTER_STRIKE_2",
  "PUBG",
  "APEX_LEGENDS",
  "NARAKA_BLADEPOINT",
  "CALL_OF_DUTY"
] as const;

export default function CompanionsPage() {
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  async function loadCompanions() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    const response = await fetch("/api/admin/companions", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("无法加载陪玩列表");
    setCompanions((await response.json()) as Companion[]);
  }

  useEffect(() => {
    void loadCompanions().catch(() => setError("无法加载真实陪玩数据"));
  }, []);

  async function updateStatus(userId: string, nextStatus: "LISTED" | "UNLISTED" | "BANNED") {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    setError("");
    setStatus("");
    const response = await fetch(`/api/admin/companions/${userId}/status`, {
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
      setError(message ?? "更新陪玩状态失败");
      return;
    }
    setStatus(`陪玩状态已更新为 ${toCompanionStatus(nextStatus)}`);
    await loadCompanions();
  }

  async function updateCommission(userId: string, commissionRate: string) {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    setError("");
    setStatus("");
    const response = await fetch(`/api/admin/companions/${userId}/commission`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ commissionRate })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(toFriendlyError(message));
      return;
    }
    setStatus(`陪玩抽成已更新为 ${formatPercent(commissionRate)}`);
    await loadCompanions();
  }

  async function updatePricing(
    userId: string,
    pricePerHour: string,
    kookPricePerHour: string,
    discordPricePerHour: string,
    entertainmentPricePerHour: string,
    rankedPricePerHour: string,
    highRankedPricePerHour: string
  ) {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    setError("");
    setStatus("");
    const response = await fetch(`/api/admin/companions/${userId}/pricing`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        pricePerHour,
        kookPricePerHour: kookPricePerHour || null,
        discordPricePerHour: discordPricePerHour || null,
        entertainmentPricePerHour: entertainmentPricePerHour || null,
        rankedPricePerHour: rankedPricePerHour || null,
        highRankedPricePerHour: highRankedPricePerHour || null
      })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(toFriendlyError(message));
      return;
    }
    setStatus("陪玩平台价格已更新");
    await loadCompanions();
  }

  async function updateGames(userId: string, game: string, games: string[]) {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    setError("");
    setStatus("");
    const response = await fetch(`/api/admin/companions/${userId}/games`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ game, games, note: "后台陪玩管理页更新可接游戏" })
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(toFriendlyError(message));
      return;
    }
    setStatus("陪玩可接游戏已更新");
    await loadCompanions();
  }

  const stats = useMemo(() => {
    const listed = companions.filter((item) => item.status === "LISTED").length;
    const pendingReview = companions.filter((item) => item.status === "PENDING_REVIEW").length;
    const online = companions.filter((item) => item.onlineStatus === "ONLINE").length;
    const pendingIncome = companions.reduce((sum, item) => sum + Number(item.pendingIncome || 0), 0);
    return { listed, pendingReview, online, pendingIncome };
  }, [companions]);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredCompanions = normalizedSearch
    ? companions.filter((item) => getSearchableCompanionText(item).includes(normalizedSearch))
    : companions;

  return (
    <AdminShell>
      <SectionHeader eyebrow="Companion Roster" title="陪玩管理" desc="管理真实陪玩资料、上架状态、价格、平台抽成比例和 KOOK / Discord 绑定。上架后客户才可下单。" />

      <section className="mb-5 grid gap-4 md:grid-cols-4">
        <Signal label="待审核申请" value={String(stats.pendingReview)} hint="Discord 提交后进入这里" tone="gold" />
        <Signal label="已上架" value={String(stats.listed)} hint="可被客户选择" tone="green" />
        <Signal label="当前在线" value={String(stats.online)} hint="派单优先队列" tone="cyan" />
        <Signal label="待结算收益" value={`¥${formatMoney(String(stats.pendingIncome))}`} hint="完成后进入钱包流水" tone="gold" />
      </section>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <section className="mb-4 rounded-dfc border border-cyan-300/15 bg-[#0a1020]/75 px-4 py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-base font-black text-white">陪玩列表</h2>
            <p className="mt-1 text-xs text-dfc-muted">
              当前显示 {filteredCompanions.length} / {companions.length} 个陪玩。支持搜索昵称、账号、平台 ID、游戏、状态和段位。
            </p>
            {stats.pendingReview > 0 ? (
              <p className="mt-2 text-xs font-semibold text-dfc-gold">
                有 {stats.pendingReview} 个入驻申请待审核。确认资料和试音通过后点击“上架”，未通过可下架或封禁。
              </p>
            ) : null}
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="input xl:max-w-md"
            placeholder="搜索陪玩昵称、账号、Discord / KOOK、游戏或状态"
          />
        </div>
      </section>

      <DataTable
        columns={["ID", "资料", "游戏", "账号", "段位", "价格/抽成", "资料状态", "在线", "收益", "操作"]}
        maxHeightClassName="max-h-[680px]"
        stickyHeader
        rows={filteredCompanions.map((item) => [
          shortId(item.userId),
          <div key={`${item.userId}-profile`} className="flex items-center gap-3">
            <SafeAvatar nickname={item.nickname} avatarUrl={item.avatarUrl} />
            <div>
              <div className="font-semibold text-white">{item.nickname}</div>
              <div className="mt-1 max-w-56 truncate text-xs text-dfc-muted">{platformSummary(item.externalAccounts)}</div>
            </div>
          </div>,
          <CompanionGamesEditor
            key={`${item.userId}-games`}
            game={item.game}
            games={item.games?.length ? item.games : [item.game]}
            onSave={(nextGame, nextGames) => void updateGames(item.userId, nextGame, nextGames)}
          />,
          formatAccountEmail(item.email),
          item.deltaForceRank,
          <CompanionCommercialEditor
            key={`${item.userId}-pricing`}
            pricePerHour={item.pricePerHour}
            kookPricePerHour={item.kookPricePerHour}
            discordPricePerHour={item.discordPricePerHour}
            entertainmentPricePerHour={item.entertainmentPricePerHour}
            rankedPricePerHour={item.rankedPricePerHour}
            highRankedPricePerHour={item.highRankedPricePerHour}
            commissionRate={item.commissionRate}
            onSavePricing={(base, kook, discord, entertainment, ranked, highRanked) =>
              void updatePricing(item.userId, base, kook, discord, entertainment, ranked, highRanked)
            }
            onSaveCommission={(value) => void updateCommission(item.userId, value)}
          />,
          <StatusBadge key={`${item.userId}-s`} tone={item.status === "LISTED" ? "success" : item.status === "BANNED" ? "danger" : "warning"}>{toCompanionStatus(item.status)}</StatusBadge>,
          <StatusBadge key={`${item.userId}-online`} tone={item.onlineStatus === "ONLINE" ? "success" : "default"}>{toOnlineStatus(item.onlineStatus)}</StatusBadge>,
          <div key={`${item.userId}-income`} className="text-xs leading-5">
            <div className="font-black text-dfc-gold">可提 ¥{formatMoney(item.availableIncome)}</div>
            <div className="text-dfc-muted">待结 ¥{formatMoney(item.pendingIncome)}</div>
          </div>,
          <div key={`${item.userId}-a`} className="flex flex-wrap gap-2">
            <ActionButton onClick={() => void updateStatus(item.userId, "LISTED")}>上架</ActionButton>
            <ActionButton tone="secondary" onClick={() => void updateStatus(item.userId, "UNLISTED")}>下架</ActionButton>
            <ActionButton tone="danger" onClick={() => void updateStatus(item.userId, "BANNED")}>封禁</ActionButton>
          </div>
        ])}
      />
    </AdminShell>
  );
}

function CompanionGamesEditor({ game, games, onSave }: { game: string; games: string[]; onSave: (game: string, games: string[]) => Promise<void> | void }) {
  const initialGames = normalizeSelectedGames(games, normalizeKnownGame(game) ?? normalizeKnownGame(games[0]) ?? "DELTA_FORCE");
  const [primaryGame, setPrimaryGame] = useState(initialGames[0] ?? "DELTA_FORCE");
  const [selectedGames, setSelectedGames] = useState<string[]>(initialGames);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const nextGames = normalizeSelectedGames(games, normalizeKnownGame(game) ?? normalizeKnownGame(games[0]) ?? "DELTA_FORCE");
    setPrimaryGame(nextGames[0] ?? "DELTA_FORCE");
    setSelectedGames(nextGames);
  }, [game, games]);

  function selectPrimary(nextGame: string) {
    const normalized = normalizeKnownGame(nextGame);
    if (!normalized) return;
    setPrimaryGame(normalized);
    setSelectedGames((current) => normalizeSelectedGames(current, normalized));
  }

  function toggleGame(code: string) {
    if (selectedGames.includes(code)) {
      const remaining = selectedGames.filter((item) => item !== code);
      if (!remaining.length) return;
      const nextPrimary = code === primaryGame ? (remaining[0] ?? "DELTA_FORCE") : primaryGame;
      setPrimaryGame(nextPrimary);
      setSelectedGames(normalizeSelectedGames(remaining, nextPrimary));
      return;
    }
    setSelectedGames((current) => normalizeSelectedGames([...current, code], primaryGame));
  }

  async function save() {
    setIsSaving(true);
    try {
      const normalized = normalizeSelectedGames(selectedGames, primaryGame);
      const nextPrimary = normalized[0] ?? "DELTA_FORCE";
      await onSave(nextPrimary, normalized);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="min-w-64 text-xs">
      <div className="font-semibold leading-5 text-white">{gameNames(selectedGames)}</div>
      <details className="mt-2">
        <summary className="cursor-pointer text-cyan-200 hover:text-cyan-100">编辑可接游戏</summary>
        <div className="mt-2 rounded-dfc-control border border-cyan-300/15 bg-[#050711]/70 p-2">
          <label className="block">
            <span className="mb-1 block text-dfc-muted">主显示游戏</span>
            <select value={primaryGame} onChange={(event) => selectPrimary(event.target.value)} className="w-full rounded-dfc-control border border-cyan-300/20 bg-[#070d19] px-2 py-2 text-white outline-none focus:shadow-dfc-focus">
              {gameCodes.map((code) => <option key={code} value={code}>{gameName(code)}</option>)}
            </select>
          </label>
          <div className="mt-2 grid max-h-56 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
            {gameCodes.map((code) => {
              const checked = selectedGames.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => toggleGame(code)}
                  className={`rounded-dfc-control border px-2 py-1 text-left transition ${checked ? "border-cyan-300/60 bg-cyan-300/10 text-white" : "border-cyan-300/15 bg-[#07111f] text-dfc-subtext"}`}
                >
                  {checked ? "✓ " : ""}
                  {gameName(code)}
                  {code === primaryGame ? <span className="ml-1 text-dfc-gold">主</span> : null}
                </button>
              );
            })}
          </div>
          <button type="button" disabled={isSaving} onClick={() => void save()} className="mt-2 rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-2 py-1 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-60">
            {isSaving ? "保存中" : "保存游戏"}
          </button>
        </div>
      </details>
    </div>
  );
}

function mediaUrl(src?: string | null): string | undefined {
  if (!src) return undefined;
  return src.startsWith("/uploads/") ? `/api${src}` : src;
}

function SafeAvatar({ nickname, avatarUrl }: { nickname: string; avatarUrl?: string | null }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [avatarUrl]);

  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-dfc border border-cyan-300/20 bg-[#101827] text-sm font-black text-cyan-200">
      {avatarUrl && !failed ? (
        <img src={mediaUrl(avatarUrl)} alt={`${nickname} 头像`} className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        nickname.slice(0, 1)
      )}
    </div>
  );
}

function CompanionCommercialEditor({
  pricePerHour,
  kookPricePerHour,
  discordPricePerHour,
  entertainmentPricePerHour,
  rankedPricePerHour,
  highRankedPricePerHour,
  commissionRate,
  onSavePricing,
  onSaveCommission
}: {
  pricePerHour: string;
  kookPricePerHour?: string | null;
  discordPricePerHour?: string | null;
  entertainmentPricePerHour?: string | null;
  rankedPricePerHour?: string | null;
  highRankedPricePerHour?: string | null;
  commissionRate: string;
  onSavePricing: (
    pricePerHour: string,
    kookPricePerHour: string,
    discordPricePerHour: string,
    entertainmentPricePerHour: string,
    rankedPricePerHour: string,
    highRankedPricePerHour: string
  ) => void;
  onSaveCommission: (value: string) => void;
}) {
  return (
    <div className="min-w-56 text-xs">
      <div className="font-black text-dfc-gold">¥{formatMoney(pricePerHour)}/h</div>
      <div className="mt-1 text-dfc-muted">
        KOOK {kookPricePerHour ? `¥${formatMoney(kookPricePerHour)}` : "沿用默认"} / DC {discordPricePerHour ? `¥${formatMoney(discordPricePerHour)}` : "沿用默认"}
      </div>
      <div className="mt-1 text-dfc-muted">
        娱乐 {formatOptionalPrice(entertainmentPricePerHour)} / 排位 {formatOptionalPrice(rankedPricePerHour)} / 高排 {formatOptionalPrice(highRankedPricePerHour)}
      </div>
      <div className="mt-1 text-dfc-muted">平台抽成 {formatPercent(commissionRate)}</div>
      <details className="mt-2">
        <summary className="cursor-pointer text-cyan-200 hover:text-cyan-100">编辑价格/抽成</summary>
        <div className="mt-2 space-y-3 rounded-dfc-control border border-cyan-300/15 bg-[#050711]/70 p-2">
          <CompanionPricingEditor
            pricePerHour={pricePerHour}
            kookPricePerHour={kookPricePerHour}
            discordPricePerHour={discordPricePerHour}
            entertainmentPricePerHour={entertainmentPricePerHour}
            rankedPricePerHour={rankedPricePerHour}
            highRankedPricePerHour={highRankedPricePerHour}
            onSave={onSavePricing}
          />
          <CompanionCommissionEditor pricePerHour={pricePerHour} commissionRate={commissionRate} onSave={onSaveCommission} />
        </div>
      </details>
    </div>
  );
}

function CompanionPricingEditor({
  pricePerHour,
  kookPricePerHour,
  discordPricePerHour,
  entertainmentPricePerHour,
  rankedPricePerHour,
  highRankedPricePerHour,
  onSave
}: {
  pricePerHour: string;
  kookPricePerHour?: string | null;
  discordPricePerHour?: string | null;
  entertainmentPricePerHour?: string | null;
  rankedPricePerHour?: string | null;
  highRankedPricePerHour?: string | null;
  onSave: (
    pricePerHour: string,
    kookPricePerHour: string,
    discordPricePerHour: string,
    entertainmentPricePerHour: string,
    rankedPricePerHour: string,
    highRankedPricePerHour: string
  ) => void;
}) {
  const [base, setBase] = useState(pricePerHour);
  const [kook, setKook] = useState(kookPricePerHour ?? "");
  const [discord, setDiscord] = useState(discordPricePerHour ?? "");
  const [entertainment, setEntertainment] = useState(entertainmentPricePerHour ?? "");
  const [ranked, setRanked] = useState(rankedPricePerHour ?? "");
  const [highRanked, setHighRanked] = useState(highRankedPricePerHour ?? "");

  useEffect(() => {
    setBase(pricePerHour);
    setKook(kookPricePerHour ?? "");
    setDiscord(discordPricePerHour ?? "");
    setEntertainment(entertainmentPricePerHour ?? "");
    setRanked(rankedPricePerHour ?? "");
    setHighRanked(highRankedPricePerHour ?? "");
  }, [pricePerHour, kookPricePerHour, discordPricePerHour, entertainmentPricePerHour, rankedPricePerHour, highRankedPricePerHour]);

  return (
    <div className="min-w-52 text-xs">
      <div className="grid gap-2">
        <PriceInput label="默认" value={base} onChange={setBase} />
        <PriceInput label="KOOK" value={kook} onChange={setKook} placeholder="沿用默认" />
        <PriceInput label="DC" value={discord} onChange={setDiscord} placeholder="沿用默认" />
        <PriceInput label="娱乐" value={entertainment} onChange={setEntertainment} placeholder="可不填" />
        <PriceInput label="排位" value={ranked} onChange={setRanked} placeholder="例如 128" />
        <PriceInput label="高排" value={highRanked} onChange={setHighRanked} placeholder="例如 128" />
      </div>
      <button type="button" onClick={() => onSave(base, kook, discord, entertainment, ranked, highRanked)} className="mt-2 rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-2 py-1 font-black text-slate-950">
        保存价格
      </button>
    </div>
  );
}

function PriceInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-10 text-dfc-muted">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-28 rounded-dfc-control border border-cyan-300/20 bg-[#070d19] px-2 py-1 outline-none focus:shadow-dfc-focus" inputMode="decimal" />
    </label>
  );
}

function CompanionCommissionEditor({ pricePerHour, commissionRate, onSave }: { pricePerHour: string; commissionRate: string; onSave: (value: string) => void }) {
  const [value, setValue] = useState(commissionRate);
  return (
    <div className="min-w-44 text-xs">
      <div className="font-black text-dfc-gold">¥{formatMoney(pricePerHour)}/h</div>
      <div className="mt-2 flex items-center gap-2">
        <input value={value} onChange={(event) => setValue(event.target.value)} className="w-20 rounded-dfc-control border border-cyan-300/20 bg-[#070d19] px-2 py-1 outline-none focus:shadow-dfc-focus" inputMode="decimal" />
        <button type="button" onClick={() => onSave(value)} className="rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-2 py-1 font-black text-slate-950">
          保存
        </button>
      </div>
      <div className="mt-1 text-dfc-muted">平台抽成 {formatPercent(commissionRate)}</div>
    </div>
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

function formatOptionalPrice(value?: string | null) {
  return value ? `¥${formatMoney(value)}` : "默认";
}

function formatPercent(value: string) {
  return `${Math.round(Number(value || 0) * 10000) / 100}%`;
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}...` : id;
}

function formatAccountEmail(email: string) {
  return email.endsWith("@oauth.maycatplay.local") ? "第三方注册" : email;
}

function platformSummary(accounts: Companion["externalAccounts"]) {
  if (!accounts.length) return "未绑定 KOOK / Discord";
  return accounts.map((account) => `${account.platform}:${account.displayName || account.externalUserId}`).join(" / ");
}

function getSearchableCompanionText(item: Companion) {
  return [
    item.userId,
    item.email,
    item.nickname,
    item.status,
    item.onlineStatus,
    item.deltaForceRank,
    item.pricePerHour,
    item.kookPricePerHour ?? "",
    item.discordPricePerHour ?? "",
    item.entertainmentPricePerHour ?? "",
    item.rankedPricePerHour ?? "",
    item.highRankedPricePerHour ?? "",
    item.commissionRate,
    ...(item.games?.length ? item.games : [item.game]).flatMap((game) => [game, gameName(game)]),
    ...((item.externalAccounts ?? []).flatMap((account) => [
      account.platform,
      account.externalUserId,
      account.displayName ?? ""
    ]))
  ].join(" ").toLowerCase();
}

function toFriendlyError(message?: string) {
  if (!message) return "操作失败";
  if (message.includes("commissionRate cannot be greater than 1")) return "抽成比例不能大于 1，0.2 表示 20%";
  if (message.includes("commissionRate cannot be negative")) return "抽成比例不能小于 0";
  if (message.includes("commissionRate must be a valid amount")) return "请输入正确抽成比例，例如 0.2";
  return message;
}

function toCompanionStatus(status: string) {
  if (status === "PENDING_REVIEW") return "待审核申请";
  if (status === "LISTED") return "已上架";
  if (status === "UNLISTED") return "已下架";
  if (status === "BANNED") return "已封禁";
  return status;
}

function toOnlineStatus(status: string) {
  if (status === "ONLINE") return "在线";
  if (status === "BUSY") return "忙碌";
  if (status === "OFFLINE") return "离线";
  return status;
}

function gameName(code: string) {
  const names: Record<string, string> = {
    DELTA_FORCE: "三角洲行动",
    LEAGUE_OF_LEGENDS: "英雄联盟",
    VALORANT: "无畏契约",
    COUNTER_STRIKE_2: "CS2",
    PUBG: "PUBG 绝地求生",
    APEX_LEGENDS: "Apex 英雄",
    NARAKA_BLADEPOINT: "永劫无间",
    CALL_OF_DUTY: "塔科夫 / COD"
  };
  return names[code] ?? code;
}

function gameNames(codes: string[]) {
  return codes.map(gameName).join(" / ");
}

function normalizeKnownGame(value?: string | null): string | undefined {
  return typeof value === "string" && gameCodes.includes(value as (typeof gameCodes)[number]) ? value : undefined;
}

function normalizeSelectedGames(values: string[], primaryGame: string) {
  const primary = normalizeKnownGame(primaryGame) ?? "DELTA_FORCE";
  return Array.from(new Set([primary, ...values].filter((value) => normalizeKnownGame(value)))).slice(0, 24);
}
