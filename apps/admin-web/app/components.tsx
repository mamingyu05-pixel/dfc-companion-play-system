import Link from "next/link";
import type { ReactNode } from "react";
import { AdminAuthGate } from "./auth-gate";
import { AdminMobileNav, AdminSidebarNav } from "./admin-nav";
import { CountUp, PageTransition } from "./motion";

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <main className="admin-console-bg min-h-screen overflow-x-hidden">
      <div className="grid min-h-screen xl:grid-cols-[240px_1fr]">
        <aside className="admin-sidebar hidden xl:block">
          <div className="sticky top-0 max-h-screen overflow-y-auto">
            <Link href="/dashboard" className="dfc-brand px-5 py-4">
              <img src="/admin/icon.svg" alt="" />
              <span><b>小小电竞</b><small>运营后台</small></span>
            </Link>
            <AdminSidebarNav />
          </div>
        </aside>

        <section className="min-w-0">
          <header className="dfc-topbar flex items-center gap-3 px-4 py-2.5 md:px-6">
            <Link href="/dashboard" className="dfc-brand xl:hidden">
              <img src="/admin/icon.svg" alt="" />
              <span className="hidden sm:block"><b>小小电竞后台</b></span>
            </Link>
            <span className="flex-1" />
            <Link href="/quick-order" className="dfc-pill dfc-pill-strong">＋ 快速开单</Link>
            <Link href="/staff-recharge" className="dfc-pill">代客充值</Link>
          </header>

          <nav className="border-b border-[#e7e4de] bg-white/70 px-3 py-2 backdrop-blur xl:hidden" aria-label="移动端后台导航">
            <AdminMobileNav />
          </nav>

          <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-6">
            <AdminAuthGate><PageTransition>{children}</PageTransition></AdminAuthGate>
          </div>
        </section>
      </div>
    </main>
  );
}

// eyebrow stays in the props for existing callers; the light theme does not show the English labels.
export function SectionHeader({ title, desc }: { title: string; desc?: string; eyebrow?: string }) {
  return (
    <div className="dfc-title mb-5">
      <h1>{title}</h1>
      {desc ? <p>{desc}</p> : null}
    </div>
  );
}

export function MetricCard({ label, value, hint, href }: { label: string; value: string; hint: string; href?: string }) {
  const body = (
    <>
      <div className="text-xs font-semibold text-dfc-muted">{label}</div>
      <div className="mt-2 text-3xl font-black tabular-nums text-dfc-text"><CountUp value={value} /></div>
      <div className="mt-2 text-xs leading-5 text-dfc-subtext">{hint}{href ? " · 去处理 →" : ""}</div>
    </>
  );
  return href
    ? <Link href={href} className="admin-metric-card block transition hover:border-brand">{body}</Link>
    : <div className="admin-metric-card">{body}</div>;
}

export function DataTable({
  columns,
  rows,
  maxHeightClassName,
  stickyHeader = false
}: {
  columns: ReactNode[];
  rows: Array<Array<ReactNode>>;
  maxHeightClassName?: string;
  stickyHeader?: boolean;
}) {
  return (
    <div className="admin-table-wrap">
      <div className={`overflow-x-auto ${maxHeightClassName ? `${maxHeightClassName} overflow-y-auto` : ""}`}>
        <table className="min-w-full text-left text-sm">
          <thead className={`border-b border-[#e6e8ef] bg-[#f8f9fc] text-xs text-dfc-muted ${stickyHeader ? "sticky top-0 z-10" : ""}`}>
            <tr>
              {columns.map((column, index) => (
                <th key={index} className="whitespace-nowrap px-4 py-3 font-black">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, index) => (
                <tr key={index} className="border-b border-[#eef0f4] last:border-b-0 hover:bg-[#fafbfd]">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="whitespace-nowrap px-4 py-3 text-dfc-text">
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
    default: "bg-[#f0f1f5] text-dfc-subtext",
    warning: "bg-[#fff4e5] text-dfc-warning",
    danger: "bg-[#fdecec] text-dfc-danger",
    success: "bg-[#e8f7ef] text-dfc-success"
  };
  return <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-bold ${styles[tone]}`}>{children}</span>;
}

export function ActionButton({ children, tone = "primary", onClick, disabled = false }: { children: ReactNode; tone?: "primary" | "danger" | "secondary"; onClick?: () => void; disabled?: boolean }) {
  const styles = {
    primary: "border-brand bg-brand text-white hover:bg-brand-ink",
    secondary: "border-[#e6e8ef] bg-white text-dfc-text hover:border-brand",
    danger: "border-[#f6c3c4] bg-white text-dfc-danger hover:bg-[#fdecec]"
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`rounded-[9px] border px-3 py-2 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[tone]}`}>
      {children}
    </button>
  );
}
