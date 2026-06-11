import { CompanionCard, CustomerShell, SectionHeader } from "../components";
import { companions, games } from "../data";

const filters = ["全部", "在线优先", "可语音", "推荐", "新手友好", "高分段"];

export default function CompanionsPage() {
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
        {companions.map((companion) => (
          <CompanionCard key={companion.id} companion={companion} />
        ))}
      </section>
    </CustomerShell>
  );
}
