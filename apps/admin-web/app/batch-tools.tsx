"use client";

import { ReactNode, useState } from "react";

export async function adminApi<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("dfc_admin_token");
  if (!token) throw new Error("请先登录管理员账号");
  const response = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join("；") : data.message || "操作未完成，请重试");
  return data as T;
}

export function useSelection() {
  const [selected, setSelected] = useState<string[]>([]);
  return {
    selected,
    has: (id: string) => selected.includes(id),
    toggle: (id: string) => setSelected(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id]),
    // Selecting all when everything visible is already selected clears instead.
    toggleAll: (ids: string[]) => setSelected(current => ids.every(id => current.includes(id)) ? [] : ids),
    clear: () => setSelected([])
  };
}

export function SelectBox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <input type="checkbox" aria-label={label} className="h-4 w-4 accent-[#ff6a3d]" checked={checked} onChange={onChange} />;
}

// Sticks to the bottom of the screen while something is selected, so actions stay reachable on long lists.
export function BatchBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  if (!count) return null;
  return (
    <div className="sticky bottom-3 z-20 mt-4 flex flex-wrap items-center gap-2 rounded-[14px] border border-[#ffc2ad] bg-white/95 p-3 shadow-card backdrop-blur">
      <span className="text-sm font-black text-dfc-text">已选 {count} 项</span>
      {children}
      <button className="ml-auto rounded-[9px] border border-[#e6e8ef] px-3 py-1 text-xs text-dfc-subtext" onClick={onClear}>取消选择</button>
    </div>
  );
}

export function BatchButton({ onClick, disabled, tone = "primary", children }: { onClick: () => void; disabled?: boolean; tone?: "primary" | "danger" | "plain"; children: ReactNode }) {
  const cls = tone === "primary" ? "border-brand bg-brand text-white hover:bg-brand-ink"
    : tone === "danger" ? "border-[#f6c3c4] bg-white text-dfc-danger" : "border-[#e6e8ef] bg-white text-dfc-text hover:border-brand";
  return <button className={`rounded-[9px] border px-3 py-1.5 text-sm font-black disabled:opacity-50 ${cls}`} disabled={disabled} onClick={onClick}>{children}</button>;
}

export function ExportButton({ kind, label }: { kind: "users" | "orders" | "recharges"; label: string }) {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const token = localStorage.getItem("dfc_admin_token");
      if (!token) throw new Error("请先登录管理员账号");
      const response = await fetch(`/api/admin/export/${kind}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("导出失败");
      const url = URL.createObjectURL(await response.blob());
      const link = Object.assign(document.createElement("a"), { href: url, download: `${label}-${new Date().toISOString().slice(0, 10)}.csv` });
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) { window.alert(e instanceof Error ? e.message : "导出失败"); }
    finally { setBusy(false); }
  }
  return <BatchButton tone="plain" disabled={busy} onClick={() => void download()}>{busy ? "导出中…" : `导出${label} Excel`}</BatchButton>;
}

// Sum money strings in cents so the confirmation total matches the server's decimal sum exactly.
export function sumYuan(values: string[]) {
  const cents = values.reduce((sum, v) => sum + Math.round(Number(v || 0) * 100), 0);
  return (cents / 100).toFixed(2);
}
