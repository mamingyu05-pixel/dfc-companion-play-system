"use client";

import { ChangeEvent, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { CompanionShell, SectionHeader, StatusBadge } from "../components";

type Platform = "DISCORD" | "KOOK";

type ExternalAccount = {
  platform: Platform;
  externalUserId: string;
  displayName?: string | null;
  createdAt: string;
};

type BindingCode = {
  platform: Platform;
  code: string;
  expiresAt: string;
  instruction: string;
};

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
    photoUrls?: string[];
    voiceIntroUrl?: string | null;
    game: string;
    games?: string[];
    onlineStatus: string;
    status: string;
    pricePerHour: string;
    kookPricePerHour?: string | null;
    discordPricePerHour?: string | null;
    payoutMethod?: string | null;
    payoutAccountName?: string | null;
    payoutAccountNo?: string | null;
    payoutQrCodeUrl?: string | null;
  } | null;
  externalAccounts?: ExternalAccount[];
};

type UploadPurpose = "avatar" | "photo" | "voice";
type OnlineStatusValue = "ONLINE" | "BUSY" | "OFFLINE";

const gameOptions = [
  ["DELTA_FORCE", "三角洲行动"],
  ["LEAGUE_OF_LEGENDS", "英雄联盟"],
  ["VALORANT", "无畏契约"],
  ["COUNTER_STRIKE_2", "CS2"],
  ["PUBG", "PUBG 绝地求生"],
  ["PUBG_MOBILE", "PUBG Mobile"],
  ["APEX_LEGENDS", "Apex 英雄"],
  ["NARAKA_BLADEPOINT", "永劫无间"],
  ["HONOR_OF_KINGS", "王者荣耀"],
  ["PEACEKEEPER_ELITE", "和平精英"],
  ["DOTA_2", "Dota 2"],
  ["OVERWATCH_2", "守望先锋 2"],
  ["RAINBOW_SIX_SIEGE", "彩虹六号：围攻"],
  ["ROCKET_LEAGUE", "火箭联盟"],
  ["EA_SPORTS_FC", "EA Sports FC"],
  ["STREET_FIGHTER_6", "街头霸王 6"],
  ["CALL_OF_DUTY", "使命召唤"],
  ["WILD_RIFT", "英雄联盟手游"],
  ["MOBILE_LEGENDS", "Mobile Legends"],
  ["MINECRAFT", "我的世界"],
  ["GENSHIN_IMPACT", "原神"],
  ["STEAM", "Steam 综合游戏"]
] as const;

const platformLabels: Record<Platform, string> = {
  DISCORD: "Discord",
  KOOK: "KOOK"
};

