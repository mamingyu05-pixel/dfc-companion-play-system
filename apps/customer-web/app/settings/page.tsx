"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { CustomerShell, SectionHeader, StatCard } from "../components";

type ExternalAccount = {
  platform: "DISCORD" | "KOOK";
  externalUserId: string;
  displayName?: string | null;
  createdAt: string;
};

type CustomerSettingsProfile = {
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
  customerMembership?: {
    level: number;
    name: string;
    totalApprovedRecharge: string;
    minRecharge: string;
    nextMinRecharge: string | null;
    benefits: string[];
    hasCompletedOrder: boolean;
  } | null;
  externalAccounts?: ExternalAccount[];
};

type PublicConfig = {
  support?: {
    discordUrl?: string | null;
    kookUrl?: string | null;
    wechatId?: string | null;
    wechatQrUrl?: string | null;
  };
};

const platformLabels: Record<ExternalAccount["platform"], string> = {
  DISCORD: "Discord",
  KOOK: "KOOK"
};

export default function CustomerSettingsPage() {
  const [profile, setProfile] = useState<CustomerSettingsProfile | null>(null);
  const [publicConfig, setPublicConfig] = useState<PublicConfig>({});
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

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
        if (!response.ok) throw new Error("Unauthorized");
        return (await response.json()) as CustomerSettingsProfile;
      })
      .then(setProfile)
      .catch(() => {
        localStorage.removeItem("dfc_customer_token");
        localStorage.removeItem("dfc_customer_user");
        window.location.href = "/customer/";
      });
  }, []);

  useEffect(() => {
    void fetch("/api/auth/public-config")
      .then(async (response) => {
        if (!response.ok) return {};
        return (await response.json()) as PublicConfig;
      })
      .then(setPublicConfig)
      .catch(() => setPublicConfig({}));
  }, []);

  const accounts = useMemo(() => profile?.externalAccounts ?? [], [profile?.externalAccounts]);
  const discordAccount = accounts.find((account) => account.platform === "DISCORD");
  const kookAccount = accounts.find((account) => account.platform === "KOOK");

  async function copyReferralCode() {
    const code = profile?.user.referralCode;
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("复制失败，请手动选中邀请码复制");
    }
  }

  function logout() {
    localStorage.removeItem("dfc_customer_token");
    localStorage.removeItem("dfc_customer_user");
    window.location.href = "/customer/";
  }

  return (
    <CustomerShell>
      <SectionHeader
        title="个人设置"
        desc="查看你的账号资料、邀请码、平台绑定、钱包状态和人工客服入口。这里不会显示后台密码或任何敏感 Token。"
      />

      {error ? <div className="mt-4 rounded-dfc-control border border-dfc-danger/40 bg-dfc-danger/10 px-3 py-2 text-sm text-dfc-danger">{error}</div> : null}

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <StatCard label="当前账号" value={profile?.user.displayName ?? "加载中"} hint={formatAccountEmail(profile?.user.email)} />
        <StatCard label="可用余额" value={`¥${formatMoney(profile?.wallet?.availableBalance ?? "0")}`} hint="充值审核通过后增加" />
        <StatCard
          label="会员等级"
          value={profile?.customerMembership?.name ?? "新人"}
          hint={`累计充值 ¥${formatMoney(profile?.customerMembership?.totalApprovedRecharge ?? "0")}`}
        />
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Panel title="账号资料">
          <InfoLine label="昵称" value={profile?.user.displayName ?? "-"} />
          <InfoLine label="邮箱" value={formatAccountEmail(profile?.user.email)} />
          <InfoLine label="角色" value={roleName(profile?.user.role)} />
          <InfoLine label="会员等级" value={profile?.customerMembership?.name ?? "新人"} />
          <InfoLine label="累计充值" value={`¥${formatMoney(profile?.customerMembership?.totalApprovedRecharge ?? "0")}`} />
          <InfoLine label="首单状态" value={profile?.customerMembership?.hasCompletedOrder ? "已完成首单" : "未完成首单"} />
          <InfoLine label="下一级门槛" value={profile?.customerMembership?.nextMinRecharge ? `¥${formatMoney(profile.customerMembership.nextMinRecharge)}` : "已满级"} />
          <InfoLine label="当前权益" value={profile?.customerMembership?.benefits?.join(" / ") || "人工客服引导"} />
          <InfoLine label="客户 ID" value={profile?.user.id ?? "-"} mono />
          <div className="mt-4 rounded-dfc-control border border-dfc-border bg-dfc-bg p-3 text-xs leading-5 text-dfc-subtext">
            会员等级按累计审核通过充值金额自动计算，绑定 KOOK 后会同步到 KOOK 右侧成员列表。昵称、邮箱或平台账号异常时，联系人工客服处理。
          </div>
        </Panel>

        <Panel title="我的邀请码">
          <div className="rounded-dfc border border-cyan-300/30 bg-cyan-300/10 p-4">
            <div className="text-xs text-dfc-muted">邀请好友注册时填写</div>
            <div className="mt-2 break-all text-2xl font-black text-cyan-200">{profile?.user.referralCode || "生成中"}</div>
            <button
              type="button"
              onClick={copyReferralCode}
              disabled={!profile?.user.referralCode}
              className="mt-4 rounded-dfc-control bg-dfc-blue px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
            >
              {copied ? "已复制" : "复制邀请码"}
            </button>
          </div>
          <div className="mt-3 text-xs leading-5 text-dfc-subtext">
            老带新奖励、首充赠送和优惠码规则以后台活动配置为准，不由客服口头承诺。
          </div>
        </Panel>

        <Panel title="平台绑定">
          <PlatformAccount account={kookAccount} platform="KOOK" />
          <PlatformAccount account={discordAccount} platform="DISCORD" />
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <a href="/api/auth/oauth/kook/start?portal=customer" className="maycat-button-secondary px-3 py-3 text-center text-sm font-semibold">
              绑定 KOOK
            </a>
            <a href="/api/auth/oauth/discord/start?portal=customer" className="maycat-button-secondary px-3 py-3 text-center text-sm font-semibold">
              绑定 Discord
            </a>
          </div>
          <div className="mt-3 rounded-dfc-control border border-dfc-warning/30 bg-dfc-warning/10 px-3 py-2 text-xs text-dfc-warning">
            平台绑定只用于识别 KOOK/DC 内的订单、派单和客服记录，不会自动扣款。
          </div>
        </Panel>

        <Panel title="客服与账号安全">
          <div className="rounded-dfc-control border border-dfc-border bg-dfc-bg p-3 text-sm text-dfc-subtext">
            <div>
              VX 客服：<span className="font-semibold text-dfc-blue">{publicConfig.support?.wechatId || "暂未配置"}</span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <SupportLink href={publicConfig.support?.kookUrl ?? undefined} label="KOOK 客服" />
              <SupportLink href={publicConfig.support?.discordUrl ?? undefined} label="Discord 客服" />
            </div>
            {publicConfig.support?.wechatQrUrl ? (
              <img
                src={publicConfig.support.wechatQrUrl}
                alt="VX 客服二维码"
                className="mt-3 h-32 w-32 rounded-dfc-control border border-dfc-border bg-white object-cover p-2"
              />
            ) : null}
          </div>
          <div className="mt-3 rounded-dfc-control border border-dfc-danger/30 bg-dfc-danger/10 px-3 py-2 text-xs leading-5 text-dfc-danger">
            不要把密码、邮箱验证码、后台 Token、API Key 发给任何人。充值只提交截图审核，不做自动支付。
          </div>
        </Panel>
      </section>

      <section className="mt-6 rounded-dfc border border-dfc-border bg-dfc-surface p-4">
        <h2 className="text-base font-black text-white">账号操作</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/recharge" className="maycat-button px-4 py-3 text-sm font-black">
            余额充值
          </Link>
          <Link href="/support" className="maycat-button-secondary px-4 py-3 text-sm font-semibold">
            联系客服
          </Link>
          <button type="button" onClick={logout} className="rounded-dfc-control border border-dfc-danger/50 px-4 py-3 text-sm font-semibold text-dfc-danger">
            退出登录
          </button>
        </div>
      </section>
    </CustomerShell>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
      <h2 className="text-base font-black text-white">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function InfoLine({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-dfc-border/70 py-3 text-sm last:border-b-0">
      <span className="shrink-0 text-dfc-muted">{label}</span>
      <span className={`break-all text-right text-dfc-text ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}

function PlatformAccount({ account, platform }: { account?: ExternalAccount; platform: ExternalAccount["platform"] }) {
  return (
    <div className="mb-3 rounded-dfc-control border border-dfc-border bg-dfc-bg p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-dfc-text">{platformLabels[platform]}</div>
          <div className="mt-1 text-xs text-dfc-muted">{account ? account.displayName || account.externalUserId : "暂未绑定"}</div>
        </div>
        <span className={`rounded-dfc-control px-2 py-1 text-xs ${account ? "bg-dfc-success/10 text-dfc-success" : "bg-dfc-warning/10 text-dfc-warning"}`}>
          {account ? "已绑定" : "未绑定"}
        </span>
      </div>
    </div>
  );
}

function SupportLink({ href, label }: { href?: string; label: string }) {
  if (!href) {
    return <span className="rounded-dfc-control border border-dfc-border px-3 py-2 text-center text-xs text-dfc-muted">{label}未配置</span>;
  }

  return (
    <a href={href} target="_blank" rel="noreferrer" className="rounded-dfc-control bg-dfc-blue px-3 py-2 text-center text-xs font-semibold text-slate-950">
      {label}
    </a>
  );
}

function formatAccountEmail(email?: string) {
  if (!email) return "-";
  return email.endsWith("@oauth.maycatplay.local") ? "第三方账号注册" : email;
}

function formatMoney(value: string) {
  return Number(value).toFixed(2);
}

function roleName(role?: string) {
  if (role === "CUSTOMER") return "客户";
  if (role === "COMPANION") return "陪玩";
  if (role === "ADMIN") return "管理员";
  if (role === "SUPER_ADMIN") return "超级管理员";
  return role || "-";
}
