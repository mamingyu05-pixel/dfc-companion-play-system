"use client";

import { useEffect, useState } from "react";
import { AdminShell, SectionHeader, StatusBadge } from "../components";

type Entry = { id: string; title: string; content: string; keywords: string[]; isActive: boolean; updatedAt: string };
type Draft = { title: string; content: string; keywords: string };

const emptyDraft: Draft = { title: "", content: "", keywords: "" };
const toBody = (d: Draft) => ({ title: d.title, content: d.content, keywords: d.keywords.split(/[,，\s]+/).map(k => k.trim()).filter(Boolean) });

async function api(path: string, init: RequestInit = {}) {
  const token = localStorage.getItem("dfc_admin_token");
  if (!token) throw new Error("请先登录管理员账号");
  const response = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join("；") : data.message || "操作未完成，请重试");
  return data;
}

export default function KnowledgePage() {
  const [entries, setEntries] = useState<Entry[]>();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    try { setEntries(await api("/api/admin/support-knowledge")); }
    catch (e) { setEntries(undefined); setError(e instanceof Error ? e.message : "加载失败"); }
  }
  useEffect(() => { void load(); }, []);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(done); await load(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "保存失败"); return false; }
    finally { setBusy(false); }
  }
  async function save() {
    const ok = await run(() => editing
      ? api(`/api/admin/support-knowledge/${encodeURIComponent(editing)}`, { method: "PATCH", body: JSON.stringify(toBody(draft)) })
      : api("/api/admin/support-knowledge", { method: "POST", body: JSON.stringify(toBody(draft)) }),
    editing ? "已更新，AI 客服立即使用新内容。" : "已新增，AI 客服立即可以引用。");
    if (ok) { setDraft(emptyDraft); setEditing(null); }
  }
  function edit(entry: Entry) {
    setEditing(entry.id);
    setDraft({ title: entry.title, content: entry.content, keywords: entry.keywords.join("，") });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <AdminShell>
      <SectionHeader title="AI 客服知识库" eyebrow="Support Knowledge"
        desc="AI 客服先在这里检索相关条目，只依据检索到的内容回答；查不到就转人工。退款、充值、提现、投诉始终交给人工，不受这里影响。" />
      {error ? <p role="alert" className="mb-4 rounded border border-red-300 p-3 text-red-200">{error}</p> : null}
      {notice ? <p role="status" className="mb-4 text-green-200">{notice}</p> : null}

      <section className="admin-panel mb-6 space-y-3">
        <h2 className="text-base font-black text-white">{editing ? "编辑条目" : "新增条目"}</h2>
        <input className="input w-full" placeholder="标题，例如：保底护航怎么算（最多80字）" maxLength={80}
          value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
        <textarea className="input min-h-32 w-full" placeholder="给客户的标准说明（最多1200字）。只写系统真实执行的规则，不要写承诺。" maxLength={1200}
          value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })} />
        <input className="input w-full" placeholder="关键词，用逗号分隔，例如：保底，护航，炸单（客户常用的说法，帮助检索）"
          value={draft.keywords} onChange={e => setDraft({ ...draft, keywords: e.target.value })} />
        <div className="flex gap-2">
          <button className="rounded border border-cyan-300/60 bg-cyan-300 px-4 py-2 text-sm font-black text-slate-950 disabled:opacity-50"
            disabled={busy || !draft.title.trim() || !draft.content.trim()} onClick={() => void save()}>{editing ? "保存修改" : "新增"}</button>
          {editing ? <button className="rounded border border-cyan-300/30 px-4 py-2 text-sm" onClick={() => { setEditing(null); setDraft(emptyDraft); }}>取消编辑</button> : null}
        </div>
      </section>

      {!entries && !error ? <p className="text-sm text-dfc-muted">加载中…</p> : null}
      <div className="space-y-3">
        {entries?.map(entry => (
          <article key={entry.id} className="admin-panel">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-black text-white">{entry.title}</h3>
              <span className="flex items-center gap-2">
                <StatusBadge tone={entry.isActive ? "success" : "warning"}>{entry.isActive ? "启用" : "停用"}</StatusBadge>
                <button className="rounded border border-cyan-300/40 px-2 py-1 text-xs" disabled={busy} onClick={() => edit(entry)}>编辑</button>
                <button className="rounded border border-cyan-300/20 px-2 py-1 text-xs" disabled={busy}
                  onClick={() => void run(() => api(`/api/admin/support-knowledge/${encodeURIComponent(entry.id)}`, { method: "PATCH", body: JSON.stringify({ isActive: !entry.isActive }) }),
                    entry.isActive ? "已停用，AI 客服不再引用。" : "已启用。")}>{entry.isActive ? "停用" : "启用"}</button>
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-dfc-subtext">{entry.content}</p>
            {entry.keywords.length ? <p className="mt-2 text-xs text-dfc-muted">关键词：{entry.keywords.join("、")}</p> : null}
          </article>
        ))}
      </div>
    </AdminShell>
  );
}
