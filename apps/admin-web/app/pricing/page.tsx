"use client";

import Link from "next/link";
import { AdminShell, SectionHeader } from "../components";
import { GuaranteePackageSection } from "./guarantee-packages";
import { RankPriceSection } from "./rank-prices";

export default function PricingPage() {
  return (
    <AdminShell>
      <SectionHeader title="价格设置" eyebrow="Pricing"
        desc="所有对外价格在这一页改：小时陪玩的段位价、保底护航档位。改价只影响之后的新订单。" />
      <p className="mb-5 text-sm text-dfc-subtext">
        单个陪玩的专属小时价在 <Link className="text-cyan-200 underline" href="/companions">陪玩</Link> 页逐人设置；
        充值赠送和优惠码在 <Link className="text-cyan-200 underline" href="/promotions">优惠</Link> 页。
      </p>
      <div className="space-y-6">
        <RankPriceSection />
        <GuaranteePackageSection />
      </div>
    </AdminShell>
  );
}
