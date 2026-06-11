import { AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

const rows = [
  ["T-001", "充值入账", "客户A", "+¥300", <StatusBadge key="f1" tone="success">已完成</StatusBadge>],
  ["T-002", "订单支付", "客户A", "-¥136", <StatusBadge key="f2" tone="success">已完成</StatusBadge>],
  ["T-003", "订单结算", "Nova", "+¥108.80", <StatusBadge key="f3" tone="success">已完成</StatusBadge>]
];

export default function FinancePage() {
  return (
    <AdminShell>
      <SectionHeader title="财务流水" desc="查看所有钱包流水、订单结算、充值、提现记录。" />
      <DataTable columns={["编号", "类型", "对象", "金额", "状态"]} rows={rows} />
    </AdminShell>
  );
}
