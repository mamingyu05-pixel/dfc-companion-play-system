"use client";

import { useState } from "react";
import { AdminShell, SectionHeader } from "../components";

type Role = { id: string; name: string; memberCount: number };
type Person = { id: string; name: string };
type Preview = {
  total: number;
  roles: Role[];
  selection: { companionRoleIds: string[]; staffRoleIds: string[] };
  counts: { bound: number; staff: number; companions: number; customers: number; bots: number };
  companions: Person[];
  customerSample: Person[];
};

async function api(path: string, body: unknown) {
  const token = localStorage.getItem("dfc_admin_token");
  if (!token) throw new Error("请先登录管理员账号");
  const response = await fetch(path, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join("；") : data.message || "操作未完成，请重试");
  return data;
}

function RolePicker({ title, roles, value, onChange }: { title: string; roles: Role[]; value: string[]; onChange: (ids: string[]) => void }) {
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 text-sm font-black text-white">{title}</legend>
      <div className="flex flex-wrap gap-2">
        {roles.map(role => (
          <label key={role.id} className="flex items-center gap-1 rounded border border-cyan-300/20 px-2 py-1 text-xs">
            <input type="checkbox" checked={value.includes(role.id)}
              onChange={e => onChange(e.target.checked ? [...value, role.id] : value.filter(id => id !== role.id))} />
            {role.name || role.id}<span className="text-dfc-muted">（{role.memberCount}）</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function KookImportPage() {
  const [preview, setPreview] = useState<Preview>();
  const [companionRoles, setCompanionRoles] = useState<string[]>([]);
  const [staffRoles, setStaffRoles] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [price, setPrice] = useState("60");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  async function load(refresh: boolean, roles?: { companionRoleIds: string[]; staffRoleIds: string[] }) {
    setBusy(true); setError("");
    try {
      const data: Preview = await api("/api/admin/kook-members/preview", { refresh, ...roles });
      setPreview(data);
      setCompanionRoles(data.selection.companionRoleIds);
      setStaffRoles(data.selection.staffRoleIds);
    } catch (e) { setError(e instanceof Error ? e.message : "读取失败"); }
    finally { setBusy(false); }
  }

  const selection = { companionRoleIds: companionRoles, staffRoleIds: staffRoles };

  async function runImport(kind: "companions" | "customers") {
    setBusy(true); setError(""); setProgress("");
    const memberIds = kind === "companions" ? preview?.companions.filter(p => !excluded.includes(p.id)).map(p => p.id) : undefined;
    let created = 0;
    let skipped = 0;
    try {
      for (;;) {
        const result: { created: number; skipped: number; remaining: number } =
          await api("/api/admin/kook-members/import", { kind, pricePerHour: price, memberIds, ...selection });
        created += result.created; skipped += result.skipped;
        setProgress(`已建档 ${created} 人${skipped ? `，跳过 ${skipped} 人` : ""}${result.remaining ? `，还剩 ${result.remaining} 人…` : "，完成。"}`);
        // Stop if a whole batch made no progress, so a persistent conflict cannot loop forever.
        if (!result.remaining || result.created === 0) break;
      }
      await load(false, selection);
    } catch (e) { setError(e instanceof Error ? e.message : "导入失败"); }
    finally { setBusy(false); }
  }

  const companions = preview?.companions ?? [];
  const chosenCompanions = companions.filter(p => !excluded.includes(p.id)).length;

  return (
    <AdminShell>
      <SectionHeader title="导入 KOOK 成员" eyebrow="KOOK Import"
        desc="把 KOOK 服务器里已有的成员一次性建成系统档案并绑定 KOOK。已绑定的人自动跳过，可以反复执行；管理员和客服不会被导入。" />
      {error ? <p role="alert" className="mb-4 rounded border border-red-300 p-3 text-red-200">{error}</p> : null}
      {progress ? <p role="status" className="mb-4 text-green-200">{progress}</p> : null}

      <section className="admin-panel mb-6 space-y-3">
        <button className="rounded border border-cyan-300/60 bg-cyan-300 px-4 py-2 text-sm font-black text-slate-950 disabled:opacity-50"
          disabled={busy} onClick={() => void load(true, preview ? selection : undefined)}>{preview ? "重新读取成员" : "读取 KOOK 服务器成员"}</button>
        {preview ? (
          <>
            <p className="text-sm text-dfc-subtext">
              共 {preview.total} 人：已绑定 {preview.counts.bound}，待导入陪玩 {preview.counts.companions}，待导入客户 {preview.counts.customers}，
              管理人员 {preview.counts.staff}（不导入），机器人 {preview.counts.bots}。
            </p>
            <RolePicker title="哪些角色是陪玩？" roles={preview.roles} value={companionRoles} onChange={setCompanionRoles} />
            <RolePicker title="哪些角色是管理员/客服？（不导入）" roles={preview.roles} value={staffRoles} onChange={setStaffRoles} />
            <button className="rounded border border-cyan-300/40 px-3 py-1 text-xs" disabled={busy}
              onClick={() => void load(false, selection)}>按所选角色重新分组</button>
          </>
        ) : null}
      </section>

      {preview ? (
        <>
          <section className="admin-panel mb-6 space-y-3">
            <h2 className="text-base font-black text-white">第一步：导入陪玩（{chosenCompanions} 人）</h2>
            <p className="text-xs text-dfc-muted">直接上架，可在「陪玩」页逐个修改价格、游戏和照片。他们在 KOOK 私聊机器人发「陪玩工作台」即可接单。</p>
            <label className="flex items-center gap-2 text-sm">默认时薪 ¥
              <input className="input w-24" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} />
            </label>
            {companions.length ? (
              <div className="flex max-h-60 flex-wrap gap-2 overflow-y-auto">
                {companions.map(p => (
                  <label key={p.id} className="flex items-center gap-1 rounded border border-cyan-300/20 px-2 py-1 text-xs">
                    <input type="checkbox" checked={!excluded.includes(p.id)}
                      onChange={e => setExcluded(e.target.checked ? excluded.filter(id => id !== p.id) : [...excluded, p.id])} />
                    {p.name}
                  </label>
                ))}
              </div>
            ) : <p className="text-xs text-dfc-muted">{companionRoles.length ? "没有待导入的陪玩。" : "先在上面勾选代表陪玩的角色。"}</p>}
            <button className="rounded border border-cyan-300/60 bg-cyan-300 px-4 py-2 text-sm font-black text-slate-950 disabled:opacity-50"
              disabled={busy || !chosenCompanions} onClick={() => void runImport("companions")}>导入 {chosenCompanions} 名陪玩</button>
          </section>

          <section className="admin-panel space-y-3">
            <h2 className="text-base font-black text-white">第二步：导入客户（{preview.counts.customers} 人）</h2>
            <p className="text-xs text-dfc-muted">
              余额为 0，昵称用 KOOK 昵称。客户在 KOOK 直接下单即可；以后用网页绑定码绑定自己的网页账号时，会自动合并到网页账号。
            </p>
            {preview.customerSample.length ? <p className="text-xs text-dfc-muted">例如：{preview.customerSample.map(p => p.name).join("、")}…</p> : null}
            <button className="rounded border border-cyan-300/60 bg-cyan-300 px-4 py-2 text-sm font-black text-slate-950 disabled:opacity-50"
              disabled={busy || !preview.counts.customers} onClick={() => void runImport("customers")}>导入 {preview.counts.customers} 名客户</button>
          </section>
        </>
      ) : null}
    </AdminShell>
  );
}
