"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CustomerAuthGate } from "./auth-gate";
import { CountUp, PageTransition } from "./motion";

type Companion = {
  id: string;
  nickname: string;
  avatarUrl?: string | null;
  photoUrls?: string[];
  voiceIntroUrl?: string | null;
  game?: string;
  rank: string;
  modes: string[];
  price: number;
  onlineStatus: string;
  voice: string;
  voiceStyle: string;
  trial: string;
  tags: string[];
  intro: string;
  rating: string;
  orders: number;
  accent: string;
  trialHref?: string;
  trialPlatform?: "DISCORD" | "KOOK" | null;
};

export function CustomerShell({ children }: { children: ReactNode }) {
  // The server owns the community links, so changing them never needs a rebuild; build-time values are only a fallback.
  const [links, setLinks] = useState({
    kook: process.env.NEXT_PUBLIC_SUPPORT_KOOK_URL?.trim() || "",
    discord: process.env.NEXT_PUBLIC_SUPPORT_DISCORD_URL?.trim() || ""
  });
  useEffect(() => {
    let live = true;
    fetch("/api/auth/public-config")
      .then(response => (response.ok ? response.json() : null))
      .then((config: { support?: { kookUrl?: string | null; discordUrl?: string | null } } | null) => {
        if (!live || !config?.support) return;
        setLinks(current => ({ kook: config.support?.kookUrl?.trim() || current.kook, discord: config.support?.discordUrl?.trim() || current.discord }));
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  const kookUrl = links.kook;
  const discordUrl = links.discord;

  return (
    <main className="maycat-neon-bg min-h-screen text-dfc-text">
      <header className="dfc-topbar">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 md:px-6">
          <Link href="/home" className="dfc-brand">
            <img src="/customer/icon.svg" alt="" />
            <span className="hidden sm:block"><b>小小电竞</b><small>三角洲行动 · 陪玩与护航</small></span>
          </Link>
          <nav className="hidden items-center gap-0.5 md:flex" aria-label="客户端导航">
            {TABS.map(tab => <NavLink key={tab.href} href={tab.href}>{tab.label}</NavLink>)}
          </nav>
          <div className="flex items-center gap-2">
            {kookUrl ? (
              <a href={kookUrl} target="_blank" rel="noreferrer" className="dfc-pill hidden lg:inline-flex"><span className="dfc-live" aria-hidden="true" />KOOK</a>
            ) : null}
            {discordUrl ? <a href={discordUrl} target="_blank" rel="noreferrer" className="dfc-pill hidden lg:inline-flex">Discord</a> : null}
            <a href="/companion/" className="dfc-pill">陪玩入口</a>
            <Link href="/recharge" className="dfc-pill dfc-pill-strong">钱包</Link>
          </div>
        </div>
      </header>

      <div className="relative mx-auto max-w-6xl px-4 pb-28 pt-6 md:px-6 md:pb-12">
        <CustomerAuthGate><PageTransition>{children}</PageTransition></CustomerAuthGate>
      </div>

      <nav className="dfc-tabbar grid grid-cols-5 md:hidden" aria-label="移动端导航">
        {TABS.map(tab => <MobileNavLink key={tab.href} href={tab.href} icon={tab.icon}>{tab.label}</MobileNavLink>)}
      </nav>
    </main>
  );
}

export function SectionHeader({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="dfc-title">
      <h1>{title}</h1>
      {desc ? <p>{desc}</p> : null}
    </div>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="maycat-card p-4">
      <div className="text-xs font-semibold text-dfc-muted">{label}</div>
      <div className="mt-2 text-2xl font-black tabular-nums text-white"><CountUp value={value} /></div>
      <div className="mt-1 text-xs text-dfc-subtext">{hint}</div>
    </div>
  );
}

export function CompanionCard({ companion }: { companion: Companion }) {
  const isRecommended = companion.accent === "gold";
  const trialHref = companion.trialHref || "/support";
  const trialIsExternal = /^https?:\/\//.test(trialHref);

  return (
    <article className="maycat-card group p-4 transition duration-200 hover:-translate-y-0.5">
      <div className="flex items-start gap-3">
        <CompanionAvatar nickname={companion.nickname} avatarUrl={companion.avatarUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-black text-white">{companion.nickname}</h2>
            {isRecommended ? <Badge tone="gold">推荐</Badge> : null}
            <StatusBadge status={companion.onlineStatus} />
          </div>
          <p className="mt-1 text-xs text-dfc-subtext">
            {companion.game ? `${companion.game} / ` : ""}
            {companion.rank} / {companion.voice}
          </p>
        </div>
      </div>

      <p className="mt-4 min-h-11 text-sm leading-6 text-dfc-subtext">{companion.intro}</p>

      {companion.photoUrls?.length ? (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {companion.photoUrls.slice(0, 3).map((url) => (
            <div key={url} className="h-20 overflow-hidden rounded-dfc-control border border-cyan-300/20 bg-[#050711]">
              <SafeMediaImage src={url} alt={`${companion.nickname} 展示照片`} className="h-full w-full object-cover" fallbackText="展示图" />
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 rounded-dfc-control border border-cyan-300/30 bg-cyan-300/10 p-3">
        <div className="text-xs font-semibold text-cyan-300">语音展示</div>
        <div className="mt-1 text-sm text-dfc-subtext">{companion.voiceStyle}</div>
        <div className="mt-1 text-xs text-dfc-muted">{companion.trial}</div>
        {companion.voiceIntroUrl ? <audio controls src={mediaUrl(companion.voiceIntroUrl)} className="mt-3 w-full" /> : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {companion.modes.map((mode) => (
          <Badge key={mode}>{mode}</Badge>
        ))}
        {companion.tags.slice(0, 2).map((tag) => (
          <Badge key={tag}>{tag}</Badge>
        ))}
      </div>

      <div className="mt-5 flex items-end justify-between gap-3">
        <div>
          <div className="text-xs text-dfc-muted">评分 / 评价条数</div>
          <div className="mt-1 text-sm text-dfc-subtext">
            {companion.orders ? `${companion.rating} / ${companion.orders}条评价` : "暂无评价"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-dfc-muted">每小时</div>
          <div className="text-xl font-black text-cyan-300">¥{companion.price}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Link href={`/companions/${companion.id}`} className="maycat-button-secondary px-3 py-2 text-center text-sm font-semibold">
          详情
        </Link>
        <Link href={trialHref} target={trialIsExternal ? "_blank" : undefined} rel={trialIsExternal ? "noreferrer" : undefined} className="maycat-button-secondary px-3 py-2 text-center text-sm font-semibold">
          {trialIsExternal ? "试音" : "联系客服安排试音"}
        </Link>
        <Link href={`/order?companionId=${encodeURIComponent(companion.id)}`} className="maycat-button px-3 py-2 text-center text-sm font-black">
          下单
        </Link>
      </div>
    </article>
  );
}

export function CompanionAvatar({ nickname, avatarUrl, size = "md" }: { nickname: string; avatarUrl?: string | null; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "lg" ? "h-28 w-28 text-3xl" : size === "sm" ? "h-14 w-14 text-lg" : "h-20 w-20 text-2xl";
  return (
    <div className={`${sizeClass} overflow-hidden rounded-dfc border border-cyan-300/30 bg-[#07111f] shadow-[0_0_26px_rgba(34,211,238,0.10)]`}>
      <SafeMediaImage src={avatarUrl} alt={`${nickname} 头像`} className="h-full w-full object-cover" fallbackText={nickname.slice(0, 1)} />
    </div>
  );
}

export function mediaUrl(src?: string | null): string | undefined {
  if (!src) return undefined;
  return src.startsWith("/uploads/") ? `/api${src}` : src;
}

export function SafeMediaImage({ src, alt, className, fallbackText }: { src?: string | null; alt: string; className: string; fallbackText: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(34,211,238,0.32),transparent_36%),radial-gradient(circle_at_80%_80%,rgba(236,72,153,0.26),transparent_42%)] px-2 text-center font-black text-cyan-300">
        {fallbackText}
      </div>
    );
  }

  return <img src={mediaUrl(src)} alt={alt} className={className} onError={() => setFailed(true)} />;
}

export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "gold" }) {
  const className =
    tone === "gold"
      ? "border-dfc-gold/50 bg-dfc-gold/10 text-dfc-gold"
      : "border-cyan-300/20 bg-cyan-300/10 text-cyan-100";

  return <span className={`rounded-dfc-control border px-2 py-1 text-xs ${className}`}>{children}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const isOnline = status === "ONLINE" || status === "在线";
  return (
    <span className={`rounded-dfc-control px-2 py-1 text-xs ${isOnline ? "bg-dfc-success/10 text-dfc-success" : "bg-dfc-warning/10 text-dfc-warning"}`}>
      {status === "ONLINE" ? "在线" : status === "BUSY" ? "忙碌" : status === "OFFLINE" ? "离线" : status}
    </span>
  );
}

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

const TABS = [
  { href: "/home", label: "首页", icon: icon("M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z") },
  { href: "/companions", label: "陪玩", icon: icon("M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8") },
  { href: "/recharge", label: "充值", icon: icon("M3 7h15a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l2.5-3h11L18 7M16.5 14h.01") },
  { href: "/support", label: "客服", icon: icon("M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5.1A8 8 0 1 1 21 12M8.5 12h.01M12 12h.01M15.5 12h.01") },
  { href: "/settings", label: "设置", icon: icon("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1") }
];

function useIsActive(href: string) {
  const pathname = usePathname();
  return !!pathname && (pathname === href || pathname === `${href}/` || pathname.startsWith(`${href}/`));
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const active = useIsActive(href);
  return <Link href={href} aria-current={active ? "page" : undefined} className="dfc-navlink">{children}</Link>;
}

function MobileNavLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  const active = useIsActive(href);
  return <Link href={href} aria-current={active ? "page" : undefined} className="dfc-tab">{icon}{children}</Link>;
}