export default function ProfilePage() {
  const [profile, setProfile] = useState<CompanionMe | null>(null);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [voiceIntroUrl, setVoiceIntroUrl] = useState("");
  const [payoutAccountName, setPayoutAccountName] = useState("");
  const [payoutAccountNo, setPayoutAccountNo] = useState("");
  const [payoutQrCodeUrl, setPayoutQrCodeUrl] = useState("");
  const [onlineStatus, setOnlineStatus] = useState<OnlineStatusValue>("OFFLINE");
  const [selectedGames, setSelectedGames] = useState<string[]>(["DELTA_FORCE"]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [uploading, setUploading] = useState("");
  const [bindingCode, setBindingCode] = useState<BindingCode | null>(null);
  const [bindingLoading, setBindingLoading] = useState<Platform | null>(null);

  async function loadProfile() {
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) return;
    const response = await fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("无法加载资料");
    const data = (await response.json()) as CompanionMe;
    setProfile(data);
    setAvatarUrl(data.companionProfile?.avatarUrl ?? "");
    setPhotoUrls(data.companionProfile?.photoUrls ?? []);
    setVoiceIntroUrl(data.companionProfile?.voiceIntroUrl ?? "");
    setPayoutAccountName(data.companionProfile?.payoutAccountName ?? "");
    setPayoutAccountNo(data.companionProfile?.payoutAccountNo ?? "");
    setPayoutQrCodeUrl(data.companionProfile?.payoutQrCodeUrl ?? "");
    setOnlineStatus(toOnlineStatusValue(data.companionProfile?.onlineStatus));
    setSelectedGames(data.companionProfile ? getProfileGames(data.companionProfile) : ["DELTA_FORCE"]);
  }

  useEffect(() => {
    void loadProfile().catch(() => setError("无法加载真实陪玩资料，请重新登录"));
  }, []);

  async function requestBindingCode(platform: Platform) {
    setError("");
    setStatus("");
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) {
      window.location.href = "/companion/";
      return;
    }

    setBindingLoading(platform);
    try {
      const response = await fetch("/api/auth/platform-binding-code", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ platform })
      });
      const data = (await response.json().catch(() => ({}))) as BindingCode & { message?: string | string[] };
      if (!response.ok || !data.code) {
        const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
        throw new Error(toChineseError(message));
      }
      setBindingCode(data);
      setStatus(`${platformLabels[platform]} 绑定码已生成，10 分钟内有效。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成绑定码失败，请稍后再试");
    } finally {
      setBindingLoading(null);
    }
  }

  async function uploadMedia(file: File, purpose: UploadPurpose) {
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) throw new Error("请先登录陪玩端");
    const form = new FormData();
    form.append("purpose", purpose);
    form.append("file", file);
    setUploading(purpose);
    try {
      const response = await fetch("/api/uploads/companion-media", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
      const data = (await response.json().catch(() => ({}))) as { url?: string; message?: string | string[] };
      if (!response.ok || !data.url) {
        const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
        throw new Error(message ?? "上传失败");
      }
      return data.url;
    } finally {
      setUploading("");
    }
  }

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      setAvatarUrl(await uploadMedia(file, "avatar"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "头像上传失败");
    } finally {
      event.target.value = "";
    }
  }

  async function handlePhotosChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(0, Math.max(0, 9 - photoUrls.length));
    if (!files.length) return;
    setError("");
    try {
      const uploaded: string[] = [];
      for (const file of files) uploaded.push(await uploadMedia(file, "photo"));
      setPhotoUrls((current) => [...current, ...uploaded].slice(0, 9));
    } catch (err) {
      setError(err instanceof Error ? err.message : "照片上传失败");
    } finally {
      event.target.value = "";
    }
  }

  async function handleVoiceChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      setVoiceIntroUrl(await uploadMedia(file, "voice"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "语音上传失败");
    } finally {
      event.target.value = "";
    }
  }

  async function saveMedia() {
    setError("");
    setStatus("");
    const token = localStorage.getItem("dfc_companion_token");
    if (!token) {
      window.location.href = "/companion/";
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/auth/me/companion-media", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ avatarUrl: avatarUrl || null, photoUrls, voiceIntroUrl: voiceIntroUrl || null })
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
      if (!response.ok) {
        const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
        throw new Error(toChineseError(message));
      }
      setStatus("展示资料已保存，客户前台会使用最新照片和语音。");
      await loadProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败，请稍后重试");
    } finally {
      setIsSaving(false);
    }
  }

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
        const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
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

  async function updateOnlineStatus(nextStatus: OnlineStatusValue) {
    setError("");
    setStatus("");
    setOnlineStatus(nextStatus);

    const token = localStorage.getItem("dfc_companion_token");
    if (!token) {
      window.location.href = "/companion/";
      return;
    }

    try {
      const response = await fetch("/api/auth/me/companion-online-status", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ onlineStatus: nextStatus })
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
      if (!response.ok) {
        const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
        throw new Error(toChineseError(message));
      }
      setStatus(`在线状态已切换为：${toOnlineStatus(nextStatus)}`);
      await loadProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "在线状态保存失败，请稍后重试");
      setOnlineStatus(toOnlineStatusValue(profile?.companionProfile?.onlineStatus));
    }
  }

  async function saveGames() {
    setError("");
    setStatus("");

    const token = localStorage.getItem("dfc_companion_token");
    if (!token) {
      window.location.href = "/companion/";
      return;
    }

    const games = normalizeSelectedGames(selectedGames);
    if (!games.length) {
      setError("至少选择一个可接游戏");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/auth/me/companion-games", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ games })
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
      if (!response.ok) {
        const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
        throw new Error(toChineseError(message));
      }
      setStatus("可接游戏已保存，客户前台和派单筛选会按最新游戏能力匹配。");
      await loadProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存可接游戏失败，请稍后重试");
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
        <div className="companion-card p-4 text-sm text-dfc-subtext">正在加载真实陪玩资料...</div>
      </CompanionShell>
    );
  }

  return (
    <CompanionShell>
      <SectionHeader eyebrow="Profile Center" title="我的资料" desc="这里维护客户能看到的展示资料。价格、上架和审核仍由后台管理，避免私自改价影响订单。" />

      {error ? <div className="mt-4 rounded-dfc-control border border-dfc-danger/40 bg-dfc-danger/10 px-3 py-2 text-sm text-dfc-danger">{error}</div> : null}
      {status ? <div className="mt-4 rounded-dfc-control border border-dfc-success/40 bg-dfc-success/10 px-3 py-2 text-sm text-dfc-success">{status}</div> : null}

      <section className="companion-card mt-6 grid gap-4 p-4 md:grid-cols-[160px_1fr]">
        <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-dfc border border-cyan-300/20 bg-[#101827] text-3xl font-black text-cyan-200">
          <SafeMediaImage src={avatarUrl} alt="陪玩头像" className="h-full w-full object-cover" fallbackText={profile.user.displayName.slice(0, 1)} />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-black text-white">{profile.companionProfile?.nickname ?? profile.user.displayName}</h2>
            <StatusBadge tone={profile.companionProfile?.status === "LISTED" ? "success" : profile.companionProfile?.status === "BANNED" ? "danger" : "warning"}>
              {toProfileStatus(profile.companionProfile?.status)}
            </StatusBadge>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Field label="KOOK 单价" value={profile.companionProfile?.kookPricePerHour ? `¥${Number(profile.companionProfile.kookPricePerHour).toFixed(2)}/h` : "沿用默认价"} />
            <Field label="Discord 单价" value={profile.companionProfile?.discordPricePerHour ? `¥${Number(profile.companionProfile.discordPricePerHour).toFixed(2)}/h` : "沿用默认价"} />
            <Field label="账号" value={formatAccountEmail(profile.user.email)} />
            <Field label="我的邀请码" value={profile.user.referralCode ?? "未生成"} />
            <Field label="可接游戏" value={gameNames(selectedGames)} />
            <OnlineStatusControl value={onlineStatus} onChange={(value) => void updateOnlineStatus(value)} />
            <Field label="每小时价格" value={`¥${Number(profile.companionProfile?.pricePerHour ?? "0").toFixed(2)}`} />
          </div>
        </div>
      </section>

      <section className="companion-card mt-6 p-4">
        <h2 className="text-base font-black text-white">平台绑定</h2>
        <p className="mt-1 text-sm leading-6 text-dfc-subtext">
          绑定 Discord / KOOK 后，频道里的接单、报名、客服记录和后台账号会关联到同一个陪玩身份。
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <PlatformBindingCard
            platform="DISCORD"
            account={profile.externalAccounts?.find((account) => account.platform === "DISCORD")}
            loading={bindingLoading === "DISCORD"}
            onRequest={() => void requestBindingCode("DISCORD")}
          />
          <PlatformBindingCard
            platform="KOOK"
            account={profile.externalAccounts?.find((account) => account.platform === "KOOK")}
            loading={bindingLoading === "KOOK"}
            onRequest={() => void requestBindingCode("KOOK")}
          />
        </div>
        {bindingCode ? (
          <div className="mt-4 rounded-dfc border border-cyan-300/30 bg-cyan-300/10 p-4">
            <div className="text-xs text-dfc-muted">{platformLabels[bindingCode.platform]} 绑定码</div>
            <div className="mt-2 select-all break-all font-mono text-3xl font-black tracking-[0.18em] text-cyan-100">{bindingCode.code}</div>
            <div className="mt-3 rounded-dfc-control border border-dfc-border bg-[#050711]/80 px-3 py-2 text-sm text-dfc-text">
              在 {platformLabels[bindingCode.platform]} 私聊客服机器人，或在客服接待频道发送：
              <span className="ml-1 font-mono text-cyan-200">绑定 {bindingCode.code}</span>
            </div>
            <div className="mt-2 text-xs text-dfc-subtext">10 分钟内有效。过期后重新生成即可。</div>
          </div>
        ) : null}
      </section>

      <section className="companion-card mt-6 p-4">
        <h2 className="text-base font-black text-white">可接游戏</h2>
        <p className="mt-1 text-sm leading-6 text-dfc-subtext">可以选择多个游戏。第一个会作为主展示游戏，客户下单和 KOOK / Discord 派单都会按这里匹配。</p>
        <GameMultiSelect selectedGames={selectedGames} onChange={setSelectedGames} />
        <button type="button" disabled={isSaving} onClick={() => void saveGames()} className="mt-5 rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-200 disabled:opacity-60">
          {isSaving ? "保存中..." : "保存可接游戏"}
        </button>
      </section>

      <section className="companion-card mt-6 p-4">
        <h2 className="text-base font-black text-white">展示资料</h2>
        <p className="mt-1 text-sm leading-6 text-dfc-subtext">头像、照片和语音会影响客户点击率。请不要上传联系方式、二维码或违规内容。</p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <UploadBox label="头像" hint="用于陪玩列表和详情页" accept="image/*" uploading={uploading === "avatar"} onChange={handleAvatarChange}>
            {avatarUrl ? <SafeMediaImage src={avatarUrl} alt="头像预览" className="h-24 w-24 rounded-dfc object-cover" fallbackText="头像预览" /> : null}
          </UploadBox>
          <UploadBox label="展示照片" hint="最多 9 张，点击缩略图可删除" accept="image/*" multiple uploading={uploading === "photo"} onChange={handlePhotosChange}>
            <div className="grid grid-cols-3 gap-2">
              {photoUrls.map((url) => (
                <button key={url} type="button" onClick={() => setPhotoUrls((current) => current.filter((item) => item !== url))} className="overflow-hidden rounded-dfc-control border border-cyan-300/20">
                  <SafeMediaImage src={url} alt="展示照片" className="h-16 w-full object-cover" fallbackText="照片" />
                </button>
              ))}
            </div>
          </UploadBox>
          <UploadBox label="语音介绍" hint="建议 10-30 秒，客户可试听" accept="audio/*" uploading={uploading === "voice"} onChange={handleVoiceChange}>
            {voiceIntroUrl ? <audio controls src={voiceIntroUrl} className="mt-2 w-full" /> : null}
          </UploadBox>
        </div>
        <button type="button" disabled={isSaving} onClick={() => void saveMedia()} className="mt-5 rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-200 disabled:opacity-60">
          {isSaving ? "保存中..." : "保存展示资料"}
        </button>
      </section>

      <form onSubmit={savePayout} className="companion-card mt-6 p-4">
        <h2 className="text-base font-black text-white">支付宝收款资料</h2>
        <p className="mt-1 text-sm text-dfc-subtext">用于以后人工提现打款。请填写真实姓名和支付宝账号，管理员打款时会看到这份资料。</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-xs font-black text-dfc-muted">支付宝姓名</span>
            <input required value={payoutAccountName} onChange={(event) => setPayoutAccountName(event.target.value)} className="input" placeholder="与支付宝实名一致" />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-black text-dfc-muted">支付宝账号</span>
            <input required value={payoutAccountNo} onChange={(event) => setPayoutAccountNo(event.target.value)} className="input" placeholder="手机号或邮箱" />
          </label>
        </div>
        <label className="mt-4 block">
          <span className="mb-2 block text-xs font-black text-dfc-muted">收款码图片地址（可选）</span>
          <input value={payoutQrCodeUrl} onChange={(event) => setPayoutQrCodeUrl(event.target.value)} className="input" placeholder="后续可接入上传二维码" />
        </label>
        <button disabled={isSaving} className="mt-5 rounded-dfc-control border border-cyan-300/60 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-200 disabled:opacity-60">
          {isSaving ? "保存中..." : "保存收款资料"}
        </button>
      </form>
    </CompanionShell>
  );
}

function PlatformBindingCard({
  platform,
  account,
  loading,
  onRequest
}: {
  platform: Platform;
  account?: ExternalAccount;
  loading: boolean;
  onRequest: () => void;
}) {
  return (
    <div className="rounded-dfc border border-cyan-300/15 bg-[#050711]/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-black text-white">{platformLabels[platform]}</div>
          <div className="mt-1 text-xs text-dfc-subtext">
            {account ? account.displayName || account.externalUserId : "未绑定"}
          </div>
        </div>
        <span className={`rounded-dfc-control px-2 py-1 text-xs font-black ${account ? "bg-dfc-success/10 text-dfc-success" : "bg-dfc-warning/10 text-dfc-warning"}`}>
          {account ? "已绑定" : "未绑定"}
        </span>
      </div>
      <button
        type="button"
        disabled={loading}
        onClick={onRequest}
        className="mt-4 w-full rounded-dfc-control border border-cyan-300/50 px-3 py-2 text-sm font-black text-cyan-200 transition hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "生成中..." : `生成 ${platformLabels[platform]} 绑定码`}
      </button>
    </div>
  );
}

function SafeMediaImage({ src, alt, className, fallbackText }: { src: string; alt: string; className: string; fallbackText: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div className={`${className} flex items-center justify-center border border-cyan-300/20 bg-[#101827] px-2 text-center text-sm font-black text-cyan-200`}>
        {fallbackText}
      </div>
    );
  }

  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-dfc-control border border-cyan-300/15 bg-[#050711]/60 p-3">
      <div className="text-xs text-dfc-muted">{label}</div>
      <div className="mt-1 break-all text-sm font-black text-white">{value}</div>
    </div>
  );
}

