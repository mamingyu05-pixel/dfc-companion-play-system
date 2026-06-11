import Link from "next/link";
import { Badge, CustomerShell, SectionHeader } from "../../components";
import { companions } from "../../data";

export default async function CompanionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companion = companions.find((item) => item.id === id) ?? companions[0];

  return (
    <CustomerShell>
      <section className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div>
          <SectionHeader title={companion.nickname} desc={companion.intro} />

          <div className="mt-5 flex flex-wrap gap-2">
            <Badge tone={companion.accent === "gold" ? "gold" : "default"}>{companion.onlineStatus}</Badge>
            <Badge>{companion.rank}</Badge>
            <Badge>{companion.voice}</Badge>
            <Badge>{companion.voiceStyle}</Badge>
            <Badge>{companion.trial}</Badge>
            {companion.modes.map((mode) => (
              <Badge key={mode}>{mode}</Badge>
            ))}
          </div>

          <section className="mt-8 rounded-dfc border border-dfc-border bg-dfc-surface p-4">
            <h2 className="text-base font-semibold">服务特点</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {companion.tags.map((tag) => (
                <div key={tag} className="rounded-dfc-control border border-dfc-border bg-dfc-bg p-3 text-sm text-dfc-subtext">
                  {tag}
                </div>
              ))}
            </div>
          </section>

          <section className="mt-4 rounded-dfc border border-dfc-border bg-dfc-surface p-4">
            <h2 className="text-base font-semibold">下单说明</h2>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-dfc-subtext">
              <li>订单提交后进入待派单，管理员确认后通过 Discord/KOOK 通知陪玩。</li>
              <li>可申请进入临时语音频道试音，试音不代表订单开始。</li>
              <li>陪玩接单后订单开始前仍可联系客服处理异常。</li>
              <li>金额由后端按单价和时长计算，前端仅展示确认信息。</li>
            </ul>
          </section>
        </div>

        <aside className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-dfc bg-dfc-elevated text-2xl font-black text-dfc-blue">
            {companion.nickname.slice(0, 1)}
          </div>
          <div className="mt-4 text-sm text-dfc-muted">每小时</div>
          <div className="text-3xl font-semibold text-dfc-blue">¥{companion.price}</div>
          <div className="mt-2 text-sm text-dfc-subtext">评分 {companion.rating} · 已完成 {companion.orders} 单</div>
          <Link
            href={`/order?companion=${companion.id}`}
            className="mt-5 block rounded-dfc-control bg-dfc-blue px-4 py-3 text-center text-sm font-semibold text-slate-950"
          >
            立即下单
          </Link>
          <Link
            href={`/order?companion=${companion.id}&trial=1`}
            className="mt-3 block rounded-dfc-control border border-dfc-blue/50 px-4 py-3 text-center text-sm font-semibold text-dfc-blue"
          >
            申请试音
          </Link>
        </aside>
      </section>
    </CustomerShell>
  );
}
