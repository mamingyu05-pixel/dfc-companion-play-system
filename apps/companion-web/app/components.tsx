import Link from "next/link";
import type { ReactNode } from "react";
import { CompanionAuthGate } from "./auth-gate";
import { CompanionTabBar, CompanionTopNav } from "./companion-nav";
import { CountUp, PageTransition } from "./motion";

export function CompanionShell({ children }: { children: ReactNode }) {
  return (
    <main className="companion-console-bg dfc-violet min-h-screen overflow-x-hidden text-dfc-text">
      <header className="dfc-topbar">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 md:px-6">
          <Link href="/dashboard" className="dfc-brand">
            <img src="/companion/icon.svg" alt="" />
            <span><b>小小电竞 · 陪玩端</b><small>接单 · 服务 · 收益 · 提现</small></span>
          </Link>
          <CompanionTopNav />
          <span className="dfc-pill"><span className="dfc-live" aria-hidden="true" />在线</span>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 pb-28 pt-6 md:px-6 lg:pb-12">
        <CompanionAuthGate><PageTransition>{children}</PageTransition></CompanionAuthGate>
      </div>
      <CompanionTabBar />
    </main>
  );
}

// eyebrow stays in the props for existing callers; the light theme does not show the English labels.
export function SectionHeader({ title, desc }: { title: string; desc?: string; eyebrow?: string }) {
  return (
    <div className="dfc-title">
      <h1>{title}</h1>
      {desc ? <p>{desc}</p> : null}
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
      <div className={`mt-2 text-2xl font-black tabular-nums ${toneClass}`}><CountUp value={value} /></div>
      <div className="mt-1 text-xs leading-5 text-dfc-subtext">{hint}</div>
    </div>
  );
}

export function OrderCard({
  order,
  action,
  onAction,
  disabled
}: {
  order: { id: string; mode: string; hours: number; amount: number; status: string; customer?: string };
  action?: string;
  onAction?: () => void;
  disabled?: boolean;
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
        {action ? <ActionButton onClick={onAction} disabled={disabled}>{action}</ActionButton> : null}
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

function toOrderStatus(status: string) {
  const map: Record<string, string> = {
    PAID: "待接单",
    ASSIGNED: "已派单",
    ACCEPTED: "已接单",
    IN_PROGRESS: "服务中",
    AWAITING_ACCEPTANCE: "待验收结算",
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
