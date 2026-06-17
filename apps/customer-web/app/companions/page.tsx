"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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

type ApiCompanion = {
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
};

export default function CompanionsPage() {
  const [companions, setCompanions] = useState<ApiCompanion[]>([]);
  const [activeFilter, setActiveFilter] = useState<FilterId>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadCompanions() {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/orders/public/companions");
      if (!response.ok) throw new Error("无法加载陪玩列表");
      setCompanions((await response.json()) as ApiCompanion[]);
    } catch {
      setCompanions([]);
      setError("暂时无法加载真实陪玩列表，请稍后刷新。");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadCompanions();
  }, []);

  const onlineCount = companions.filter((companion) => companion.onlineStatus === "ONLINE").length;
  const voiceCount = companions.filter((companion) => companion.voicePreference !== "TEXT_ONLY").length;
  const deltaForceCount = companions.filter((companion) => getCompanionGames(companion).includes("DELTA_FORCE")).length;
  const filteredCompanions = useMemo(() => {
    return companions.filter((companion) => {
      if (activeFilter === "online") return companion.onlineStatus === "ONLINE";
      if (activeFilter === "voice") return companion.voicePreference !== "TEXT_ONLY";
      if (activeFilter === "recommended") return companion.onlineStatus === "ONLINE" && Number(companion.pricePerHour) > 0;
      if (activeFilter === "newbie") return isNewbieFriendly(companion);
      if (activeFilter === "high-rank") return isHighRank(companion.deltaForceRank);
      return true;
    });
  }, [activeFilter, companions]);

  return (
    <CustomerShell>
      <section className="maycat-lobby-hero overflow-hidden rounded-dfc border border-cyan-300/20 p-4 md:p-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <div className="maycat-chip px-3 py-1 text-xs font-black uppercase tracking-[0.18em]">Maycat Match Terminal</div>
            <h1 className="maycat-text-glow mt-4 max-w-3xl text-3xl font-black leading-tight text-white md:text-5xl">
              选择今晚的队友。
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-dfc-subtext md:text-base">
              先看在线状态、语音偏好和价格，再进入详情或试音。May猫饼会把下单、派单、接单和结算记录完整留在后台。
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Link href="/order" className="maycat-button px-5 py-3 text-center text-sm font-black">
                直接下单
              </Link>
              <Link href="/support" className="maycat-button-secondary px-5 py-3 text-center text-sm font-black">
                找客服推荐
              </Link>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
            <LobbyMetric label="已上架陪玩" value={String(companions.length)} hint="真实后台数据" />
            <LobbyMetric label="当前在线" value={String(onlineCount)} hint="可优先试音/下单" />
            <LobbyMetric label="三角洲行动" value={String(deltaForceCount)} hint="首期重点游戏" />
          </div>
        </div>
      </section>

      <section className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {games.slice(0, 8).map((game) => (
          <Link
              key={game.code}
              href={`/order?game=${game.code}`}
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

      <section className="mt-7 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <SectionHeader title="陪玩大厅" desc={`共 ${companions.length} 位陪玩，${onlineCount} 位在线，${voiceCount} 位支持语音。`} />
        <div className="rounded-dfc-control border border-cyan-300/20 bg-[#050711]/70 px-3 py-2 text-sm text-dfc-subtext">
          当前筛选：{filters.find((filter) => filter.id === activeFilter)?.label}
        </div>
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
            <button type="button" onClick={() => void loadCompanions()} className="maycat-button-secondary mt-3 px-3 py-2 text-xs font-black text-dfc-text">
              重新加载
            </button>
          </div>
        ) : null}
        {!isLoading && !error && !filteredCompanions.length ? (
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
        {!isLoading && !error && filteredCompanions.map((companion) => (
          <CompanionCard key={companion.id} companion={toCardCompanion(companion)} />
        ))}
      </section>
    </CustomerShell>
  );
}

function toCardCompanion(companion: ApiCompanion) {
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
    tags: companion.onlineStatus === "ONLINE" ? ["在线", "可下单"] : ["已上架"],
    intro: companion.bio || "该陪玩资料已通过后台上架，具体服务内容以下单沟通为准。",
    rating: "新陪玩",
    orders: 0,
    accent: companion.onlineStatus === "ONLINE" ? "gold" : "blue"
  };
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

function isNewbieFriendly(companion: ApiCompanion) {
  const content = `${companion.bio ?? ""} ${companion.skillModes.join(" ")} ${companion.deltaForceRank}`;
  return /新手|教学|耐心|入门|陪练/.test(content);
}

function isHighRank(rank: string) {
  return /高|钻石|大师|宗师|王者|传奇|顶尖/.test(rank);
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
