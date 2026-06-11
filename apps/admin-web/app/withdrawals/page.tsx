import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";
import { withdrawals } from "../data";

export default function WithdrawalsPage() {
  return (
    <AdminShell>
      <SectionHeader title="提现审核" desc="审核陪玩提现申请，人工打款后确认完成并生成流水。" />
      <DataTable columns={["编号", "陪玩", "金额", "账户", "状态", "操作"]} rows={withdrawals.map((w) => [w.id, w.companion, w.amount, w.account, <StatusBadge key={w.id} tone="warning">{w.status}</StatusBadge>, <div key={`${w.id}-a`} className="flex gap-2"><ActionButton>通过</ActionButton><ActionButton tone="secondary">确认打款</ActionButton></div>])} />
    </AdminShell>
  );
}
