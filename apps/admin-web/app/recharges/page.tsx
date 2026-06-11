import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";
import { recharges } from "../data";

export default function RechargesPage() {
  return (
    <AdminShell>
      <SectionHeader title="充值审核" desc="核对金额和截图，通过后增加客户余额并生成钱包流水。" />
      <DataTable columns={["编号", "客户", "金额", "截图", "状态", "操作"]} rows={recharges.map((r) => [r.id, r.customer, r.amount, r.screenshot, <StatusBadge key={r.id} tone="warning">{r.status}</StatusBadge>, <div key={`${r.id}-a`} className="flex gap-2"><ActionButton>通过</ActionButton><ActionButton tone="danger">拒绝</ActionButton></div>])} />
    </AdminShell>
  );
}
