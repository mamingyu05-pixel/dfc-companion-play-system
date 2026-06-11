import type { ReactNode } from "react";
import { AdminShell, DataTable, MetricCard, SectionHeader, StatusBadge } from "../components";
import { adminLogs, metrics, orders, recharges, withdrawals } from "../data";

export default function AdminDashboardPage() {
  return (
    <AdminShell>
      <SectionHeader title="数据看板" desc="优先处理待派单、充值审核、提现审核和投诉。" />
      <section className="grid gap-4 md:grid-cols-4">
        {metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
      </section>
      <section className="mt-8 grid gap-5 xl:grid-cols-2">
        <Panel title="待派单订单">
          <DataTable columns={["订单", "客户", "陪玩", "状态", "金额"]} rows={orders.slice(0, 2).map((o) => [o.id, o.customer, o.companion, <StatusBadge key={o.id} tone="warning">{o.status}</StatusBadge>, o.amount])} />
        </Panel>
        <Panel title="待审核事项">
          <DataTable columns={["类型", "编号", "对象", "金额", "状态"]} rows={[
            ...recharges.map((r) => ["充值", r.id, r.customer, r.amount, <StatusBadge key={r.id} tone="warning">{r.status}</StatusBadge>]),
            ...withdrawals.map((w) => ["提现", w.id, w.companion, w.amount, <StatusBadge key={w.id} tone="warning">{w.status}</StatusBadge>])
          ]} />
        </Panel>
        <Panel title="最近操作日志">
          <DataTable columns={["操作人", "动作", "对象", "时间"]} rows={adminLogs.map((log) => [log.actor, log.action, log.target, log.time])} />
        </Panel>
      </section>
    </AdminShell>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}
