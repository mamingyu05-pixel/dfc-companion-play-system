import Link from "next/link";
import type { ReactNode } from "react";
import { CustomerAuthGate } from "./auth-gate";
import { MaycatLogo } from "./brand";

type Companion = {
  id: string;
  nickname: string;
  avatarUrl?: string | null;
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
  return (
    <main className="min-h-screen bg-dfc-bg text-dfc-text">
      <header className="sticky top-0 z-20 border-b border-dfc-border bg-dfc-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-6">
          <Link href="/home" className="flex items-center gap-3">
            <MaycatLogo compact />
            <span className="hidden sm:block">
              <span className="block text-sm font-semibold">May猫饼电竞</span>
              <span className="block text-xs text-dfc-muted">多游戏陪玩俱乐部</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-2 md:flex">
            <NavLink href="/home">客户中心</NavLink>
            <NavLink href="/home">大厅</NavLink>
            <NavLink href="/companions">陪玩</NavLink>
            <NavLink href="/order">下单</NavLink>
            <NavLink href="/recharge">充值</NavLink>
            <NavLink href="/complaints">投诉</NavLink>
            <NavLink href="/support">客服</NavLink>
          </nav>
          <Link href="/recharge" className="rounded-dfc-control border border-dfc-border bg-dfc-surface px-3 py-2 text-xs font-semibold text-dfc-text">
            钱包
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 pb-24 pt-6 md:px-6 md:pb-10">
        <CustomerAuthGate>{children}</CustomerAuthGate>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-dfc-border bg-dfc-bg md:hidden">
        <MobileNavLink href="/recharge">充值</MobileNavLink>
        <MobileNavLink href="/home">大厅</MobileNavLink>
        <MobileNavLink href="/companions">陪玩</MobileNavLink>
        <MobileNavLink href="/order">下单</MobileNavLink>
        <MobileNavLink href="/support">客服</MobileNavLink>
      </nav>
    </main>
  );
}

export function SectionHeader({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-normal md:text-3xl">{title}</h1>
      {desc ? <p className="max-w-2xl text-sm leading-6 text-dfc-subtext">{desc}</p> : null}
    </div>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
      <div className="text-xs text-dfc-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-dfc-subtext">{hint}</div>
    </div>
  );
}

export function CompanionCard({ companion }: { companion: Companion }) {
  const isRecommended = companion.accent === "gold";

  return (
    <article className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
      <div className="flex items-start gap-3">
        <CompanionAvatar nickname={companion.nickname} avatarUrl={companion.avatarUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold">{companion.nickname}</h2>
            {isRecommended ? <Badge tone="gold">推荐</Badge> : null}
            <StatusBadge status={companion.onlineStatus} />
          </div>
          <p className="mt-1 text-xs text-dfc-subtext">
            {companion.game ? `${companion.game} / ` : ""}{companion.rank} / {companion.voice}
          </p>
        </div>
      </div>

      <p className="mt-4 min-h-11 text-sm leading-6 text-dfc-subtext">{companion.intro}</p>

      <div className="mt-4 rounded-dfc-control border border-dfc-blue/30 bg-dfc-blue/10 p-3">
        <div className="text-xs font-semibold text-dfc-blue">语音展示</div>
        <div className="mt-1 text-sm text-dfc-subtext">{companion.voiceStyle}</div>
        <div className="mt-1 text-xs text-dfc-muted">{companion.trial}</div>
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
          <div className="text-xl font-semibold text-dfc-blue">¥{companion.price}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Link href={`/companions/${companion.id}`} className="rounded-dfc-control border border-dfc-border px-3 py-2 text-center text-sm font-semibold text-dfc-text">
          详情
        </Link>
        <Link href={`/order?companion=${companion.id}&trial=1`} className="rounded-dfc-control border border-dfc-blue/50 px-3 py-2 text-center text-sm font-semibold text-dfc-blue">
          试音
        </Link>
        <Link href={`/order?companion=${companion.id}`} className="rounded-dfc-control bg-dfc-blue px-3 py-2 text-center text-sm font-semibold text-slate-950">
          下单
        </Link>
      </div>
    </article>
  );
}

export function CompanionAvatar({ nickname, avatarUrl, size = "md" }: { nickname: string; avatarUrl?: string | null; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "lg" ? "h-28 w-28 text-3xl" : size === "sm" ? "h-14 w-14 text-lg" : "h-20 w-20 text-2xl";
  return (
    <div className={`${sizeClass} overflow-hidden rounded-dfc border border-dfc-border bg-dfc-elevated`}>
      {avatarUrl ? (
        <img src={avatarUrl} alt={`${nickname} 头像`} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center font-black text-dfc-blue">
          {nickname.slice(0, 1)}
        </div>
      )}
    </div>
  );
}

export function PriceSummary() {
  return (
    <aside className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
      <h2 className="text-base font-semibold">价格确认</h2>
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
      : "border-dfc-border bg-dfc-elevated text-dfc-subtext";

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
    <Link href={href} className="rounded-dfc-control px-3 py-2 text-sm font-medium text-dfc-subtext hover:bg-dfc-surface hover:text-dfc-text">
      {children}
    </Link>
  );
}

function MobileNavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="py-3 text-center text-xs font-medium text-dfc-subtext">
      {children}
    </Link>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-dfc-subtext">{label}</span>
      <span className={strong ? "text-lg font-semibold text-dfc-blue" : "font-medium text-dfc-text"}>{value}</span>
    </div>
  );
}
