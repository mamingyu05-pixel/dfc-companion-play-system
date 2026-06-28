import Link from "next/link";
import type { ReactNode } from "react";
import { AdminAuthGate } from "./auth-gate";

const navItems = [
  ["看板", "/dashboard"],
  ["用户", "/users"],
  ["陪玩", "/companions"],
  ["添加陪玩", "/companions/new"],
  ["订单", "/orders"],
  ["草稿台", "/order-drafts"],
  ["单人派单", "/dispatch"],
  ["优惠", "/promotions"],
  ["充值审核", "/recharges"],
  ["提现审核", "/withdrawals"],
  ["投诉", "/complaints"],
  ["财务", "/finance"],
  ["日志", "/logs"]
] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <main className="admin-console-bg min-h-screen overflow-x-hidden text-dfc-text">
      <div className="grid min-h-screen xl:grid-cols-[248px_1fr]">
        <aside className="admin-sidebar hidden xl:block">
          <div className="border-b border-cyan-300/15 p-5">
            <div className="text-xs font-black uppercase tracking-[0.2em] text-fuchsia-200">Maycat Ops</div>
            <div className="mt-2 text-xl font-black text-white">May猫饼后台</div>
            <div className="mt-1 text-xs text-dfc-muted">电竞陪玩运营控制台</div>
          </div>
          <nav className="space-y-1 p-3" aria-label="后台导航">
            {navItems.map(([label, href]) => (
              <Link key={href} href={href} className="admin-nav-item">
                {label}
              </Link>
            ))}
          </nav>
        </aside>

        <section className="min-w-0">
          <header className="sticky top-0 z-20 border-b border-cyan-300/15 bg-[#060913]/92 px-4 py-3 backdrop-blur-xl md:px-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-black text-white">运营后台</div>
                <div className="mt-1 text-xs text-dfc-muted">充值、提现、派单、试音、投诉、日志统一处理</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="admin-status-pill border-dfc-success/40 bg-dfc-success/10 text-dfc-success">API 留痕</span>
                <span className="admin-status-pill border-dfc-gold/40 bg-dfc-gold/10 text-dfc-gold">人工审核</span>
                <span className="admin-status-pill border-cyan-300/30 bg-cyan-300/10 text-cyan-100">SUPER_ADMIN</span>
              </div>
            </div>
          </header>

          <nav className="border-b border-cyan-300/15 bg-[#0a1020]/88 px-3 py-2 xl:hidden" aria-label="移动端后台导航">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {navItems.map(([label, href]) => (
                <Link key={href} href={href} className="shrink-0 rounded-dfc-control border border-cyan-300/20 bg-[#050711]/80 px-3 py-2 text-xs font-semibold text-dfc-subtext">
                  {label}
                </Link>
              ))}
            </div>
          </nav>

          <div className="px-4 py-6 md:px-6">
            <AdminAuthGate>{children}</AdminAuthGate>
          </div>
        </section>
      </div>
    </main>
  );
}

export function SectionHeader({ title, desc, eyebrow }: { title: string; desc?: string; eyebrow?: string }) {
  return (
    <div className="mb-5 flex flex-col gap-1">
      {eyebrow ? <div className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-200">{eyebrow}</div> : null}
      <h1 className="text-2xl font-black tracking-normal text-white md:text-3xl">{title}</h1>
      {desc ? <p className="max-w-3xl text-sm leading-6 text-dfc-subtext">{desc}</p> : null}
    </div>
  );
}

export function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="admin-metric-card">
      <div className="text-xs font-semibold text-dfc-muted">{label}</div>
      <div className="mt-3 text-3xl font-black tabular-nums text-white">{value}</div>
      <div className="mt-2 text-xs leading-5 text-dfc-subtext">{hint}</div>
    </div>
  );
}

export function DataTable({
  columns,
  rows,
  maxHeightClassName,
  stickyHeader = false
}: {
  columns: string[];
  rows: Array<Array<ReactNode>>;
  maxHeightClassName?: string;
  stickyHeader?: boolean;
}) {
  return (
    <div className="admin-table-wrap">
      <div className={`overflow-x-auto ${maxHeightClassName ? `${maxHeightClassName} overflow-y-auto` : ""}`}>
        <table className="min-w-full text-left text-sm">
          <thead className={`border-b border-cyan-300/15 bg-[#101827] text-xs text-dfc-muted ${stickyHeader ? "sticky top-0 z-10" : ""}`}>
            <tr>
              {columns.map((column) => (
                <th key={column} className="whitespace-nowrap px-4 py-3 font-black">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, index) => (
                <tr key={index} className="border-b border-cyan-300/10 last:border-b-0 hover:bg-cyan-300/[0.035]">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="whitespace-nowrap px-4 py-3 text-dfc-subtext">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-dfc-muted">
                  暂无记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
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

export function ActionButton({ children, tone = "primary", onClick }: { children: ReactNode; tone?: "primary" | "danger" | "secondary"; onClick?: () => void }) {
  const styles = {
    primary: "border-cyan-300/60 bg-cyan-300 text-slate-950 hover:bg-cyan-200",
    secondary: "border-cyan-300/20 bg-[#101827] text-dfc-text hover:border-cyan-300/45 hover:text-cyan-100",
    danger: "border-dfc-danger/50 bg-dfc-danger text-white hover:bg-red-400"
  };
  return (
    <button type="button" onClick={onClick} className={`rounded-dfc-control border px-3 py-2 text-xs font-black transition ${styles[tone]}`}>
      {children}
    </button>
  );
}
