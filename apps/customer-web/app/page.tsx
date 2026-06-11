import Link from "next/link";
import { CompanionCard, CustomerShell, SectionHeader, StatCard } from "./components";
import { companions, recentOrders, walletTransactions } from "./data";

export default function CustomerPortalPage() {
  return (
    <CustomerShell>
      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="py-2">
          <SectionHeader
            title="三角洲行动陪玩俱乐部"
            desc="选择已审核陪玩，使用余额下单。充值、派单、接单、结算都会保留后台记录，第一阶段采用人工审核充值。"
          />
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link href="/companions" className="rounded-dfc-control bg-dfc-blue px-5 py-3 text-center text-sm font-semibold text-slate-950">
              选择陪玩
            </Link>
            <Link href="/recharge" className="rounded-dfc-control border border-dfc-border bg-dfc-surface px-5 py-3 text-center text-sm font-semibold text-dfc-text">
              余额充值
            </Link>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          <StatCard label="可用余额" value="¥164.00" hint="余额不足时先提交充值审核" />
          <StatCard label="待处理订单" value="1" hint="当前有 1 个订单等待派单" />
          <StatCard label="推荐陪玩" value="3" hint="已按在线与评分优先展示" />
        </div>
      </section>

      <section className="mt-10">
        <div className="flex items-end justify-between gap-4">
          <SectionHeader title="推荐陪玩" desc="优先展示在线、评分高、资料完整的陪玩。" />
          <Link href="/companions" className="hidden text-sm font-semibold text-dfc-blue md:block">
            查看全部
          </Link>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {companions.map((companion) => (
            <CompanionCard key={companion.id} companion={companion} />
          ))}
        </div>
      </section>

      <section className="mt-10 grid gap-4 lg:grid-cols-2">
        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">最近订单</h2>
          <div className="mt-4 space-y-3">
            {recentOrders.map((order) => (
              <div key={order.id} className="flex items-center justify-between gap-3 border-b border-dfc-border pb-3 last:border-b-0 last:pb-0">
                <div>
                  <div className="text-sm font-medium">{order.id}</div>
                  <div className="mt-1 text-xs text-dfc-subtext">{order.companion} · {order.mode}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">¥{order.amount}</div>
                  <div className="mt-1 text-xs text-dfc-blue">{order.status}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">钱包流水</h2>
          <div className="mt-4 space-y-3">
            {walletTransactions.map((transaction) => (
              <div key={transaction.id} className="flex items-center justify-between gap-3 border-b border-dfc-border pb-3 last:border-b-0 last:pb-0">
                <div>
                  <div className="text-sm font-medium">{transaction.type}</div>
                  <div className="mt-1 text-xs text-dfc-subtext">{transaction.status}</div>
                </div>
                <div className="text-sm font-semibold">{transaction.amount}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </CustomerShell>
  );
}
