"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CustomerShell, SectionHeader, StatCard } from "../components";

type CustomerMe = {
  user: {
    id: string;
    email: string;
    displayName: string;
  };
  wallet: {
    availableBalance: string;
    frozenBalance: string;
  } | null;
  recentOrders: Array<{
    orderNo: string;
    status: string;
  }>;
};

export default function SupportPage() {
  const [profile, setProfile] = useState<CustomerMe | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("dfc_customer_token");
    if (!token) return;

    void fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unauthorized");
        return (await response.json()) as CustomerMe;
      })
      .then(setProfile)
      .catch(() => {
        localStorage.removeItem("dfc_customer_token");
        localStorage.removeItem("dfc_customer_user");
        window.location.href = "/customer/";
      });
  }, []);

  return (
    <CustomerShell>
      <SectionHeader
        title="人工客服中心"
        desc="第一阶段充值、退款、投诉都由人工处理。联系客服时请提供账号邮箱、充值记录或订单号。"
      />

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <StatCard label="当前账号" value={profile?.user.displayName ?? "加载中"} hint={profile?.user.email ?? "请先登录"} />
        <StatCard label="客户 ID" value={profile?.user.id.slice(0, 8) ?? "-"} hint="联系客服时可提供" />
        <StatCard label="可用余额" value={`¥${formatMoney(profile?.wallet?.availableBalance ?? "0")}`} hint="只显示当前账号余额" />
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">常见人工处理</h2>
          <div className="mt-4 space-y-3 text-sm text-dfc-subtext">
            <SupportItem title="充值未到账" desc="先到充值页提交金额和截图，管理员会在后台审核，通过后余额自动增加。" href="/recharge" action="去提交充值" />
            <SupportItem title="充值金额填错" desc="不要重复提交，联系客服说明正确金额，管理员可在后台按客户搜索后人工加余额。" href="/recharge" action="查看充值记录" />
            <SupportItem title="订单问题 / 退款投诉" desc="请提供订单号、陪玩昵称、问题说明。投诉处理页接入后会形成正式工单。" href="/home" action="查看我的订单" />
          </div>
        </div>

        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
          <h2 className="text-base font-semibold">联系信息</h2>
          <div className="mt-4 rounded-dfc-control border border-dfc-border bg-dfc-bg p-3 text-sm text-dfc-subtext">
            <div>客服会优先处理已提交充值截图的用户。</div>
            <div className="mt-2">请复制以下信息发给客服：</div>
            <div className="mt-3 rounded-dfc-control border border-dfc-border bg-dfc-surface p-3 text-xs leading-6">
              <div>账号昵称：{profile?.user.displayName ?? "-"}</div>
              <div>账号邮箱：{profile?.user.email ?? "-"}</div>
              <div>客户 ID：{profile?.user.id ?? "-"}</div>
              <div>最近订单：{profile?.recentOrders[0]?.orderNo ?? "暂无"}</div>
            </div>
          </div>
          <p className="mt-4 text-xs leading-5 text-dfc-muted">
            后续接入 Discord / KOOK OAuth 后，这里会显示一键联系客服、自动同步身份和私信通知。
          </p>
        </div>
      </section>
    </CustomerShell>
  );
}

function SupportItem({ title, desc, href, action }: { title: string; desc: string; href: string; action: string }) {
  return (
    <div className="rounded-dfc-control border border-dfc-border bg-dfc-bg p-3">
      <div className="font-semibold text-dfc-text">{title}</div>
      <div className="mt-1 text-xs leading-5">{desc}</div>
      <Link href={href} className="mt-3 inline-block text-xs font-semibold text-dfc-blue">{action}</Link>
    </div>
  );
}

function formatMoney(value: string) {
  return Number(value).toFixed(2);
}
