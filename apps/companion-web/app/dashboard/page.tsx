"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CompanionShell, MetricCard, OrderCard, SectionHeader } from "../components";

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

type AvailableOrder = {
  id: string;
  orderNo: string;
  mode: string;
  hours: string;
  totalAmount: string;
  status: string;
  customer?: { displayName: string };
};

export default function CompanionDashboardPage() {
  const [profile, setProfile] = useState<CompanionMe | null>(null);
  const [availableOrders, setAvailableOrders] = useState<AvailableOrder[]>([]);
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

  useEffect(() => {
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) return;

    void fetch("/api/orders/companion/available", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async (response) => {
        if (!response.ok) return [];
        return (await response.json()) as AvailableOrder[];
      })
      .then((items) => setAvailableOrders(items.slice(0, 3)))
      .catch(() => setAvailableOrders([]));
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
        <div className="companion-card p-4 text-sm text-dfc-subtext">正在加载你的陪玩工作台...</div>
      </CompanionShell>
    );
  }

  const activeOrderCount = profile.companionOrders.filter((order) => ["ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(order.status)).length;
  const nickname = profile.companionProfile?.nickname ?? profile.user.displayName;

  return (
    <CompanionShell>
      <section className="companion-hero p-5 md:p-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div>
            <SectionHeader
              eyebrow="Maycat Companion Console"
              title={`${nickname}，准备接单。`}
              desc={`账号：${formatAccountEmail(profile.user.email)}。这里显示当前陪玩账号的资料、收益、可接订单和服务中的订单。`}
            />
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/available-orders" className="rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950">
                查看可接订单
              </Link>
              <Link href="/withdrawals" className="rounded-dfc-control border border-cyan-300/20 bg-[#101827] px-4 py-3 text-sm font-black text-dfc-text">
                申请提现
              </Link>
              <Link href="/profile" className="rounded-dfc-control border border-cyan-300/20 bg-[#101827] px-4 py-3 text-sm font-black text-dfc-text">
                收款资料
              </Link>
            </div>
          </div>
          <div className="companion-queue-item">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-200">Status</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <MiniSignal label="资料" value={toProfileStatus(profile.companionProfile?.status)} />
              <MiniSignal label="在线" value={toOnlineStatus(profile.companionProfile?.onlineStatus)} />
              <MiniSignal label="价格" value={`¥${formatMoney(profile.companionProfile?.pricePerHour ?? "0")}/h`} />
              <MiniSignal label="进行中" value={`${activeOrderCount} 单`} />
            </div>
          </div>
        </div>
      </section>

      <section className="mt-5 grid gap-4 md:grid-cols-4">
        <MetricCard label="资料状态" value={toProfileStatus(profile.companionProfile?.status)} hint={toOnlineStatus(profile.companionProfile?.onlineStatus)} />
        <MetricCard label="可提现收益" value={`¥${formatMoney(profile.wallet?.availableIncome ?? "0")}`} hint="当前账号可提交提现" tone="gold" />
        <MetricCard label="待结算收益" value={`¥${formatMoney(profile.wallet?.pendingIncome ?? "0")}`} hint="订单完成后结算" />
        <MetricCard label="进行中订单" value={String(activeOrderCount)} hint="当前陪玩账号订单" tone="green" />
      </section>

      <section className="mt-8 grid gap-5 lg:grid-cols-2">
        <div>
          <SectionHeader title="可接订单" desc="显示派给你或平台开放给已上架陪玩的真实订单。" />
          <div className="mt-4 space-y-4">
            {availableOrders.length ? (
              availableOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={{
                    id: order.orderNo,
                    mode: order.mode,
                    customer: order.customer?.displayName,
                    hours: Number(order.hours),
                    amount: Number(order.totalAmount),
                    status: order.status
                  }}
                  action="去接单"
                />
              ))
            ) : (
              <EmptyState text="暂无可接订单。" />
            )}
          </div>
        </div>
        <div>
          <SectionHeader title="我的订单" desc="已接单、服务中和历史订单会显示在这里。" />
          <div className="mt-4 space-y-4">
            {profile.companionOrders.length ? (
              profile.companionOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={{
                    id: order.orderNo,
                    mode: order.mode,
                    customer: order.customerName,
                    hours: Number(order.hours),
                    amount: Number(order.companionIncome || order.totalAmount),
                    status: order.status
                  }}
                  action={order.status === "IN_PROGRESS" ? "完成订单" : undefined}
                />
              ))
            ) : (
              <EmptyState text="当前账号还没有订单。" />
            )}
          </div>
        </div>
      </section>
    </CompanionShell>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="companion-card p-4 text-sm text-dfc-subtext">{text}</div>;
}

function MiniSignal({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-dfc-control border border-cyan-300/15 bg-[#050711]/60 p-3">
      <div className="text-xs text-dfc-muted">{label}</div>
      <div className="mt-1 text-sm font-black text-white">{value}</div>
    </div>
  );
}

function formatMoney(value: string) {
  return Number(value || 0).toFixed(2);
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
  return "未设置";
}

function formatAccountEmail(email: string) {
  return email.endsWith("@oauth.maycatplay.local") ? "第三方账号注册" : email;
}
