import { CompanionCard, CustomerShell, SectionHeader } from "../components";
import { companions } from "../data";

const filters = ["全部模式", "烽火地带", "全面战场", "在线优先", "可语音", "推荐"];

export default function CompanionsPage() {
  return (
    <CustomerShell>
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <SectionHeader title="陪玩列表" desc="根据模式、价格、在线状态和语音偏好选择陪玩。所有陪玩由管理员审核后上架。" />
        <div className="rounded-dfc-control border border-dfc-border bg-dfc-surface px-3 py-2 text-sm text-dfc-subtext">
          共 {companions.length} 位陪玩
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
