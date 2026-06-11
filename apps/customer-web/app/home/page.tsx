"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CompanionCard, CustomerShell, SectionHeader, StatCard } from "../components";
import { companions } from "../data";

type CustomerProfile = {
  user: {
    id: string;
    email: string;
    role: string;
    displayName: string;
  };
  wallet: {
    availableBalance: string;
    frozenBalance: string;
    availableIncome: string;
    pendingIncome: string;
  } | null;
  recentOrders: Array<{
    id: string;
    orderNo: string;
    mode: string;
    status: string;
    totalAmount: string;
    companionName: string;
    createdAt: string;
  }>;
  walletTransactions: Array<{
    id: string;
    type: string;
    direction: string;
    amount: string;
    balanceAfter: string;
    createdAt: string;
  }>;
};

export default function CustomerHomePage() {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("dfc_customer_token");
    if (!token) {
      window.location.href = "/customer/";
      return;
    }

    void fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async (response) => {
        if (!response.ok) {
          localStorage.removeItem("dfc_customer_token");
          localStorage.removeItem("dfc_customer_user");
          window.location.href = "/customer/";
          return null;
        }
        return (await response.json()) as CustomerProfile;
      })
      .then((data) => {
        if (data) setProfile(data);
      })
      .catch(() => setError("无法加载客户资料，请刷新页面或重新登录"));
  }, []);

  if (error) {
    return (
      <CustomerShell>
        <div className="rounded-dfc border border-dfc-danger/40 bg-dfc-danger/10 p-4 text-sm text-dfc-danger">{error}</div>
      </CustomerShell>
    );
  }

  if (!profile) {
    return (
      <CustomerShell>
        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4 text-sm text-dfc-subtext">正在加载你的客户资料...</div>
      </CustomerShell>
    );
  }

  const availableBalance = profile.wallet?.availableBalance ?? "0";
  const pendingOrderCount = profile.recentOrders.filter((order) => ["PAID", "ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(order.status)).length;

  return (
    <CustomerShell>
      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="py-2">
          <SectionHeader
            title={`${profile.user.displayName} 的客户中心`}
            desc={`账号：${profile.user.email}。这里显示你的余额、订单和钱包流水。充值、派单、接单、结算都会保留后台记录。`}
          />
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link href="/companions" className="rounded-dfc-control bg-dfc-blue px-5 py-3 text-center text-sm font-semibold text-slate-950">
              选择陪玩
            </Link>
            <Link href="/recharge" className="rounded-dfc-control border border-dfc-border bg-dfc-surface px-5 py-3 text-center text-sm font-semibold text-dfc-text">
              余额充值
            </Link>
            <button
              type="button"
              onClick={() => {
                localStorage.removeItem("dfc_customer_token");
                localStorage.removeItem("dfc_customer_user");
                window.location.href = "/customer/";
              }}
              className="rounded-dfc-control border border-dfc-border bg-dfc-surface px-5 py-3 text-center text-sm font-semibold text-dfc-subtext"
            >
              退出登录
            </button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          <StatCard label="我的可用余额" value={`¥${formatMoney(availableBalance)}`} hint="余额不足时先提交充值审核" />
          <StatCard label="我的进行中订单" value={String(pendingOrderCount)} hint="只统计当前账号订单" />
          <StatCard label="账号角色" value="客户" hint="客户、陪玩、管理员入口相互独立" />
        </div>
      </section>

      <section className="mt-10">
        <div className="flex items-end justify-between gap-4">
          <SectionHeader title="推荐陪玩" desc="优先展示在线、评分高、资料完整的陪玩。" />
          <Link href="/companions" className="hidden text-sm font-semibold text-dfc-blue md:block">
            查看全部
          </Link>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {companions.map((companion) => (
            <CompanionCard key={companion.id} companion={companion} />
          ))}
        </div>
      </section>

      <section className="mt-10 grid gap-4 lg:grid-cols-2">
        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">我的最近订单</h2>
          <div className="mt-4 space-y-3">
            {profile.recentOrders.length ? (
              profile.recentOrders.map((order) => (
                <div key={order.id} className="flex items-center justify-between gap-3 border-b border-dfc-border pb-3 last:border-b-0 last:pb-0">
                  <div>
                    <div className="text-sm font-medium">{order.orderNo}</div>
                    <div className="mt-1 text-xs text-dfc-subtext">{order.companionName} · {order.mode}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold">¥{formatMoney(order.totalAmount)}</div>
                    <div className="mt-1 text-xs text-dfc-blue">{order.status}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm text-dfc-subtext">
                你还没有订单，先选择陪玩或提交平台匹配订单。
              </div>
            )}
          </div>
        </div>
        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">我的钱包流水</h2>
          <div className="mt-4 space-y-3">
            {profile.walletTransactions.length ? (
              profile.walletTransactions.map((transaction) => (
                <div key={transaction.id} className="flex items-center justify-between gap-3 border-b border-dfc-border pb-3 last:border-b-0 last:pb-0">
                  <div>
                    <div className="text-sm font-medium">{transaction.type}</div>
                    <div className="mt-1 text-xs text-dfc-subtext">余额：¥{formatMoney(transaction.balanceAfter)}</div>
                  </div>
                  <div className="text-sm font-semibold">{transaction.direction === "CREDIT" ? "+" : "-"}¥{formatMoney(transaction.amount)}</div>
                </div>
              ))
            ) : (
              <div className="rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm text-dfc-subtext">
                暂无流水。充值审核通过、订单支付和退款都会显示在这里。
              </div>
            )}
          </div>
        </div>
      </section>
    </CustomerShell>
  );
}

function formatMoney(value: string) {
  return Number(value).toFixed(2);
}
