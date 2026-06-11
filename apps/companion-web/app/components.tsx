import Link from "next/link";
import type { ReactNode } from "react";

export function CompanionShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-dfc-bg text-dfc-text">
      <header className="sticky top-0 z-20 border-b border-dfc-border bg-dfc-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-6">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-dfc border border-dfc-violet bg-dfc-surface text-sm font-black text-dfc-violet">
              DFC
            </span>
            <span>
              <span className="block text-sm font-semibold">陪玩工作台</span>
              <span className="block text-xs text-dfc-muted">接单 · 订单 · 收益</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-2 md:flex">
            <NavLink href="/">工作台</NavLink>
            <NavLink href="/available-orders">可接订单</NavLink>
            <NavLink href="/orders">我的订单</NavLink>
            <NavLink href="/earnings">收益</NavLink>
            <NavLink href="/withdrawals">提现</NavLink>
            <NavLink href="/profile">资料</NavLink>
          </nav>
          <span className="rounded-dfc-control bg-dfc-success/10 px-3 py-2 text-xs font-semibold text-dfc-success">在线</span>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 pb-24 pt-6 md:px-6 md:pb-10">{children}</div>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-dfc-border bg-dfc-bg md:hidden">
        <MobileNavLink href="/">工作台</MobileNavLink>
        <MobileNavLink href="/available-orders">接单</MobileNavLink>
        <MobileNavLink href="/orders">订单</MobileNavLink>
        <MobileNavLink href="/earnings">收益</MobileNavLink>
      </nav>
    </main>
  );
}

export function SectionHeader({ title, desc }: { title: string; desc?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold md:text-3xl">{title}</h1>
      {desc ? <p className="mt-1 max-w-2xl text-sm leading-6 text-dfc-subtext">{desc}</p> : null}
    </div>
  );
}

export function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
      <div className="text-xs text-dfc-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-dfc-subtext">{hint}</div>
    </div>
  );
}

export function OrderCard({ order, action }: { order: { id: string; mode: string; hours: number; amount: number; status: string }; action?: string }) {
  return (
    <article className="rounded-dfc border border-dfc-border bg-dfc-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{order.id}</h2>
          <p className="mt-1 text-sm text-dfc-subtext">{order.mode} · {order.hours} 小时</p>
        </div>
        <StatusBadge>{order.status}</StatusBadge>
      </div>
      <div className="mt-4 flex items-end justify-between">
        <div>
          <div className="text-xs text-dfc-muted">订单金额</div>
          <div className="mt-1 text-xl font-semibold text-dfc-blue">¥{order.amount}</div>
        </div>
        {action ? <button className="rounded-dfc-control bg-dfc-blue px-4 py-2 text-sm font-semibold text-slate-950">{action}</button> : null}
      </div>
    </article>
  );
}

export function StatusBadge({ children }: { children: ReactNode }) {
  return <span className="rounded-dfc-control bg-dfc-violet/10 px-2 py-1 text-xs text-dfc-violet">{children}</span>;
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="rounded-dfc-control px-3 py-2 text-sm text-dfc-subtext hover:bg-dfc-surface hover:text-dfc-text">{children}</Link>;
}

function MobileNavLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="py-3 text-center text-xs font-medium text-dfc-subtext">{children}</Link>;
}
