"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MaycatSignalArtwork } from "../brand";
import { CompanionCard, CustomerShell, SectionHeader, StatCard } from "../components";
import { games } from "../data";

type CustomerProfile = {
  user: {
    id: string;
    email: string;
    role: string;
    displayName: string;
    referralCode?: string | null;
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

type ApiCompanion = {
  id: string;
  nickname: string;
  avatarUrl?: string | null;
  game: string;
  onlineStatus: string;
  deltaForceRank: string;
  skillModes: string[];
  pricePerHour: string;
  voicePreference: string;
  bio?: string | null;
};

export default function CustomerHomePage() {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [companions, setCompanions] = useState<ApiCompanion[]>([]);
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

  useEffect(() => {
    void fetch("/api/orders/public/companions")
      .then(async (response) => {
        if (!response.ok) return [];
        return (await response.json()) as ApiCompanion[];
      })
      .then((items) => setCompanions(items.slice(0, 3)))
      .catch(() => setCompanions([]));
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
        <div className="maycat-card p-4 text-sm text-dfc-subtext">正在加载你的客户资料...</div>
      </CustomerShell>
    );
  }

  const availableBalance = profile.wallet?.availableBalance ?? "0";
  const pendingOrderCount = profile.recentOrders.filter((order) => ["PAID", "ASSIGNED", "ACCEPTED", "IN_PROGRESS"].includes(order.status)).length;
  const onlineCompanionCount = companions.filter((companion) => companion.onlineStatus === "ONLINE").length;

  return (
    <CustomerShell>
      <section className="maycat-home-hero overflow-hidden rounded-dfc border border-cyan-300/20">
        <div className="grid min-h-[520px] gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:p-8">
          <div className="flex flex-col justify-between gap-8">
            <div>
              <div className="maycat-chip px-3 py-1 text-xs font-black uppercase tracking-[0.18em]">KOOK / Discord Ready</div>
              <h1 className="maycat-text-glow mt-5 max-w-3xl text-4xl font-black leading-none text-white sm:text-5xl lg:text-7xl">
                {profile.user.displayName}，今晚进场先试音。
              </h1>
              <p className="mt-5 max-w-2xl text-sm leading-7 text-cyan-50/80 sm:text-base">
                May猫饼电竞已接入 KOOK 和 Discord。你可以先找客服说需求，进入语音频道试音，确认陪玩风格后再下单；充值、派单、订单、钱包和投诉都会在后台留痕。
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link href="/companions" className="maycat-button px-5 py-3 text-center text-sm font-black">
                  进入陪玩大厅
                </Link>
                <Link href="/order" className="maycat-button-secondary px-5 py-3 text-center text-sm font-black">
                  直接提交需求
                </Link>
                <Link href="/support" className="maycat-button-secondary px-5 py-3 text-center text-sm font-black">
                  联系 KOOK / DC 客服
                </Link>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <HeroMetric label="钱包余额" value={`¥${formatMoney(availableBalance)}`} />
              <HeroMetric label="进行中订单" value={String(pendingOrderCount)} />
              <HeroMetric label="在线推荐" value={String(onlineCompanionCount)} />
            </div>
          </div>

          <aside className="maycat-brand-frame self-end">
            <MaycatSignalArtwork />
            <div className="absolute inset-x-4 bottom-4 rounded-dfc border border-cyan-300/20 bg-[#050711]/80 p-4 backdrop-blur-xl">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-fuchsia-200">Signal Dispatch</div>
                  <div className="mt-1 text-lg font-black text-white">KOOK / DC 试音后再派单</div>
                </div>
                <span className="rounded-dfc-control border border-dfc-success/50 bg-dfc-success/10 px-3 py-2 text-xs font-black text-dfc-success">
                  已接入
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-dfc-control bg-cyan-300/10 px-2 py-2 text-cyan-100">客服</div>
                <div className="rounded-dfc-control bg-fuchsia-400/10 px-2 py-2 text-fuchsia-100">试音</div>
                <div className="rounded-dfc-control bg-dfc-gold/10 px-2 py-2 text-dfc-gold">派单</div>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="mt-6 grid gap-3 md:grid-cols-4">
        <StatCard label="我的可用余额" value={`¥${formatMoney(availableBalance)}`} hint="余额不足时先提交充值审核" />
        <StatCard label="我的进行中订单" value={String(pendingOrderCount)} hint="待接单、服务中订单都会统计" />
        <StatCard label="账号角色" value="客户" hint={`账号：${profile.user.email}`} />
        <div className="maycat-card p-4">
          <div className="text-xs text-dfc-muted">我的邀请码</div>
          <div className="mt-2 break-all text-xl font-black text-cyan-200">{profile.user.referralCode || "-"}</div>
          <button
            type="button"
            onClick={() => {
              if (profile.user.referralCode) void navigator.clipboard?.writeText(profile.user.referralCode);
            }}
            className="maycat-button-secondary mt-3 px-3 py-2 text-xs font-semibold"
          >
            复制邀请码
          </button>
          <div className="mt-2 text-xs leading-5 text-dfc-muted">分享给新用户注册填写，奖励以后后台活动配置为准。</div>
        </div>
      </section>

      <section className="mt-10 grid gap-3 md:grid-cols-4">
        <FlowStep step="01" title="说需求" desc="在网页、KOOK 或 Discord 找客服说明游戏、模式、时长和预算。" />
        <FlowStep step="02" title="进试音" desc="客服安排语音频道，先确认声音、沟通和打法节奏。" />
        <FlowStep step="03" title="充值下单" desc="充值人工审核到账后，用余额提交正式订单。" />
        <FlowStep step="04" title="后台派单" desc="管理员派单并通知陪玩，服务和投诉记录都可追踪。" />
      </section>

      <section className="mt-10">
        <div className="flex items-end justify-between gap-4">
          <SectionHeader title="推荐陪玩" desc="优先展示在线、资料完整、适合先试音的陪玩。" />
          <Link href="/companions" className="hidden text-sm font-semibold text-dfc-blue md:block">
            查看全部
          </Link>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {companions.length ? (
            companions.map((companion) => <CompanionCard key={companion.id} companion={toCardCompanion(companion)} />)
          ) : (
            <div className="maycat-card p-4 text-sm text-dfc-subtext md:col-span-3">暂无已上架陪玩。管理员审核上架后会显示在这里。</div>
          )}
        </div>
      </section>

      <section className="mt-10 grid gap-4 lg:grid-cols-2">
        <div className="maycat-card p-4">
          <h2 className="text-base font-semibold">我的最近订单</h2>
          <div className="mt-4 space-y-3">
            {profile.recentOrders.length ? (
              profile.recentOrders.map((order) => (
                <div key={order.id} className="flex items-center justify-between gap-3 border-b border-dfc-border pb-3 last:border-b-0 last:pb-0">
                  <div>
                    <div className="text-sm font-medium">{order.orderNo}</div>
                    <div className="mt-1 text-xs text-dfc-subtext">
                      {order.companionName} / {order.mode}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold">¥{formatMoney(order.totalAmount)}</div>
                    <div className="mt-1 text-xs text-dfc-blue">{order.status}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-dfc-control border border-cyan-300/20 bg-[#050711]/70 px-3 py-3 text-sm text-dfc-subtext">
                你还没有订单，可以先选择陪玩，或找客服在 KOOK / Discord 帮你匹配。
              </div>
            )}
          </div>
        </div>
        <div className="maycat-card p-4">
          <h2 className="text-base font-semibold">我的钱包流水</h2>
          <div className="mt-4 space-y-3">
            {profile.walletTransactions.length ? (
              profile.walletTransactions.map((transaction) => (
                <div key={transaction.id} className="flex items-center justify-between gap-3 border-b border-dfc-border pb-3 last:border-b-0 last:pb-0">
                  <div>
                    <div className="text-sm font-medium">{transaction.type}</div>
                    <div className="mt-1 text-xs text-dfc-subtext">余额：¥{formatMoney(transaction.balanceAfter)}</div>
                  </div>
                  <div className="text-sm font-semibold">
                    {transaction.direction === "CREDIT" ? "+" : "-"}¥{formatMoney(transaction.amount)}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-dfc-control border border-cyan-300/20 bg-[#050711]/70 px-3 py-3 text-sm text-dfc-subtext">
                暂无流水。充值审核通过、订单支付和退款都会显示在这里。
              </div>
            )}
          </div>
        </div>
      </section>
    </CustomerShell>
  );
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-dfc border border-cyan-300/20 bg-[#07111f]/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur">
      <div className="text-xs text-dfc-muted">{label}</div>
      <div className="mt-2 text-2xl font-black tabular-nums text-white">{value}</div>
    </div>
  );
}

function FlowStep({ step, title, desc }: { step: string; title: string; desc: string }) {
  return (
    <article className="maycat-card p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-black text-fuchsia-300">{step}</span>
        <span className="h-px flex-1 bg-cyan-300/20" />
      </div>
      <h2 className="mt-4 text-base font-black text-white">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-dfc-subtext">{desc}</p>
    </article>
  );
}

function formatMoney(value: string) {
  return Number(value).toFixed(2);
}

function toCardCompanion(companion: ApiCompanion) {
  return {
    id: companion.id,
    nickname: companion.nickname,
    avatarUrl: companion.avatarUrl,
    game: games.find((game) => game.code === companion.game)?.name ?? companion.game,
    rank: companion.deltaForceRank,
    modes: companion.skillModes.length ? companion.skillModes : ["平台派单"],
    price: Number(companion.pricePerHour),
    onlineStatus: companion.onlineStatus,
    voice: companion.voicePreference === "TEXT_ONLY" ? "仅文字" : "可语音",
    voiceStyle: companion.voicePreference === "TEXT_ONLY" ? "文字沟通" : "支持语音沟通",
    trial: companion.voicePreference === "TEXT_ONLY" ? "暂不支持试音" : "支持进语音频道试音",
    tags: companion.onlineStatus === "ONLINE" ? ["在线", "可下单"] : ["已上架"],
    intro: companion.bio || "该陪玩资料已通过后台上架，具体服务内容以下单沟通为准。",
    rating: "新陪玩",
    orders: 0,
    accent: companion.onlineStatus === "ONLINE" ? "gold" : "blue"
  };
}
