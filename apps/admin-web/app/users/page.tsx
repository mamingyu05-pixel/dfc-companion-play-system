import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

const users = [
  ["C-1001", "customer-a@example.com", "CUSTOMER", <StatusBadge key="u1" tone="success">ACTIVE</StatusBadge>, <ActionButton key="a1" tone="danger">封禁</ActionButton>],
  ["U-1001", "nova@example.com", "COMPANION", <StatusBadge key="u2" tone="success">ACTIVE</StatusBadge>, <ActionButton key="a2" tone="secondary">查看</ActionButton>]
];

export default function UsersPage() {
  return (
    <AdminShell>
      <SectionHeader title="用户管理" desc="统一 users 表管理客户、陪玩、管理员账号。" />
      <DataTable columns={["ID", "邮箱", "角色", "状态", "操作"]} rows={users} />
    </AdminShell>
  );
}
