"use client";

import { useEffect, useState } from "react";
import { CompanionShell, SectionHeader } from "../components";

type CompanionMe = {
  user: {
    id: string;
    email: string;
    displayName: string;
  };
  companionProfile: {
    nickname: string;
    avatarUrl?: string | null;
    game: string;
    onlineStatus: string;
    status: string;
    pricePerHour: string;
  } | null;
};

export default function ProfilePage() {
  const [profile, setProfile] = useState<CompanionMe | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) return;

    void fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("无法加载资料");
        return (await response.json()) as CompanionMe;
      })
      .then(setProfile)
      .catch(() => setError("无法加载真实陪玩资料，请重新登录"));
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
        <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4 text-sm text-dfc-subtext">正在加载真实陪玩资料...</div>
      </CompanionShell>
    );
  }

  return (
    <CompanionShell>
      <SectionHeader title="我的资料" desc="当前显示数据库里的真实陪玩资料。OAuth 新注册陪玩默认待审核，管理员上架后客户才能看到。" />
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
          <Field label="游戏" value={profile.companionProfile?.game ?? "未设置"} />
          <Field label="资料状态" value={toProfileStatus(profile.companionProfile?.status)} />
          <Field label="在线状态" value={toOnlineStatus(profile.companionProfile?.onlineStatus)} />
          <Field label="每小时价格" value={`¥${Number(profile.companionProfile?.pricePerHour ?? "0").toFixed(2)}`} />
        </div>
      </section>
      <div className="mt-4 rounded-dfc-control border border-dfc-warning/40 bg-dfc-warning/10 px-3 py-2 text-sm text-dfc-warning">
        资料编辑审核流程还未开放。需要修改头像、游戏、价格或简介时，先联系管理员在后台更新。
      </div>
    </CompanionShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-dfc-control border border-dfc-border bg-dfc-bg p-3">
      <div className="text-xs text-dfc-muted">{label}</div>
      <div className="mt-1 text-sm font-semibold text-dfc-text">{value}</div>
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
