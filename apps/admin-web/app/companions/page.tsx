import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";
import { companions } from "../data";

export default function CompanionsPage() {
  return (
    <AdminShell>
      <SectionHeader title="陪玩管理" desc="创建、编辑、上架、下架、封禁陪玩，并绑定 Discord/KOOK 用户 ID。" />
      <DataTable
        columns={["ID", "昵称", "段位", "价格", "状态", "KOOK", "Discord", "操作"]}
        rows={companions.map((item) => [
          item.id,
          item.nickname,
          item.rank,
          item.price,
          <StatusBadge key={`${item.id}-s`} tone={item.status === "已上架" ? "success" : "warning"}>{item.status}</StatusBadge>,
          item.kook,
          item.discord,
          <div key={`${item.id}-a`} className="flex gap-2"><ActionButton tone="secondary">编辑</ActionButton><ActionButton>绑定</ActionButton></div>
        ])}
      />
    </AdminShell>
  );
}
