"use client";

import { useEffect, useState } from "react";
import { AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";

type Package = { id: string; platform: "PC" | "MOBILE"; targetWan: number; price: string; isActive: boolean; sortOrder: number; label: string };

async function api(path: string, init: RequestInit = {}) {
  const token = localStorage.getItem("dfc_admin_token");
  if (!token) throw new Error("请先登录管理员账号");
  const response = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join("；") : data.message || "操作未完成，请重试");
  return data;
}

export default function GuaranteePackagesPage() {
  const [packages, setPackages] = useState<Package[]>();
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setError("");
    try {
      const list = (await api("/api/admin/guarantee-packages")) as Package[];
      setPackages(list);
      setPrices(Object.fromEntries(list.map(p => [p.id, p.price])));
    } catch (e) { setPackages(undefined); setError(e instanceof Error ? e.message : "加载失败"); }
  }
  useEffect(() => { void load(); }, []);

  async function save(p: Package, body: { price?: string; isActive?: boolean }) {
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/admin/guarantee-packages/${encodeURIComponent(p.id)}`, { method: "PATCH", body: JSON.stringify(body) });
      setNotice(`${p.label} 已更新，并写入操作日志。已下单的订单仍按原价结算。`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
    finally { setBusy(false); }
  }

  return (
    <AdminShell>
      <SectionHeader title="保底护航档位" eyebrow="Guarantee Packages"
        desc="客户按档位下单、按仓库净增结算。改价只影响之后的新订单；下架后客户不可再选该档位。" />
      {error ? <p role="alert" className="mb-4 rounded border border-red-300 p-3 text-red-200">{error}</p> : null}
      {notice ? <p role="status" className="mb-4 text-green-200">{notice}</p> : null}
      {!packages && !error ? <p className="text-sm text-dfc-muted">加载中…</p> : null}
      {packages ? (
        <DataTable
          columns={["档位", "平台", "保底净增", "价格（元）", "状态", "操作"]}
          rows={packages.map(p => [
            p.label,
            p.platform === "MOBILE" ? "手游" : "端游",
            `${p.targetWan} 万`,
            <input key="price" aria-label={`${p.label} 价格`} inputMode="decimal" className="w-24 rounded bg-slate-950 p-1 text-white"
              value={prices[p.id] ?? ""} onChange={e => setPrices({ ...prices, [p.id]: e.target.value })} />,
            <StatusBadge key="state" tone={p.isActive ? "success" : "warning"}>{p.isActive ? "在售" : "已下架"}</StatusBadge>,
            <span key="actions" className="flex gap-2">
              <button className="rounded border border-cyan-300/50 px-2 py-1 text-xs disabled:opacity-40" disabled={busy || prices[p.id] === p.price}
                onClick={() => void save(p, { price: prices[p.id] })}>保存价格</button>
              <button className="rounded border border-cyan-300/20 px-2 py-1 text-xs disabled:opacity-40" disabled={busy}
                onClick={() => void save(p, { isActive: !p.isActive })}>{p.isActive ? "下架" : "上架"}</button>
            </span>
          ])}
        />
      ) : null}
    </AdminShell>
  );
}
