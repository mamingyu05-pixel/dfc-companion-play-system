import Link from "next/link";
import { CompanionShell, MetricCard, OrderCard, SectionHeader } from "../components";
import { availableOrders, companionProfile, myOrders } from "../data";

export default function CompanionDashboardPage() {
  return (
    <CompanionShell>
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <SectionHeader title="陪玩工作台" desc="查看当前订单、待接订单和收益状态。接单以 Discord/KOOK 按钮回写为准。" />
        <Link href="/profile" className="rounded-dfc-control border border-dfc-border bg-dfc-surface px-4 py-2 text-sm font-semibold text-dfc-text">
          编辑资料
        </Link>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-4">
        <MetricCard label="在线状态" value={companionProfile.onlineStatus} hint={companionProfile.listedStatus} />
        <MetricCard label="可提现收益" value="¥208.80" hint="人工提现审核" />
        <MetricCard label="待结算收益" value="¥136.00" hint="订单完成后结算" />
        <MetricCard label="今日订单" value="2" hint="1 个进行中" />
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <div>
          <SectionHeader title="待接订单" />
          <div className="mt-4 space-y-4">
            {availableOrders.map((order) => <OrderCard key={order.id} order={order} action="去接单" />)}
          </div>
        </div>
        <div>
          <SectionHeader title="我的订单" />
          <div className="mt-4 space-y-4">
            {myOrders.map((order) => <OrderCard key={order.id} order={order} action={order.status === "进行中" ? "完成订单" : undefined} />)}
          </div>
        </div>
      </section>
    </CompanionShell>
  );
}
