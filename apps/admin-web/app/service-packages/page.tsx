"use client";

import { useEffect, useState } from "react";
import { ActionButton, AdminShell, DataTable, SectionHeader, StatusBadge } from "../components";
import { adminApi } from "../batch-tools";

type ServicePackage = { id: string; category: string; name: string; description: string | null; price: string; isActive: boolean; sortOrder: number };
type Draft = { category: string; name: string; description: string; price: string; sortOrder: string };

const emptyDraft: Draft = { category: "", name: "", description: "", price: "", sortOrder: "0" };

// Fixed-price services customers order at /packages. Orders snapshot name and price, so edits only affect new orders.
export default function ServicePackagesPage() {
  const [rows, setRows] = useState<ServicePackage[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function load() {
    setRows(await adminApi<ServicePackage[]>("/api/admin/service-packages"));
  }

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "无法加载套餐"));
  }, []);

  function edit(row: ServicePackage) {
    setEditingId(row.id);
    setDraft({ category: row.category, name: row.name, description: row.description ?? "", price: row.price, sortOrder: String(row.sortOrder) });
    setError(""); setStatus("");
  }

  function reset() {
    setEditingId(null);
    setDraft(emptyDraft);
  }

  async function save() {
    const sortOrder = Number(draft.sortOrder || 0);
    if (!draft.category.trim() || !draft.name.trim()) { setError("请填写分类和名称"); return; }
    if (!/^\d{1,5}(\.\d{1,2})?$/.test(draft.price.trim()) || Number(draft.price) <= 0) { setError("价格填大于 0 的金额，最多两位小数"); return; }
    if (!Number.isSafeInteger(sortOrder)) { setError("排序须为整数"); return; }
    const body = { category: draft.category.trim(), name: draft.name.trim(), description: draft.description.trim(), price: draft.price.trim(), sortOrder };
    setBusy(true); setError(""); setStatus("");
    try {
      if (editingId) {
        await adminApi(`/api/admin/service-packages/${encodeURIComponent(editingId)}`, { method: "PATCH", body: JSON.stringify(body) });
        setStatus(`已保存「${body.name}」，只影响之后的新订单`);
      } else {
        await adminApi("/api/admin/service-packages", { method: "POST", body: JSON.stringify({ ...body, isActive: false }) });
        setStatus(`已新建「${body.name}」（未上架），确认无误后点“上架”`);
      }
      reset();
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "保存失败"); }
    finally { setBusy(false); }
  }

  async function toggle(row: ServicePackage) {
    if (!window.confirm(`${row.isActive ? "下架" : "上架"}「${row.name}」？`)) return;
    setBusy(true); setError(""); setStatus("");
    try {
      await adminApi(`/api/admin/service-packages/${encodeURIComponent(row.id)}`, { method: "PATCH", body: JSON.stringify({ isActive: !row.isActive }) });
      setStatus(`「${row.name}」已${row.isActive ? "下架" : "上架"}`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "操作失败"); }
    finally { setBusy(false); }
  }

  const field = (key: keyof Draft) => ({ value: draft[key], onChange: (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: event.target.value })) });

  return (
    <AdminShell>
      <SectionHeader eyebrow="Fixed-price Services" title="套餐管理" desc="一口价套餐（指定大红、跑刀、保险箱任务等）。客户在“套餐”页下单，钱同样先托管，验收后结算。新建默认不上架。" />
      {error ? <div role="alert" className="mb-4 rounded-dfc-control border border-dfc-danger/40 bg-dfc-danger/10 px-3 py-2 text-sm text-dfc-danger">{error}</div> : null}
      {status ? <div role="status" className="mb-4 rounded-dfc-control border border-dfc-success/40 bg-dfc-success/10 px-3 py-2 text-sm text-dfc-success">{status}</div> : null}

      <section className="admin-panel mb-5">
        <h2 className="mb-3 text-sm font-black">{editingId ? "编辑套餐" : "新建套餐"}</h2>
        <div className="grid gap-3 md:grid-cols-5">
          <label className="text-xs font-semibold">分类<input className="input mt-1 w-full" maxLength={32} placeholder="如：指定物资" {...field("category")} /></label>
          <label className="text-xs font-semibold">名称<input className="input mt-1 w-full" maxLength={40} placeholder="如：指定大红 ×1" {...field("name")} /></label>
          <label className="text-xs font-semibold md:col-span-2">说明<input className="input mt-1 w-full" maxLength={200} placeholder="交付标准，客户能看到" {...field("description")} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold">价格 ¥<input className="input mt-1 w-full" inputMode="decimal" {...field("price")} /></label>
            <label className="text-xs font-semibold">排序<input className="input mt-1 w-full" inputMode="numeric" {...field("sortOrder")} /></label>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <ActionButton disabled={busy} onClick={() => void save()}>{editingId ? "保存修改" : "新建（不上架）"}</ActionButton>
          {editingId ? <ActionButton tone="secondary" disabled={busy} onClick={reset}>取消编辑</ActionButton> : null}
        </div>
      </section>

      <DataTable
        columns={["分类", "名称", "说明", "价格", "排序", "状态", "操作"]}
        rows={rows.map((row) => [
          row.category,
          <span key={`${row.id}-name`} className="font-semibold">{row.name}</span>,
          <span key={`${row.id}-desc`} className="text-xs text-dfc-muted">{row.description ?? "—"}</span>,
          <span key={`${row.id}-price`} className="font-black tabular-nums">¥{row.price}</span>,
          row.sortOrder,
          <StatusBadge key={`${row.id}-status`} tone={row.isActive ? "success" : "default"}>{row.isActive ? "已上架" : "未上架"}</StatusBadge>,
          <div key={`${row.id}-actions`} className="flex gap-2">
            <ActionButton tone="secondary" disabled={busy} onClick={() => edit(row)}>编辑</ActionButton>
            <ActionButton tone={row.isActive ? "danger" : "primary"} disabled={busy} onClick={() => void toggle(row)}>{row.isActive ? "下架" : "上架"}</ActionButton>
          </div>
        ])}
      />
    </AdminShell>
  );
}
