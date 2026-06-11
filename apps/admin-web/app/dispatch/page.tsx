import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";
import { companions, orders } from "../data";

export default function DispatchPage() {
  const pending = orders.filter((order) => order.status === "待派单");
  return (
    <AdminShell>
      <SectionHeader title="派单页面" desc="支持指定陪玩确认和平台代选人工挑人。确认后同步通知 Discord 与 KOOK，并可创建试音语音房。" />
      <section className="grid gap-5 xl:grid-cols-[1fr_1.2fr]">
        <div>
          <h2 className="mb-3 text-base font-semibold">待派单订单</h2>
          <DataTable columns={["订单", "客户", "金额", "状态"]} rows={pending.map((o) => [o.id, o.customer, o.amount, <StatusBadge key={o.id} tone="warning">{o.status}</StatusBadge>])} />
        </div>
        <div>
          <h2 className="mb-3 text-base font-semibold">可选陪玩</h2>
          <DataTable columns={["昵称", "状态", "价格", "KOOK", "Discord", "操作"]} rows={companions.map((c) => [c.nickname, c.status, c.price, c.kook, c.discord, <ActionButton key={c.id}>派单</ActionButton>])} />
        </div>
      </section>
    </AdminShell>
  );
}
