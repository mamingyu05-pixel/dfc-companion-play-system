"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CompanionCard, CustomerShell, SectionHeader } from "../components";
import { games } from "../data";

const filters = [
  { id: "all", label: "全部" },
  { id: "online", label: "在线优先" },
  { id: "voice", label: "可语音" },
  { id: "recommended", label: "推荐" },
  { id: "newbie", label: "新手友好" },
  { id: "high-rank", label: "高分段" }
] as const;

type FilterId = (typeof filters)[number]["id"];
type SortId = "recommended" | "rating" | "orders" | "price";
type CompanionPage = { companions: ApiCompanion[]; total: number; page: number; limit: number };
type RankedCompanion = Pick<ApiCompanion, "id" | "nickname" | "verified" | "averageRating" | "completedOrders">;

type ExternalAccount = {
  platform: "DISCORD" | "KOOK";
  externalUserId: string;
  displayName?: string | null;
};

type ApiCompanion = {
  averageRating?: number | null;
  reviewCount?: number;
  id: string;
  nickname: string;
  avatarUrl?: string | null;
  photoUrls?: string[];
  voiceIntroUrl?: string | null;
  game: string;
  games?: string[];
  onlineStatus: string;
  deltaForceRank: string;
  skillModes: string[];
  pricePerHour: string;
  voicePreference: string;
  bio?: string | null;
  externalAccounts?: ExternalAccount[];
  verified?: boolean;
  badges?: string[];
  completedOrders?: number;
};

type PublicConfig = {
  support?: {
    discordUrl?: string | null;
    kookUrl?: string | null;
    voiceTrialDiscordUrl?: string | null;
    voiceTrialKookUrl?: string | null;
  };
};

