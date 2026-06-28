"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Badge, CompanionAvatar, CustomerShell, SafeMediaImage, mediaUrl } from "../../components";
import { games } from "../../data";

type ApiCompanion = {
  id: string;
  nickname: string;
  avatarUrl?: string | null;
  photoUrls?: string[];
  voiceIntroUrl?: string | null;
  game: string;
  games?: string[];
  onlineStatus: string;
  deltaForceRank: string;
  skillModes: string[];
  pricePerHour: string;
  voicePreference: string;
  bio?: string | null;
  externalAccounts?: ExternalAccount[];
};

type ExternalAccount = {
  platform: "DISCORD" | "KOOK";
  externalUserId: string;
  displayName?: string | null;
};

type PublicConfig = {
  support?: {
    discordUrl?: string | null;
    kookUrl?: string | null;
    voiceTrialDiscordUrl?: string | null;
    voiceTrialKookUrl?: string | null;
  };
};

export default function CompanionDetailPage() {
  const params = useParams<{ id: string }>();
  const [companion, setCompanion] = useState<ApiCompanion | null>(null);
  const [publicConfig, setPublicConfig] = useState<PublicConfig>({});
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/orders/public/companions")
      .then(async (response) => {
        if (!response.ok) throw new Error("无法加载陪玩资料");
        const companions = (await response.json()) as ApiCompanion[];
        const matched = companions.find((item) => item.id === params.id);
        if (!matched) throw new Error("陪玩未上架或不存在");
        setCompanion(matched);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "无法加载陪玩资料"));
  }, [params.id]);

  useEffect(() => {
    void fetch("/api/auth/public-config")
      .then(async (response) => {
        if (!response.ok) return {};
        return (await response.json()) as PublicConfig;
      })
      .then(setPublicConfig)
      .catch(() => setPublicConfig({}));
  }, []);

  if (error) {
    return (
      <CustomerShell>
        <div className="maycat-card border-dfc-danger/40 bg-dfc-danger/10 p-4 text-sm text-dfc-danger">
          <div>{error}</div>
          <Link href="/companions" className="maycat-button-secondary mt-4 inline-block px-4 py-2 text-sm font-black text-dfc-text">
            返回陪玩大厅
          </Link>
        </div>
      </CustomerShell>
    );
  }

  if (!companion) {
    return (
      <CustomerShell>
        <CompanionDetailSkeleton />
      </CustomerShell>
    );
  }

  const isOnline = companion.onlineStatus === "ONLINE";
  const canVoice = companion.voicePreference !== "TEXT_ONLY";
  const companionGames = getCompanionGames(companion);
  const trialHref = companionTrialHref(companion, publicConfig);
  const trialIsExternal = /^https?:\/\//.test(trialHref);

  return (
    <CustomerShell>
      <section className="maycat-profile-hero overflow-hidden rounded-dfc border border-cyan-300/20 p-4 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <Link href="/companions" className="text-sm font-semibold text-cyan-300 hover:text-cyan-100">
              返回陪玩大厅
            </Link>
            <div className="maycat-chip mt-5 px-3 py-1 text-xs font-black uppercase tracking-[0.18em]">Companion Profile</div>
            <h1 className="maycat-text-glow mt-5 max-w-3xl text-4xl font-black leading-tight text-white md:text-6xl">
              {companion.nickname}
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-dfc-subtext md:text-base">
              {companion.bio || "该陪玩资料来自后台真实上架信息。你可以先试音确认沟通体验，再到群里按格式发单。"}
            </p>
            {companion.voiceIntroUrl ? (
              <div className="mt-5 max-w-xl rounded-dfc-control border border-cyan-300/25 bg-[#050711]/70 p-3">
                <div className="mb-2 text-xs font-black text-cyan-300">语音介绍</div>
                <audio controls src={mediaUrl(companion.voiceIntroUrl)} className="w-full" />
              </div>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-2">
              <Badge tone={isOnline ? "gold" : "default"}>{toOnlineStatus(companion.onlineStatus)}</Badge>
              {companionGames.slice(0, 4).map((code) => (
                <Badge key={code}>{gameName(code)}</Badge>
              ))}
              <Badge>{companion.deltaForceRank}</Badge>
              <Badge>{toVoice(companion.voicePreference)}</Badge>
              {companion.skillModes.map((mode) => (
                <Badge key={mode}>{mode}</Badge>
              ))}
            </div>
          </div>

          <aside className="maycat-profile-card p-4">
            <div className="flex items-start gap-4">
              <CompanionAvatar nickname={companion.nickname} avatarUrl={companion.avatarUrl} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-dfc-muted">每小时</div>
                <div className="mt-1 text-3xl font-black tabular-nums text-cyan-300">¥{Number(companion.pricePerHour).toFixed(2)}</div>
                <div className="mt-2 text-sm text-dfc-subtext">{toOnlineStatus(companion.onlineStatus)} · {toVoice(companion.voicePreference)}</div>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <DetailMetric label="可接游戏" value={gameNames(companionGames)} />
              <DetailMetric label="段位" value={companion.deltaForceRank} />
              <DetailMetric label="语音" value={canVoice ? "支持" : "文字"} />
              <DetailMetric label="状态" value={toOnlineStatus(companion.onlineStatus)} />
            </div>
            <Link href="/order" className="maycat-button mt-5 block px-4 py-3 text-center text-sm font-black">
              查看群下单方式
            </Link>
            <Link
              href={trialHref}
              target={trialIsExternal ? "_blank" : undefined}
              rel={trialIsExternal ? "noreferrer" : undefined}
              className="maycat-button-secondary mt-3 block px-4 py-3 text-center text-sm font-black"
            >
              申请试音
            </Link>
          </aside>
        </div>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {companion.photoUrls?.length ? (
            <section className="maycat-card p-4">
              <h2 className="text-lg font-black text-white">展示照片</h2>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {companion.photoUrls.slice(0, 9).map((url) => (
                  <div key={url} className="aspect-square overflow-hidden rounded-dfc border border-cyan-300/20 bg-[#050711]">
                    <SafeMediaImage src={url} alt={`${companion.nickname} 展示照片`} className="h-full w-full object-cover" fallbackText="展示图" />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="maycat-card p-4">
            <h2 className="text-lg font-black text-white">服务特点</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {(companion.skillModes.length ? companion.skillModes : ["平台审核", "可派单", "资料真实"]).map((tag) => (
                <div key={tag} className="rounded-dfc-control border border-cyan-300/20 bg-[#07111f]/70 p-3 text-sm font-semibold text-cyan-50/80">
                  {tag}
                </div>
              ))}
            </div>
          </section>

          <section className="maycat-card p-4">
            <h2 className="text-lg font-black text-white">适合你吗</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <TrustPoint title="先试音再决定" desc={canVoice ? "可申请进入临时语音频道，确认声音、沟通和节奏。" : "该陪玩偏文字沟通，群内发单前请把需求写清楚。"} />
              <TrustPoint title="后台真实上架" desc="只有管理员审核上架后的陪玩会出现在客户列表。" />
              <TrustPoint title="客服后台扣费" desc="前端只展示资料和单价，最终金额由客服确认后从钱包余额扣费。" />
              <TrustPoint title="异常可找客服" desc="接单前后如需改时间、沟通异常，可走客服处理。" />
            </div>
          </section>
        </div>

        <aside className="maycat-price-console p-4 lg:sticky lg:top-24 lg:self-start">
          <h2 className="text-base font-black text-white">群下单说明</h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-dfc-subtext">
            <RuleLine text="选择试音时，管理员可创建临时 Discord/KOOK 语音房。" />
            <RuleLine text="试音只确认沟通体验，不代表订单开始或收益结算。" />
            <RuleLine text="客户在群内发单后，客服会按余额、预算和陪玩状态确认派单。" />
            <RuleLine text="订单金额由客服后台确认并从钱包余额扣费。" />
          </div>
          <div className={`mt-4 rounded-dfc-control border px-3 py-2 text-xs leading-5 ${isOnline ? "border-dfc-success/40 bg-dfc-success/10 text-dfc-success" : "border-dfc-warning/40 bg-dfc-warning/10 text-dfc-warning"}`}>
            {isOnline ? "当前显示在线，适合优先试音或群内发单。" : "当前不是在线状态，群内发单后可能需要管理员协调时间。"}
          </div>
        </aside>
      </section>
    </CustomerShell>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-dfc-control border border-cyan-300/20 bg-[#050711]/70 p-3">
      <div className="text-xs text-dfc-muted">{label}</div>
      <div className="mt-1 truncate text-sm font-black text-white">{value}</div>
    </div>
  );
}

function TrustPoint({ title, desc }: { title: string; desc: string }) {
  return (
    <article className="rounded-dfc-control border border-cyan-300/20 bg-[#07111f]/70 p-3">
      <h3 className="text-sm font-black text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-dfc-subtext">{desc}</p>
    </article>
  );
}

function RuleLine({ text }: { text: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300" />
      <span>{text}</span>
    </div>
  );
}

function CompanionDetailSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="maycat-card min-h-96 animate-pulse p-6">
        <div className="h-4 w-32 rounded bg-cyan-300/10" />
        <div className="mt-6 h-12 max-w-md rounded bg-cyan-300/10" />
        <div className="mt-4 h-4 max-w-xl rounded bg-cyan-300/10" />
        <div className="mt-3 h-4 max-w-lg rounded bg-cyan-300/10" />
      </div>
      <div className="maycat-card min-h-96 animate-pulse p-4">
        <div className="h-28 w-28 rounded-dfc bg-cyan-300/10" />
        <div className="mt-5 h-10 w-32 rounded bg-cyan-300/10" />
        <div className="mt-5 h-12 rounded-dfc-control bg-cyan-300/10" />
      </div>
    </div>
  );
}

function companionTrialPlatform(companion: ApiCompanion): "DISCORD" | "KOOK" | null {
  const platforms = companion.externalAccounts?.map((account) => account.platform) ?? [];
  if (platforms.includes("DISCORD")) return "DISCORD";
  if (platforms.includes("KOOK")) return "KOOK";
  return null;
}

function companionTrialHref(companion: ApiCompanion, publicConfig: PublicConfig) {
  const platform = companionTrialPlatform(companion);
  if (platform === "DISCORD") return publicConfig.support?.voiceTrialDiscordUrl || publicConfig.support?.discordUrl || "https://discord.gg/dX5prAZMPu";
  if (platform === "KOOK") return publicConfig.support?.voiceTrialKookUrl || publicConfig.support?.kookUrl || "https://kook.vip/i0o2qA";
  return "/support";
}

function gameName(code: string) {
  return games.find((game) => game.code === code)?.name ?? code;
}

function gameNames(codes: string[]) {
  return codes.map(gameName).join(" / ");
}

function getCompanionGames(companion: ApiCompanion) {
  return companion.games?.length ? companion.games : [companion.game];
}

function toOnlineStatus(value: string) {
  if (value === "ONLINE") return "在线";
  if (value === "BUSY") return "忙碌";
  if (value === "OFFLINE") return "离线";
  return value;
}

function toVoice(value: string) {
  if (value === "REQUIRED") return "必须语音";
  if (value === "TEXT_ONLY") return "仅文字";
  return "可语音";
}