function OnlineStatusControl({ value, onChange }: { value: OnlineStatusValue; onChange: (value: OnlineStatusValue) => void }) {
  return (
    <label className="rounded-dfc-control border border-cyan-300/15 bg-[#050711]/60 p-3">
      <span className="block text-xs text-dfc-muted">在线状态</span>
      <select value={value} onChange={(event) => onChange(event.target.value as OnlineStatusValue)} className="mt-2 w-full rounded-dfc-control border border-cyan-300/25 bg-[#080d18] px-3 py-2 text-sm font-black text-white outline-none transition focus:border-cyan-300">
        <option value="ONLINE">在线，可接单</option>
        <option value="BUSY">忙碌，需沟通</option>
        <option value="OFFLINE">离线，暂不接</option>
      </select>
    </label>
  );
}

function GameMultiSelect({ selectedGames, onChange }: { selectedGames: string[]; onChange: (games: string[]) => void }) {
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {gameOptions.map(([code, name]) => {
        const checked = selectedGames.includes(code);
        return (
          <label key={code} className={`rounded-dfc-control border px-3 py-2 text-sm transition ${checked ? "border-cyan-300/60 bg-cyan-300/10 text-white" : "border-cyan-300/15 bg-[#07111f] text-dfc-subtext"}`}>
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => {
                const next = event.target.checked ? [...selectedGames, code] : selectedGames.filter((item) => item !== code);
                onChange(normalizeSelectedGames(next));
              }}
              className="mr-2 accent-cyan-300"
            />
            {name}
          </label>
        );
      })}
    </div>
  );
}

