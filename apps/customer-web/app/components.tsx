import Link from "next/link";
import type { ReactNode } from "react";
import { CustomerAuthGate } from "./auth-gate";

type Companion = {
  id: string;
  nickname: string;
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
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-dfc border border-dfc-blue bg-dfc-surface text-sm font-black text-dfc-blue shadow-dfc-glow">
              DFC
            </span>
            <span>
              <span className="block text-sm font-semibold">Delta Force Club</span>
              <span className="block text-xs text-dfc-muted">Companion Play</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-2 md:flex">
            <NavLink href="/">Register/Login</NavLink>
            <NavLink href="/home">Lobby</NavLink>
            <NavLink href="/companions">Companions</NavLink>
            <NavLink href="/order">Order</NavLink>
            <NavLink href="/recharge">Recharge</NavLink>
            <NavLink href="/complaints">Complaints</NavLink>
            <NavLink href="/support">Support</NavLink>
          </nav>
          <Link href="/recharge" className="rounded-dfc-control border border-dfc-border bg-dfc-surface px-3 py-2 text-xs font-semibold text-dfc-text">
            Wallet
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 pb-24 pt-6 md:px-6 md:pb-10">
        <CustomerAuthGate>{children}</CustomerAuthGate>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-dfc-border bg-dfc-bg md:hidden">
        <MobileNavLink href="/">Login</MobileNavLink>
        <MobileNavLink href="/home">Lobby</MobileNavLink>
        <MobileNavLink href="/companions">Players</MobileNavLink>
        <MobileNavLink href="/order">Order</MobileNavLink>
        <MobileNavLink href="/support">Support</MobileNavLink>
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
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-dfc bg-dfc-elevated text-lg font-black text-dfc-blue">
          {companion.nickname.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold">{companion.nickname}</h2>
            {isRecommended ? <Badge tone="gold">Recommended</Badge> : null}
            <StatusBadge status={companion.onlineStatus} />
          </div>
          <p className="mt-1 text-xs text-dfc-subtext">
            {companion.rank} / {companion.voice}
          </p>
        </div>
      </div>

      <p className="mt-4 min-h-11 text-sm leading-6 text-dfc-subtext">{companion.intro}</p>

      <div className="mt-4 rounded-dfc-control border border-dfc-blue/30 bg-dfc-blue/10 p-3">
        <div className="text-xs font-semibold text-dfc-blue">Voice preview</div>
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
          <div className="text-xs text-dfc-muted">Rating / Orders</div>
          <div className="mt-1 text-sm text-dfc-subtext">
            {companion.rating} / {companion.orders}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-dfc-muted">Per hour</div>
          <div className="text-xl font-semibold text-dfc-blue">¥{companion.price}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Link href={`/companions/${companion.id}`} className="rounded-dfc-control border border-dfc-border px-3 py-2 text-center text-sm font-semibold text-dfc-text">
          Details
        </Link>
        <Link href={`/order?companion=${companion.id}&trial=1`} className="rounded-dfc-control border border-dfc-blue/50 px-3 py-2 text-center text-sm font-semibold text-dfc-blue">
          Trial
        </Link>
        <Link href={`/order?companion=${companion.id}`} className="rounded-dfc-control bg-dfc-blue px-3 py-2 text-center text-sm font-semibold text-slate-950">
          Order
        </Link>
      </div>
    </article>
  );
}

export function PriceSummary() {
  return (
    <aside className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
      <h2 className="text-base font-semibold">Price summary</h2>
      <div className="mt-4 space-y-3 text-sm">
        <Line label="Unit price" value="¥68 / hour" />
        <Line label="Duration" value="2 hours" />
        <Line label="Total" value="¥136.00" strong />
        <Line label="Balance" value="¥164.00" />
        <Line label="After order" value="¥28.00" />
      </div>
      <div className="mt-4 rounded-dfc-control border border-dfc-success/40 bg-dfc-success/10 px-3 py-2 text-xs text-dfc-success">
        Backend will calculate the final payable amount.
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
  const isOnline = status === "ONLINE" || status === "online";
  return (
    <span className={`rounded-dfc-control px-2 py-1 text-xs ${isOnline ? "bg-dfc-success/10 text-dfc-success" : "bg-dfc-warning/10 text-dfc-warning"}`}>
      {status}
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