export default function CompanionsPage() {
  const [companions, setCompanions] = useState<ApiCompanion[]>([]);
  const [leaderboard, setLeaderboard] = useState<RankedCompanion[]>([]);
  const [publicConfig, setPublicConfig] = useState<PublicConfig>({});
  const [activeFilter, setActiveFilter] = useState<FilterId>("all");
  const [sort, setSort] = useState<SortId>("recommended");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const inFlight = useRef(false);

  async function loadCompanions(nextPage = 1, currentRevision = revision.current) {
    if (inFlight.current) return;
    inFlight.current = true;
    if (nextPage === 1) setIsLoading(true);
    else setIsLoadingMore(true);
    setError("");
    try {
      const query = new URLSearchParams({ page: String(nextPage), limit: "24", sort, filter: activeFilter });
      const response = await fetch(`/api/orders/public/companions?${query}`);
      if (!response.ok) throw new Error("无法加载陪玩列表");
      const data = await response.json() as CompanionPage;
      if (!Array.isArray(data.companions) || !Number.isInteger(data.total) || data.total < 0 || data.page !== nextPage) {
        throw new Error("陪玩列表返回异常");
      }
      if (currentRevision !== revision.current) return;
      setCompanions(current => nextPage === 1 ? data.companions
        : [...new Map([...current, ...data.companions].map(companion => [companion.id, companion])).values()]);
      setTotal(data.total);
      setPage(data.page);
    } catch {
      if (currentRevision !== revision.current) return;
      setError(nextPage === 1 ? "暂时无法加载真实陪玩列表，请稍后重试。" : "加载更多失败，已显示的陪玩仍可查看，请重试。");
    } finally {
      if (currentRevision === revision.current) {
        inFlight.current = false;
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }

  useEffect(() => {
    const currentRevision = ++revision.current;
    inFlight.current = false;
    setCompanions([]);
    setTotal(0);
    setPage(0);
    setIsLoadingMore(false);
    void loadCompanions(1, currentRevision);
    return () => { revision.current++; };
  }, [activeFilter, sort]);

  useEffect(() => {
    let disposed = false;
    void fetch("/api/orders/public/companions/leaderboard")
      .then(async response => response.ok ? await response.json() as RankedCompanion[] : [])
      .then(rows => { if (!disposed) setLeaderboard(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!disposed) setLeaderboard([]); });
    void fetch("/api/auth/public-config")
      .then(async (response) => {
        if (!response.ok) return {};
        return (await response.json()) as PublicConfig;
      })
      .then(config => { if (!disposed) setPublicConfig(config); })
      .catch(() => { if (!disposed) setPublicConfig({}); });
    return () => { disposed = true; };
  }, []);

  const onlineCount = companions.filter((companion) => companion.onlineStatus === "ONLINE").length;

  return (
    <CustomerShell>
      <section className="maycat-lobby-hero overflow-hidden rounded-dfc border border-cyan-300/20 p-4 md:p-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <div className="maycat-chip px-3 py-1 text-xs font-black">挑选陪玩</div>
            <h1 className="maycat-text-glow mt-4 max-w-3xl text-3xl font-black leading-tight text-white md:text-5xl">
              选择今晚的队友。
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-dfc-subtext md:text-base">
              先看在线状态、语音偏好和价格，再进入详情或试音。正式发单请到 KOOK / Discord 群里，小小电竞会把派单、接单和结算记录完整留在后台。
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Link href="/order" className="maycat-button px-5 py-3 text-center text-sm font-black">
                查看群下单方式
              </Link>
              <Link href="/support" className="maycat-button-secondary px-5 py-3 text-center text-sm font-black">
                找客服推荐
              </Link>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
            <LobbyMetric label="匹配陪玩" value={String(total)} hint="当前筛选的服务端总数" />
            <LobbyMetric label="已展示在线" value={String(onlineCount)} hint="已加载的陪玩中在线人数" />
            <LobbyMetric label="当前已展示" value={String(companions.length)} hint="点击加载更多继续查看" />
          </div>
        </div>
      </section>

      <section className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {games.slice(0, 8).map((game) => (
          <Link
              key={game.code}
              href="/order"
              className={`maycat-game-tile ${game.code === "DELTA_FORCE" ? "maycat-game-tile-hot" : ""}`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">{game.name}</span>
                {game.hot ? <span className="rounded-dfc-control bg-dfc-gold/10 px-2 py-1 text-xs text-dfc-gold">热门</span> : null}
              </div>
              <div className="mt-1 text-xs text-dfc-muted">{game.category}</div>
          </Link>
        ))}
      </section>

      <Leaderboard companions={leaderboard} />

      <section className="mt-7 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <SectionHeader title="陪玩大厅" desc={`共 ${total} 位匹配陪玩，已展示 ${companions.length} 位。`} />
        <label className="text-sm text-dfc-subtext">排序
          <select aria-label="陪玩排序" value={sort} onChange={event => setSort(event.target.value as SortId)} className="maycat-input ml-2 px-3 py-2">
            <option value="recommended">综合推荐</option>
            <option value="rating">评分优先</option>
            <option value="orders">完成单数</option>
            <option value="price">价格从低到高</option>
          </select>
        </label>
      </section>

      <section className="mt-5 flex gap-2 overflow-x-auto pb-2" aria-label="陪玩筛选">
        {filters.map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => setActiveFilter(filter.id)}
            className={`shrink-0 rounded-dfc-control border px-3 py-2 text-sm font-semibold transition ${
              activeFilter === filter.id
                ? "border-cyan-300 bg-cyan-300/15 text-white shadow-[0_0_24px_rgba(34,211,238,0.12)]"
                : "border-cyan-300/20 bg-[#07111f]/70 text-dfc-subtext hover:border-cyan-300/50 hover:text-cyan-100"
            }`}
            aria-pressed={activeFilter === filter.id}
          >
            {filter.label}
          </button>
        ))}
      </section>

      <section className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {isLoading ? <CompanionSkeleton /> : null}
        {error ? (
          <div className="maycat-card border-dfc-danger/40 bg-dfc-danger/10 p-4 text-sm text-dfc-danger md:col-span-2 xl:col-span-3">
            <div>{error}</div>
            <button type="button" onClick={() => void loadCompanions(page + 1)} disabled={isLoading || isLoadingMore} className="maycat-button-secondary mt-3 px-3 py-2 text-xs font-black text-dfc-text">
              重新加载
            </button>
          </div>
        ) : null}
        {!isLoading && !error && !companions.length ? (
          <div className="maycat-card p-5 text-sm text-dfc-subtext md:col-span-2 xl:col-span-3">
            <div className="text-base font-black text-white">当前筛选下暂无陪玩</div>
            <p className="mt-2 leading-6">可以切回“全部”，或联系人工客服帮你匹配合适的陪玩。</p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={() => setActiveFilter("all")} className="maycat-button px-4 py-2 text-sm font-black">
                查看全部
              </button>
              <Link href="/support" className="maycat-button-secondary px-4 py-2 text-center text-sm font-black">
                联系客服
              </Link>
            </div>
          </div>
        ) : null}
        {!isLoading && companions.map((companion) => (
          <CompanionCard key={companion.id} companion={toCardCompanion(companion, publicConfig)} />
        ))}
      </section>
      {!isLoading && companions.length < total ? (
        <div className="mt-6 text-center">
          <button type="button" onClick={() => void loadCompanions(page + 1)} disabled={isLoadingMore} className="maycat-button px-5 py-3 text-sm font-black">
            {isLoadingMore ? "正在加载…" : "加载更多"}
          </button>
          <p className="mt-2 text-xs text-dfc-muted" aria-live="polite">已展示 {companions.length} / {total} 位</p>
        </div>
      ) : null}
    </CustomerShell>
  );
}

