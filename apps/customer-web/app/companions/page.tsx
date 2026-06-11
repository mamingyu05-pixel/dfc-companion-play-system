"use client";

import { useEffect, useState } from "react";
import { CompanionCard, CustomerShell, SectionHeader } from "../components";
import { games } from "../data";

const filters = ["全部", "在线优先", "可语音", "推荐", "新手友好", "高分段"];

type ApiCompanion = {
  id: string;
  nickname: string;
  avatarUrl?: string | null;
  game: string;
  onlineStatus: string;
  deltaForceRank: string;
  skillModes: string[];
  pricePerHour: string;
  voicePreference: string;
  bio?: string | null;
};

export default function CompanionsPage() {
  const [companions, setCompanions] = useState<ApiCompanion[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/orders/public/companions")
      .then(async (response) => {
        if (!response.ok) throw new Error("无法加载陪玩列表");
        return (await response.json()) as ApiCompanion[];
      })
      .then(setCompanions)
      .catch(() => setError("暂时无法加载真实陪玩列表，请稍后刷新。"));
  }, []);

  return (
    <CustomerShell>
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <SectionHeader title="陪玩列表" desc="May猫饼支持多款热门游戏。先选择游戏，再按价格、在线状态和语音偏好挑选陪玩。" />
        <div className="rounded-dfc-control border border-dfc-border bg-dfc-surface px-3 py-2 text-sm text-dfc-subtext">
          共 {companions.length} 位推荐陪玩
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-base font-semibold">热门游戏</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {games.map((game) => (
            <a
              key={game.code}
              href={`/order?game=${game.code}`}
              className="rounded-dfc border border-dfc-border bg-dfc-surface p-3 hover:border-dfc-blue/60"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">{game.name}</span>
                {game.hot ? <span className="rounded-dfc-control bg-dfc-gold/10 px-2 py-1 text-xs text-dfc-gold">热门</span> : null}
              </div>
              <div className="mt-1 text-xs text-dfc-muted">{game.category}</div>
            </a>
          ))}
        </div>
      </section>

      <section className="mt-6 flex gap-2 overflow-x-auto pb-1">
        {filters.map((filter) => (
          <button key={filter} className="shrink-0 rounded-dfc-control border border-dfc-border bg-dfc-surface px-3 py-2 text-sm text-dfc-subtext">
            {filter}
          </button>
        ))}
      </section>

      <section className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {error ? <div className="rounded-dfc border border-dfc-danger/40 bg-dfc-danger/10 p-4 text-sm text-dfc-danger md:col-span-2 xl:col-span-3">{error}</div> : null}
        {!error && !companions.length ? (
          <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4 text-sm text-dfc-subtext md:col-span-2 xl:col-span-3">
            暂无已上架陪玩。请先让管理员在后台审核上架。
          </div>
        ) : null}
        {companions.map((companion) => (
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
    game: gameName(companion.game),
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

function toVoice(value: string) {
  if (value === "REQUIRED") return "必须语音";
  if (value === "TEXT_ONLY") return "仅文字";
  return "可语音";
}
