import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";
import { complaints } from "../data";

export default function ComplaintsPage() {
  return (
    <AdminShell>
      <SectionHeader title="投诉处理" desc="关联订单、双方说明和处理结果，必要时进入退款流程。" />
      <DataTable columns={["编号", "订单", "发起人", "原因", "状态", "操作"]} rows={complaints.map((c) => [c.id, c.order, c.reporter, c.reason, <StatusBadge key={c.id} tone="warning">{c.status}</StatusBadge>, <ActionButton key={`${c.id}-a`}>处理</ActionButton>])} />
    </AdminShell>
  );
}
