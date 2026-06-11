import { CompanionShell, OrderCard, SectionHeader } from "../components";
import { myOrders } from "../data";

export default function MyOrdersPage() {
  return (
    <CompanionShell>
      <SectionHeader title="我的订单" desc="查看已接订单、进行中订单和历史订单。" />
      <section className="mt-6 grid gap-4 md:grid-cols-2">
        {myOrders.map((order) => <OrderCard key={order.id} order={order} action={order.status === "进行中" ? "完成订单" : undefined} />)}
      </section>
    </CompanionShell>
  );
}
