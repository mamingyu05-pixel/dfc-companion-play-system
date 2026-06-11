import { CompanionShell, MetricCard, SectionHeader } from "../components";
import { earnings } from "../data";

export default function EarningsPage() {
  return (
    <CompanionShell>
      <SectionHeader title="收益明细" desc="区分可提现收益和待结算收益，所有变化都会进入钱包流水。" />
      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <MetricCard label="可提现收益" value="¥208.80" hint="可提交提现申请" />
        <MetricCard label="待结算收益" value="¥136.00" hint="订单完成后释放" />
        <MetricCard label="提现中" value="¥100.00" hint="等待人工打款" />
      </section>
      <section className="mt-6 rounded-dfc border border-dfc-border bg-dfc-surface p-4">
        <h2 className="text-base font-semibold">收益流水</h2>
        <div className="mt-4 space-y-3">
          {earnings.map((item) => (
            <div key={item.id} className="flex items-center justify-between border-b border-dfc-border pb-3 last:border-b-0 last:pb-0">
              <div>
                <div className="text-sm font-medium">{item.type}</div>
                <div className="mt-1 text-xs text-dfc-subtext">{item.status}</div>
              </div>
              <div className="font-semibold">{item.amount}</div>
            </div>
          ))}
        </div>
      </section>
    </CompanionShell>
  );
}