function toCardCompanion(companion: ApiCompanion, publicConfig: PublicConfig) {
  const trialPlatform = companionTrialPlatform(companion);

  return {
    id: companion.id,
    nickname: companion.nickname,
    avatarUrl: companion.avatarUrl,
    photoUrls: companion.photoUrls ?? [],
    voiceIntroUrl: companion.voiceIntroUrl ?? null,
    game: gameNames(getCompanionGames(companion)),
    rank: companion.deltaForceRank,
    modes: companion.skillModes.length ? companion.skillModes : ["平台派单"],
    price: Number(companion.pricePerHour),
    onlineStatus: companion.onlineStatus,
    voice: toVoice(companion.voicePreference),
    voiceStyle: companion.voicePreference === "TEXT_ONLY" ? "文字沟通" : "支持语音沟通",
    trial: companion.voicePreference === "TEXT_ONLY" ? "暂不支持试音" : "支持进语音频道试音",
    tags: companion.onlineStatus === "ONLINE" ? ["在线", "可接待"] : ["已上架"],
    intro: companion.bio || "该陪玩资料已通过后台上架，具体服务内容以群内沟通和后台记录为准。",
    rating: companion.averageRating?.toFixed(1) ?? "暂无评价",
    orders: companion.reviewCount ?? 0,
    accent: companion.onlineStatus === "ONLINE" ? "gold" : "blue",
    trialHref: companionTrialHref(companion, publicConfig),
    trialPlatform,
    verified: companion.verified === true,
    badges: companion.badges ?? []
  };
}

function companionTrialPlatform(companion: ApiCompanion): "DISCORD" | "KOOK" | null {
  const platforms = companion.externalAccounts?.map((account) => account.platform) ?? [];
  if (platforms.includes("DISCORD")) return "DISCORD";
  if (platforms.includes("KOOK")) return "KOOK";
  return null;
}

function companionTrialHref(companion: ApiCompanion, publicConfig: PublicConfig) {
  const platform = companionTrialPlatform(companion);
  if (platform === "DISCORD") return publicConfig.support?.voiceTrialDiscordUrl || publicConfig.support?.discordUrl || "/support";
  if (platform === "KOOK") return publicConfig.support?.voiceTrialKookUrl || publicConfig.support?.kookUrl || "/support";
  return "/support";
}

function gameName(code: string) {
  return games.find((game) => game.code === code)?.name ?? code;
}

function gameNames(codes: string[]) {
  return codes.map(gameName).join(" / ");
}

function getCompanionGames(companion: ApiCompanion) {
  return companion.games?.length ? companion.games : [companion.game];
}

function toVoice(value: string) {
  if (value === "REQUIRED") return "必须语音";
  if (value === "TEXT_ONLY") return "仅文字";
  return "可语音";
}

function LobbyMetric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-dfc border border-cyan-300/20 bg-[#07111f]/70 p-4 backdrop-blur">
      <div className="text-xs text-dfc-muted">{label}</div>
      <div className="mt-2 text-3xl font-black tabular-nums text-white">{value}</div>
      <div className="mt-1 text-xs text-cyan-100/70">{hint}</div>
    </div>
  );
}

function CompanionSkeleton() {
  return (
    <>
      {[0, 1, 2].map((item) => (
        <div key={item} className="maycat-card p-4 md:min-h-80" aria-hidden="true">
          <div className="flex items-start gap-3">
            <div className="h-14 w-14 animate-pulse rounded-dfc bg-cyan-300/10" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-28 animate-pulse rounded bg-cyan-300/10" />
              <div className="h-3 w-40 animate-pulse rounded bg-cyan-300/10" />
            </div>
          </div>
          <div className="mt-5 h-20 animate-pulse rounded-dfc-control bg-cyan-300/10" />
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="h-9 animate-pulse rounded-dfc-control bg-cyan-300/10" />
            <div className="h-9 animate-pulse rounded-dfc-control bg-cyan-300/10" />
            <div className="h-9 animate-pulse rounded-dfc-control bg-cyan-300/10" />
          </div>
        </div>
      ))}
    </>
  );
}

function Leaderboard({ companions }: { companions: RankedCompanion[] }) {
  if (!companions.length) return null;
  return (
    <section className="maycat-card mt-7 p-4 md:p-5" aria-label="打手排行榜">
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-lg font-black text-white">打手排行榜</h2>
        <span className="text-xs text-dfc-muted">按完成单数和评分</span>
      </div>
      <ol className="mt-3 grid gap-2 md:grid-cols-5">
        {companions.map((c, i) => (
          <li key={c.id}>
            <Link href={`/companions/${c.id}`} className="flex items-center gap-3 rounded-dfc-control border border-cyan-300/20 p-3 transition hover:border-cyan-300/60">
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-black ${i === 0 ? "bg-dfc-gold text-white" : i < 3 ? "bg-cyan-300/15 text-cyan-300" : "bg-[#07111f] text-dfc-subtext"}`}>{i + 1}</span>
              <span className="min-w-0">
                <span className="block truncate font-black text-white">{c.nickname}{c.verified ? " ✓" : ""}</span>
                <span className="block text-xs text-dfc-muted">{c.completedOrders ?? 0} 单 · {c.averageRating ? `${c.averageRating.toFixed(1)} 分` : "暂无评分"}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
