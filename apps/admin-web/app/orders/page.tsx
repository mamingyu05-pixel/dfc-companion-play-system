import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";
import { orders } from "../data";

export default function OrdersPage() {
  return (
    <AdminShell>
      <SectionHeader title="订单管理" desc="查看订单状态、金额、Bot 通知状态和状态日志。" />
      <DataTable
        columns={["订单", "客户", "陪玩", "状态", "金额", "Bot", "操作"]}
        rows={orders.map((order) => [
          order.id,
          order.customer,
          order.companion,
          <StatusBadge key={`${order.id}-s`} tone={order.status === "已完成" ? "success" : "warning"}>{order.status}</StatusBadge>,
          order.amount,
          order.bot,
          <ActionButton key={`${order.id}-a`} tone="secondary">详情</ActionButton>
        ])}
      />
    </AdminShell>
  );
}
