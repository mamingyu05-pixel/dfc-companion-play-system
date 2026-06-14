"use client";

import { useEffect, useMemo, useState } from "react";
import { CompanionShell, MetricCard, SectionHeader, StatusBadge } from "../components";

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
  const creditAmount = useMemo(
    () => wallet?.transactions.filter((item) => item.direction === "CREDIT").reduce((sum, item) => sum + Number(item.amount || 0), 0) ?? 0,
    [wallet]
  );

  return (
    <CompanionShell>
      <SectionHeader eyebrow="Income Ledger" title="我的收益明细" desc="这里只显示当前陪玩账号的可提现收益、待结算收益、提现中金额和钱包流水。" />
      {error ? <div className="mt-4 rounded-dfc-control border border-dfc-danger/40 bg-dfc-danger/10 px-3 py-2 text-sm text-dfc-danger">{error}</div> : null}

      <section className="mt-6 grid gap-4 md:grid-cols-4">
        <MetricCard label="可提现收益" value={`¥${formatMoney(wallet?.availableIncome ?? "0")}`} hint="当前账号可提交提现" tone="gold" />
        <MetricCard label="待结算收益" value={`¥${formatMoney(wallet?.pendingIncome ?? "0")}`} hint="订单完成后释放" />
        <MetricCard label="提现中" value={`¥${formatMoney(summary?.withdrawingAmount ?? "0")}`} hint="等待人工打款" tone="green" />
        <MetricCard label="累计入账" value={`¥${formatMoney(String(creditAmount))}`} hint="当前流水入账合计" />
      </section>

      <section className="companion-card mt-6 p-4">
        <h2 className="text-base font-black text-white">我的收益流水</h2>
        <div className="mt-4 space-y-3">
          {wallet?.transactions.length ? (
            wallet.transactions.map((item) => (
              <div key={item.id} className="companion-queue-item flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-white">{toTransactionType(item.type)}</div>
                  <div className="mt-1 text-xs text-dfc-muted">余额 ¥{formatMoney(item.balanceAfter)} / {formatDateTime(item.createdAt)}</div>
                </div>
                <div className="text-right">
                  <div className={`font-black tabular-nums ${item.direction === "CREDIT" ? "text-dfc-success" : "text-dfc-gold"}`}>
                    {item.direction === "CREDIT" ? "+" : "-"}¥{formatMoney(item.amount)}
                  </div>
                  <StatusBadge tone="success">已记录</StatusBadge>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-dfc-control border border-cyan-300/15 bg-[#050711]/60 px-3 py-3 text-sm text-dfc-subtext">当前账号暂无收益流水。</div>
          )}
        </div>
      </section>
    </CompanionShell>
  );
}

function formatMoney(value: string) {
  return Number(value || 0).toFixed(2);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function toTransactionType(type: string) {
  const map: Record<string, string> = {
    ORDER_SETTLEMENT: "订单结算",
    WITHDRAWAL: "提现",
    ADMIN_ADJUSTMENT: "管理员调账"
  };
  return map[type] ?? type;
}
