import { CompanionShell, OrderCard, SectionHeader } from "../components";
import { availableOrders } from "../data";

export default function AvailableOrdersPage() {
  return (
    <CompanionShell>
      <SectionHeader title="可接订单" desc="管理员派单后，订单会同步到 Discord/KOOK。点击接单后系统会做防重复校验。" />
      <section className="mt-6 grid gap-4 md:grid-cols-2">
        {availableOrders.map((order) => <OrderCard key={order.id} order={order} action="接单" />)}
      </section>
    </CompanionShell>
  );
}
