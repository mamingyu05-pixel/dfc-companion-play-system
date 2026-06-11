import Link from "next/link";
import type { ReactNode } from "react";
import { AdminAuthGate } from "./auth-gate";

const navItems = [
  ["Dashboard", "/dashboard"],
  ["Users", "/users"],
  ["Companions", "/companions"],
  ["Add Companion", "/companions/new"],
  ["Orders", "/orders"],
  ["Dispatch", "/dispatch"],
  ["Recharges", "/recharges"],
  ["Withdrawals", "/withdrawals"],
  ["Complaints", "/complaints"],
  ["Finance", "/finance"],
  ["Logs", "/logs"]
] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-dfc-bg text-dfc-text">
      <div className="grid min-h-screen lg:grid-cols-[240px_1fr]">
        <aside className="hidden border-r border-dfc-border bg-dfc-surface lg:block">
          <div className="border-b border-dfc-border p-5">
            <div className="text-lg font-black text-dfc-blue">DFC Admin</div>
            <div className="mt-1 text-xs text-dfc-muted">Operations console</div>
          </div>
          <nav className="p-3">
            {navItems.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className="block rounded-dfc-control px-3 py-2 text-sm text-dfc-subtext hover:bg-dfc-elevated hover:text-dfc-text"
              >
                {label}
              </Link>
            ))}
          </nav>
        </aside>
        <section>
          <header className="sticky top-0 z-20 flex items-center justify-between border-b border-dfc-border bg-dfc-bg/95 px-4 py-3 backdrop-blur md:px-6">
            <div>
              <div className="text-sm font-semibold">Admin Portal</div>
              <div className="text-xs text-dfc-muted">Recharge, withdrawal, dispatch, complaints and logs</div>
            </div>
            <span className="rounded-dfc-control border border-dfc-border bg-dfc-surface px-3 py-2 text-xs text-dfc-subtext">
              SUPER_ADMIN
            </span>
          </header>
          <div className="px-4 py-6 md:px-6">
            <AdminAuthGate>{children}</AdminAuthGate>
          </div>
        </section>
      </div>
    </main>
  );
}

export function SectionHeader({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="mb-5 flex flex-col gap-1">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {desc ? <p className="text-sm text-dfc-subtext">{desc}</p> : null}
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

export function DataTable({ columns, rows }: { columns: string[]; rows: Array<Array<ReactNode>> }) {
  return (
    <div className="overflow-hidden rounded-dfc border border-dfc-border bg-dfc-surface">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-dfc-border bg-dfc-elevated text-xs text-dfc-muted">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-4 py-3 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, index) => (
                <tr key={index} className="border-b border-dfc-border last:border-b-0">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-4 py-3 text-dfc-subtext">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-dfc-muted">
                  No records
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function StatusBadge({
  children,
  tone = "default"
}: {
  children: ReactNode;
  tone?: "default" | "warning" | "danger" | "success";
}) {
  const styles = {
    default: "bg-dfc-blue/10 text-dfc-blue",
    warning: "bg-dfc-warning/10 text-dfc-warning",
    danger: "bg-dfc-danger/10 text-dfc-danger",
    success: "bg-dfc-success/10 text-dfc-success"
  };
  return <span className={`rounded-dfc-control px-2 py-1 text-xs ${styles[tone]}`}>{children}</span>;
}

export function ActionButton({
  children,
  tone = "primary",
  onClick
}: {
  children: ReactNode;
  tone?: "primary" | "danger" | "secondary";
  onClick?: () => void;
}) {
  const styles = {
    primary: "bg-dfc-blue text-slate-950",
    secondary: "border border-dfc-border bg-dfc-surface text-dfc-text",
    danger: "bg-dfc-danger text-white"
  };
  return (
    <button type="button" onClick={onClick} className={`rounded-dfc-control px-3 py-2 text-xs font-semibold ${styles[tone]}`}>
      {children}
    </button>
  );
}
