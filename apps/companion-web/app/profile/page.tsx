"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { CompanionShell, SectionHeader } from "../components";

type CompanionMe = {
  user: {
    id: string;
    email: string;
    displayName: string;
    referralCode?: string | null;
  };
  companionProfile: {
    nickname: string;
    avatarUrl?: string | null;
    game: string;
    onlineStatus: string;
    status: string;
    pricePerHour: string;
    payoutMethod?: string | null;
    payoutAccountName?: string | null;
    payoutAccountNo?: string | null;
    payoutQrCodeUrl?: string | null;
  } | null;
};

export default function ProfilePage() {
  const [profile, setProfile] = useState<CompanionMe | null>(null);
  const [payoutAccountName, setPayoutAccountName] = useState("");
  const [payoutAccountNo, setPayoutAccountNo] = useState("");
  const [payoutQrCodeUrl, setPayoutQrCodeUrl] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function loadProfile() {
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) return;
    const response = await fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("无法加载资料");
    const data = (await response.json()) as CompanionMe;
    setProfile(data);
    setPayoutAccountName(data.companionProfile?.payoutAccountName ?? "");
    setPayoutAccountNo(data.companionProfile?.payoutAccountNo ?? "");
    setPayoutQrCodeUrl(data.companionProfile?.payoutQrCodeUrl ?? "");
  }

  useEffect(() => {
    void loadProfile().catch(() => setError("无法加载真实陪玩资料，请重新登录"));
  }, []);

  async function savePayout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("");

    const token = localStorage.getItem("dfc_companion_token");
    if (!token) {
      window.location.href = "/companion/";
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/wallet/companion-payout-profile", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          payoutMethod: "ALIPAY",
          payoutAccountName,
          payoutAccountNo,
          payoutQrCodeUrl: payoutQrCodeUrl || undefined
        })
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
      if (!response.ok) {
        const message = Array.isArray(data.message) ? data.message.join("，") : data.message;
        throw new Error(toChineseError(message));
      }
      setStatus("支付宝收款资料已保存，后续提现会自动带出。");
      await loadProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败，请稍后重试");
    } finally {
      setIsSaving(false);
    }
  }

  if (error && !profile) {
    return (
      <CompanionShell>
        <div className="rounded-dfc border border-dfc-danger/40 bg-dfc-danger/10 p-4 text-sm text-dfc-danger">{error}</div>
      </CompanionShell>
    );
  }

  if (!profile) {
    return (
      <CompanionShell>
        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4 text-sm text-dfc-subtext">正在加载真实陪玩资料...</div>
      </CompanionShell>
    );
  }

  return (
    <CompanionShell>
      <SectionHeader
        title="我的资料"
        desc="这里显示数据库里的真实陪玩资料。入驻、头像、价格和上架状态由客服考核后在后台维护。"
      />

      <section className="mt-6 grid gap-4 rounded-dfc border border-dfc-border bg-dfc-surface p-4 md:grid-cols-[160px_1fr]">
        <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-dfc border border-dfc-border bg-dfc-elevated text-3xl font-black text-dfc-blue">
          {profile.companionProfile?.avatarUrl ? (
            <img src={profile.companionProfile.avatarUrl} alt="陪玩头像" className="h-full w-full object-cover" />
          ) : (
            profile.user.displayName.slice(0, 1)
          )}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="昵称" value={profile.companionProfile?.nickname ?? profile.user.displayName} />
          <Field label="账号" value={formatAccountEmail(profile.user.email)} />
          <Field label="我的推荐码" value={profile.user.referralCode ?? "未生成"} />
          <Field label="游戏" value={profile.companionProfile?.game ?? "未设置"} />
          <Field label="资料状态" value={toProfileStatus(profile.companionProfile?.status)} />
          <Field label="在线状态" value={toOnlineStatus(profile.companionProfile?.onlineStatus)} />
          <Field label="每小时价格" value={`¥${Number(profile.companionProfile?.pricePerHour ?? "0").toFixed(2)}`} />
        </div>
      </section>

      <form onSubmit={savePayout} className="mt-6 rounded-dfc border border-dfc-border bg-dfc-surface p-4">
        <h2 className="text-base font-semibold">支付宝收款资料</h2>
        <p className="mt-1 text-sm text-dfc-subtext">用于以后人工提现打款。请填写真实姓名和支付宝账号，管理员打款时会看到这份资料。</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm text-dfc-subtext">支付宝姓名</span>
            <input
              required
              value={payoutAccountName}
              onChange={(event) => setPayoutAccountName(event.target.value)}
              className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
              placeholder="与支付宝实名一致"
            />
          </label>
          <label className="block">
            <span className="text-sm text-dfc-subtext">支付宝账号</span>
            <input
              required
              value={payoutAccountNo}
              onChange={(event) => setPayoutAccountNo(event.target.value)}
              className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
              placeholder="手机号或邮箱"
            />
          </label>
        </div>
        <label className="mt-4 block">
          <span className="text-sm text-dfc-subtext">收款码图片地址（选填）</span>
          <input
            value={payoutQrCodeUrl}
            onChange={(event) => setPayoutQrCodeUrl(event.target.value)}
            className="mt-2 w-full rounded-dfc-control border border-dfc-border bg-dfc-bg px-3 py-3 text-sm outline-none focus:shadow-dfc-focus"
            placeholder="以后接入上传后可自动填入"
          />
        </label>
        {error ? <div className="mt-4 rounded-dfc-control border border-dfc-danger/40 bg-dfc-danger/10 px-3 py-2 text-sm text-dfc-danger">{error}</div> : null}
        {status ? <div className="mt-4 rounded-dfc-control border border-dfc-success/40 bg-dfc-success/10 px-3 py-2 text-sm text-dfc-success">{status}</div> : null}
        <button disabled={isSaving} className="mt-5 rounded-dfc-control bg-dfc-blue px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-60">
          {isSaving ? "保存中..." : "保存收款资料"}
        </button>
      </form>
    </CompanionShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-dfc-control border border-dfc-border bg-dfc-bg p-3">
      <div className="text-xs text-dfc-muted">{label}</div>
      <div className="mt-1 break-all text-sm font-semibold text-dfc-text">{value}</div>
    </div>
  );
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

function toChineseError(message?: string) {
  if (!message) return "保存失败，请检查填写内容";
  if (message.includes("payoutAccountName and payoutAccountNo are required")) return "请填写支付宝姓名和账号";
  if (message.includes("Companion profile does not exist")) return "陪玩资料不存在，请联系管理员";
  return message;
}
