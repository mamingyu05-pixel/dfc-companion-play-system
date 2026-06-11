"use client";

import { useEffect, useState } from "react";
import { CompanionShell, MetricCard, SectionHeader } from "../components";

type CompanionWalletSummary = {
  wallet: {
    availableIncome: string;
    pendingIncome: string;
    frozenIncome: string;
    transactions: Array<{
      id: string;
      type: string;
      direction: string;
      amount: string;
      balanceAfter: string;
      createdAt: string;
    }>;
  } | null;
  withdrawingAmount: string;
};

export default function EarningsPage() {
  const [summary, setSummary] = useState<CompanionWalletSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) return;

    void fetch("/api/wallet/companion-summary", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("无法加载收益数据");
        return (await response.json()) as CompanionWalletSummary;
      })
      .then(setSummary)
      .catch(() => setError("无法加载收益数据，请刷新页面"));
  }, []);

  const wallet = summary?.wallet;

  return (
    <CompanionShell>
      <SectionHeader title="我的收益明细" desc="这里只显示当前陪玩账号的可提现收益、待结算收益和钱包流水。" />
      {error ? <div className="mt-4 rounded-dfc-control border border-dfc-danger/40 bg-dfc-danger/10 px-3 py-2 text-sm text-dfc-danger">{error}</div> : null}
      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <MetricCard label="可提现收益" value={`¥${formatMoney(wallet?.availableIncome ?? "0")}`} hint="当前账号可提交提现" />
        <MetricCard label="待结算收益" value={`¥${formatMoney(wallet?.pendingIncome ?? "0")}`} hint="订单完成后释放" />
        <MetricCard label="提现中" value={`¥${formatMoney(summary?.withdrawingAmount ?? "0")}`} hint="等待人工打款" />
      </section>
      <section className="mt-6 rounded-dfc border border-dfc-border bg-dfc-surface p-4">
        <h2 className="text-base font-semibold">我的收益流水</h2>
        <div className="mt-4 space-y-3">
          {wallet?.transactions.length ? (
            wallet.transactions.map((item) => (
              <div key={item.id} className="flex items-center justify-between border-b border-dfc-border pb-3 last:border-b-0 last:pb-0">
                <div>
                  <div className="text-sm font-medium">{item.type}</div>
                  <div className="mt-1 text-xs text-dfc-subtext">余额：¥{formatMoney(item.balanceAfter)}</div>
                </div>
                <div className="font-semibold">{item.direction === "CREDIT" ? "+" : "-"}¥{formatMoney(item.amount)}</div>
              </div>
            ))
          ) : (
            <div className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm text-dfc-subtext">
              当前账号暂无收益流水。
            </div>
          )}
        </div>
      </section>
    </CompanionShell>
  );
}

function formatMoney(value: string) {
  return Number(value).toFixed(2);
}
