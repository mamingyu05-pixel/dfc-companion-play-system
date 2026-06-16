import Link from "next/link";
import type { ReactNode } from "react";
import { CompanionAuthGate } from "./auth-gate";

const navItems = [
  ["工作台", "/dashboard"],
  ["可接订单", "/available-orders"],
  ["我的订单", "/orders"],
  ["????", "/customer-drafts"],
  ["收益", "/earnings"],
  ["提现", "/withdrawals"],
  ["资料", "/profile"]
] as const;

export function CompanionShell({ children }: { children: ReactNode }) {
  return (
    <main className="companion-console-bg min-h-screen overflow-x-hidden text-dfc-text">
      <header className="sticky top-0 z-20 border-b border-cyan-300/15 bg-[#060913]/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-6">
          <Link href="/dashboard" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-dfc border border-fuchsia-300/35 bg-fuchsia-400/10 text-xs font-black text-fuchsia-100">
              MAY
            </span>
            <span>
              <span className="block text-sm font-black text-white">May猫饼陪玩端</span>
              <span className="block text-xs text-dfc-muted">接单 / 服务 / 收益 / 提现</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-2 md:flex" aria-label="陪玩端导航">
            {navItems.map(([label, href]) => (
              <NavLink key={href} href={href}>{label}</NavLink>
            ))}
          </nav>
          <span className="rounded-dfc-control border border-dfc-success/40 bg-dfc-success/10 px-3 py-2 text-xs font-black text-dfc-success">
            在线
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 pb-24 pt-6 md:px-6 md:pb-10">
        <CompanionAuthGate>{children}</CompanionAuthGate>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-cyan-300/15 bg-[#060913]/95 backdrop-blur-xl md:hidden" aria-label="移动端陪玩导航">
        <MobileNavLink href="/dashboard">工作台</MobileNavLink>
        <MobileNavLink href="/available-orders">接单</MobileNavLink>
        <MobileNavLink href="/orders">订单</MobileNavLink>
        <MobileNavLink href="/earnings">收益</MobileNavLink>
      </nav>
    </main>
  );
}

export function SectionHeader({ title, desc, eyebrow }: { title: string; desc?: string; eyebrow?: string }) {
  return (
    <div>
      {eyebrow ? <div className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-200">{eyebrow}</div> : null}
      <h1 className="mt-1 text-2xl font-black tracking-normal text-white md:text-3xl">{title}</h1>
      {desc ? <p className="mt-2 max-w-2xl text-sm leading-6 text-dfc-subtext">{desc}</p> : null}
    </div>
  );
}

export function MetricCard({ label, value, hint, tone = "cyan" }: { label: string; value: string; hint: string; tone?: "cyan" | "gold" | "green" | "danger" }) {
  const toneClass = {
    cyan: "text-cyan-100",
    gold: "text-dfc-gold",
    green: "text-dfc-success",
    danger: "text-dfc-danger"
  }[tone];

  return (
    <div className="companion-card p-4">
      <div className="text-xs font-semibold text-dfc-muted">{label}</div>
      <div className={`mt-2 text-2xl font-black tabular-nums ${toneClass}`}>{value}</div>
      <div className="mt-1 text-xs leading-5 text-dfc-subtext">{hint}</div>
    </div>
  );
}

export function OrderCard({
  order,
  action,
  onAction
}: {
  order: { id: string; mode: string; hours: number; amount: number; status: string; customer?: string };
  action?: string;
  onAction?: () => void;
}) {
  return (
    <article className="companion-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-black text-white">{order.id}</h2>
          <p className="mt-1 text-sm leading-6 text-dfc-subtext">{order.mode} / {order.hours} 小时</p>
          {order.customer ? <p className="mt-1 text-xs text-dfc-muted">{order.customer}</p> : null}
        </div>
        <StatusBadge tone={statusTone(order.status)}>{toOrderStatus(order.status)}</StatusBadge>
      </div>
      <div className="mt-5 flex items-end justify-between gap-3">
        <div>
          <div className="text-xs text-dfc-muted">订单金额</div>
          <div className="mt-1 text-2xl font-black tabular-nums text-dfc-gold">¥{order.amount.toFixed(2)}</div>
        </div>
        {action ? <ActionButton onClick={onAction}>{action}</ActionButton> : null}
      </div>
    </article>
  );
}

export function StatusBadge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "warning" | "danger" | "success" }) {
  const styles = {
    default: "border-cyan-300/30 bg-cyan-300/10 text-cyan-100",
    warning: "border-dfc-warning/35 bg-dfc-warning/10 text-dfc-warning",
    danger: "border-dfc-danger/35 bg-dfc-danger/10 text-dfc-danger",
    success: "border-dfc-success/35 bg-dfc-success/10 text-dfc-success"
  };
  return <span className={`rounded-dfc-control border px-2 py-1 text-xs font-bold ${styles[tone]}`}>{children}</span>;
}

export function ActionButton({ children, tone = "primary", onClick, disabled, type = "button" }: { children: ReactNode; tone?: "primary" | "secondary" | "danger"; onClick?: () => void; disabled?: boolean; type?: "button" | "submit" }) {
  const styles = {
    primary: "border-cyan-300/60 bg-cyan-300 text-slate-950 hover:bg-cyan-200",
    secondary: "border-cyan-300/20 bg-[#101827] text-dfc-text hover:border-cyan-300/45 hover:text-cyan-100",
    danger: "border-dfc-danger/50 bg-dfc-danger text-white hover:bg-red-400"
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`rounded-dfc-control border px-4 py-2 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60 ${styles[tone]}`}>
      {children}
    </button>
  );
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="rounded-dfc-control px-3 py-2 text-sm font-semibold text-dfc-subtext hover:bg-cyan-300/10 hover:text-cyan-100">{children}</Link>;
}

function MobileNavLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="py-3 text-center text-xs font-black text-dfc-subtext">{children}</Link>;
}

function toOrderStatus(status: string) {
  const map: Record<string, string> = {
    PAID: "待接单",
    ASSIGNED: "已派单",
    ACCEPTED: "已接单",
    IN_PROGRESS: "服务中",
    COMPLETED: "已完成",
    CANCELLED: "已取消",
    DISPUTED: "争议中"
  };
  return map[status] ?? status;
}

function statusTone(status: string): "default" | "warning" | "danger" | "success" {
  if (status === "COMPLETED") return "success";
  if (status === "CANCELLED" || status === "DISPUTED") return "danger";
  if (status === "PAID" || status === "ASSIGNED" || status === "ACCEPTED" || status === "IN_PROGRESS") return "warning";
  return "default";
}