function UploadBox({ label, hint, accept, multiple, uploading, onChange, children }: { label: string; hint: string; accept: string; multiple?: boolean; uploading: boolean; onChange: (event: ChangeEvent<HTMLInputElement>) => void; children?: ReactNode }) {
  return (
    <label className="block rounded-dfc border border-cyan-300/15 bg-[#050711]/50 p-3">
      <span className="block text-xs font-black text-dfc-muted">{label}</span>
      <span className="mt-1 block text-xs leading-5 text-dfc-subtext">{hint}</span>
      <input type="file" accept={accept} multiple={multiple} onChange={onChange} className="mt-3 block w-full text-xs text-dfc-subtext file:mr-3 file:rounded-dfc-control file:border-0 file:bg-cyan-300 file:px-3 file:py-2 file:text-xs file:font-black file:text-slate-950" />
      {uploading ? <div className="mt-2 text-xs text-cyan-300">上传中...</div> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </label>
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

function toOnlineStatusValue(status?: string): OnlineStatusValue {
  if (status === "ONLINE" || status === "BUSY" || status === "OFFLINE") return status;
  return "OFFLINE";
}

function gameName(code: string) {
  return gameOptions.find(([value]) => value === code)?.[1] ?? (code || "未设置");
}

function gameNames(codes: string[]) {
  return codes.length ? codes.map(gameName).join(" / ") : "未设置";
}

function normalizeSelectedGames(values: string[]) {
  const validGames = new Set(gameOptions.map(([code]) => code));
  return Array.from(new Set(values.filter((value) => validGames.has(value as (typeof gameOptions)[number][0]))));
}

function getProfileGames(profile: NonNullable<CompanionMe["companionProfile"]>) {
  const games = profile.games?.length ? profile.games : [profile.game];
  return normalizeSelectedGames(games);
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
