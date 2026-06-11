"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CompanionShell, MetricCard, OrderCard, SectionHeader } from "../components";
import { availableOrders } from "../data";

type CompanionMe = {
  user: {
    id: string;
    email: string;
    displayName: string;
    role: string;
  };
  wallet: {
    availableIncome: string;
    pendingIncome: string;
  } | null;
  companionProfile: {
    nickname: string;
    onlineStatus: string;
    status: string;
    pricePerHour: string;
  } | null;
  companionOrders: Array<{
    id: string;
    orderNo: string;
    mode: string;
    status: string;
    hours: string;
    totalAmount: string;
    companionIncome: string;
    customerName: string;
    createdAt: string;
  }>;
};

export default function CompanionDashboardPage() {
  const [profile, setProfile] = useState<CompanionMe | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) return;

    void fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unauthorized");
        return (await response.json()) as CompanionMe;
      })
      .then(setProfile)
      .catch(() => setError("无法加载陪玩资料，请重新登录"));
  }, []);

  if (error) {
    return (
      <CompanionShell>
        <div className="rounded-dfc border border-dfc-danger/40 bg-dfc-danger/10 p-4 text-sm text-dfc-danger">{error}</div>
      </CompanionShell>
    );
  }

  if (!profile) {
    return (
      <CompanionShell>
        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4 text-sm text-dfc-subtext">正在加载你的陪玩工作台...</div>
      </CompanionShell>
    );
  }

  const activeOrderCount = profile.companionOrders.filter((order) => ["ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(order.status)).length;

  return (
    <CompanionShell>
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <SectionHeader
          title={`${profile.companionProfile?.nickname ?? profile.user.displayName} 的陪玩工作台`}
          desc={`账号：${profile.user.email}。这里只显示当前陪玩账号的资料、收益和订单。`}
        />
        <Link href="/profile" className="rounded-dfc-control border border-dfc-border bg-dfc-surface px-4 py-2 text-sm font-semibold text-dfc-text">
          编辑资料
        </Link>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-4">
        <MetricCard label="资料状态" value={toProfileStatus(profile.companionProfile?.status)} hint={toOnlineStatus(profile.companionProfile?.onlineStatus)} />
        <MetricCard label="可提现收益" value={`¥${formatMoney(profile.wallet?.availableIncome ?? "0")}`} hint="当前账号可提现" />
        <MetricCard label="待结算收益" value={`¥${formatMoney(profile.wallet?.pendingIncome ?? "0")}`} hint="订单完成后结算" />
        <MetricCard label="我的进行中订单" value={String(activeOrderCount)} hint="只统计当前陪玩账号" />
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <div>
          <SectionHeader title="可接订单" desc="后续会接入真实派单池；当前仍展示测试订单。" />
          <div className="mt-4 space-y-4">
            {availableOrders.map((order) => <OrderCard key={order.id} order={order} action="去接单" />)}
          </div>
        </div>
        <div>
          <SectionHeader title="我的订单" />
          <div className="mt-4 space-y-4">
            {profile.companionOrders.length ? (
              profile.companionOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={{
                    id: order.orderNo,
                    mode: `${order.customerName} · ${order.mode}`,
                    hours: Number(order.hours),
                    amount: Number(order.companionIncome || order.totalAmount),
                    status: order.status
                  }}
                  action={order.status === "IN_PROGRESS" ? "完成订单" : undefined}
                />
              ))
            ) : (
              <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4 text-sm text-dfc-subtext">
                当前账号还没有订单。
              </div>
            )}
          </div>
        </div>
      </section>
    </CompanionShell>
  );
}

function formatMoney(value: string) {
  return Number(value).toFixed(2);
}

function toProfileStatus(status?: string) {
  if (status === "LISTED") return "已上架";
  if (status === "UNLISTED") return "已下架";
  if (status === "BANNED") return "封禁";
  if (status === "PENDING_REVIEW") return "待审核";
  return "未创建";
}

function toOnlineStatus(status?: string) {
  if (status === "ONLINE") return "在线";
  if (status === "BUSY") return "忙碌";
  if (status === "OFFLINE") return "离线";
  return "未设置在线状态";
}
