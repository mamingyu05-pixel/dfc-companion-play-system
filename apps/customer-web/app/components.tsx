"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { CustomerAuthGate } from "./auth-gate";
import { MaycatLogo } from "./brand";

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
};

export function CustomerShell({ children }: { children: ReactNode }) {
  const kookUrl = process.env.NEXT_PUBLIC_SUPPORT_KOOK_URL || "https://kook.vip/i0o2qA";
  const discordUrl = process.env.NEXT_PUBLIC_SUPPORT_DISCORD_URL || "https://discord.gg/dX5prAZMPu";

  return (
    <main className="maycat-neon-bg min-h-screen text-dfc-text">
      <div className="maycat-grid" />
      <div className="maycat-light-streaks" />

      <header className="maycat-nav sticky top-0 z-20">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-6">
          <Link href="/home" className="flex items-center gap-3">
            <MaycatLogo compact />
            <span className="hidden sm:block">
              <span className="maycat-text-glow block text-sm font-black text-white">May猫饼电竞</span>
              <span className="block text-xs text-cyan-300">多游戏陪玩俱乐部</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            <NavLink href="/home">客户中心</NavLink>
            <NavLink href="/home">大厅</NavLink>
            <NavLink href="/companions">陪玩</NavLink>
            <NavLink href="/order">下单</NavLink>
            <NavLink href="/recharge">充值</NavLink>
            <NavLink href="/complaints">投诉</NavLink>
            <NavLink href="/support">客服</NavLink>
            <NavLink href="/settings">设置</NavLink>
            <ExternalNavLink href={kookUrl}>KOOK</ExternalNavLink>
            <ExternalNavLink href={discordUrl}>Discord</ExternalNavLink>
          </nav>
          <Link href="/recharge" className="maycat-button-secondary px-3 py-2 text-xs font-semibold">
            钱包
          </Link>
        </div>
      </header>

      <div className="relative mx-auto max-w-6xl px-4 pb-24 pt-6 md:px-6 md:pb-10">
        <CustomerAuthGate>{children}</CustomerAuthGate>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-8 border-t border-cyan-300/15 bg-[#050711]/90 backdrop-blur-xl md:hidden">
        <MobileNavLink href="/recharge">充值</MobileNavLink>
        <MobileNavLink href="/home">大厅</MobileNavLink>
        <MobileNavLink href="/companions">陪玩</MobileNavLink>
        <MobileNavLink href="/order">下单</MobileNavLink>
        <MobileNavLink href="/support">客服</MobileNavLink>
        <MobileNavLink href="/settings">设置</MobileNavLink>
        <MobileExternalNavLink href={kookUrl}>KOOK</MobileExternalNavLink>
        <MobileExternalNavLink href={discordUrl}>DC</MobileExternalNavLink>
      </nav>
    </main>
  );
}

export function SectionHeader({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="maycat-text-glow text-2xl font-black tracking-normal text-white md:text-3xl">{title}</h1>
      {desc ? <p className="max-w-2xl text-sm leading-6 text-dfc-subtext">{desc}</p> : null}
    </div>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="maycat-card p-4">
      <div className="text-xs text-dfc-muted">{label}</div>
      <div className="mt-2 text-2xl font-black text-white">{value}</div>
      <div className="mt-1 text-xs text-dfc-subtext">{hint}</div>
    </div>
  );
}

export function CompanionCard({ companion }: { companion: Companion }) {
  const isRecommended = companion.accent === "gold";

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
        {companion.voiceIntroUrl ? <audio controls src={companion.voiceIntroUrl} className="mt-3 w-full" /> : null}
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
          <div className="text-xs text-dfc-muted">评分 / 成单</div>
          <div className="mt-1 text-sm text-dfc-subtext">
            {companion.rating} / {companion.orders} 单
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
        <Link href={`/order?companion=${companion.id}&trial=1`} className="maycat-button-secondary px-3 py-2 text-center text-sm font-semibold">
          试音
        </Link>
        <Link href={`/order?companion=${companion.id}`} className="maycat-button px-3 py-2 text-center text-sm font-black">
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

  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}

export function PriceSummary() {
  return (
    <aside className="maycat-card p-4">
      <h2 className="text-base font-black text-white">价格确认</h2>
      <div className="mt-4 space-y-3 text-sm">
        <Line label="陪玩单价" value="¥68 / 小时" />
        <Line label="选择时长" value="2 小时" />
        <Line label="订单总价" value="¥136.00" strong />
        <Line label="当前余额" value="¥164.00" />
        <Line label="下单后余额" value="¥28.00" />
      </div>
      <div className="mt-4 rounded-dfc-control border border-dfc-success/40 bg-dfc-success/10 px-3 py-2 text-xs text-dfc-success">
        最终金额以后端计算为准。
      </div>
    </aside>
  );
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

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="rounded-dfc-control px-3 py-2 text-sm font-semibold text-dfc-subtext transition hover:bg-cyan-300/10 hover:text-cyan-200">
      {children}
    </Link>
  );
}

function ExternalNavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="rounded-dfc-control border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-sm font-black text-cyan-100 transition hover:border-cyan-300/60 hover:bg-cyan-300/20">
      {children}
    </a>
  );
}

function MobileNavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="py-3 text-center text-xs font-semibold text-dfc-subtext transition hover:text-cyan-200">
      {children}
    </Link>
  );
}

function MobileExternalNavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="py-3 text-center text-xs font-black text-cyan-200 transition hover:text-white">
      {children}
    </a>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-dfc-subtext">{label}</span>
      <span className={strong ? "text-lg font-black text-cyan-300" : "font-medium text-dfc-text"}>{value}</span>
    </div>
  );
}
