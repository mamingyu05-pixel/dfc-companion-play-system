"use client";

// Kept in sync with apps/customer-web/app/guarantee-evidence.tsx; shared rules live in @dfc/ui.
import { useState } from "react";
import {
  canUploadEvidence, canUploadVault, evidenceKindLabel, guaranteeProgressText, parseVaultWan, readEvidenceImage,
  type EvidenceKind, type OrderEvidenceView
} from "@dfc/ui";

type Props = { orderId: string; status: string; tokenKey: string; defaultKind: EvidenceKind; guarantee: boolean };

export function GuaranteeEvidencePanel({ orderId, status, tokenKey, defaultKind, guarantee }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<OrderEvidenceView | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<EvidenceKind>(guarantee && canUploadVault(status) ? defaultKind : "RECORDING");
  const [value, setValue] = useState("");
  const [image, setImage] = useState("");
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const vault = kind === "VAULT_START" || kind === "VAULT_END";

  async function call(method: "GET" | "POST", body?: unknown, suffix = "") {
    let token: string | null = null;
    try { token = localStorage.getItem(tokenKey); } catch { /* handled below */ }
    if (!token) throw new Error("请先登录");
    const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/evidence${suffix}`, {
      method, cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join("；") : data.message || "操作未完成，请重试");
    return data;
  }
  // The list only flags images; each screenshot is fetched when someone asks to see it.
  async function showImage(id: string) {
    setError("");
    try {
      const data = await call("GET", undefined, `/${encodeURIComponent(id)}/image`);
      if (typeof data.imageUrl === "string") setImages(current => ({ ...current, [id]: data.imageUrl }));
    } catch (e) { setError(e instanceof Error ? e.message : "截图读取失败"); }
  }
  async function load() {
    setBusy(true); setError("");
    try { setView(await call("GET") as OrderEvidenceView); }
    catch (e) { setView(null); setError(e instanceof Error ? e.message : "凭证读取失败"); }
    finally { setBusy(false); }
  }
  async function pick(file: File | undefined) {
    setImage(""); setError("");
    if (!file) return;
    try {
      setImage(await readEvidenceImage(file, () => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("图片读取失败，请重新选择"));
        reader.readAsDataURL(file);
      })));
    } catch (e) { setError(e instanceof Error ? e.message : "图片读取失败"); }
  }
  async function submit() {
    setError(""); setNotice("");
    const wan = vault ? parseVaultWan(value) : null;
    if (vault && wan === null) { setError("请填写仓库总价值（万，整数）"); return; }
    if (vault && !image) { setError("仓库凭证必须附截图"); return; }
    if (!vault && !image && !link.trim()) { setError("请附截图或录屏链接"); return; }
    setBusy(true);
    try {
      await call("POST", { kind, ...(vault ? { vaultValueWan: wan } : {}), ...(image ? { image } : {}), ...(link.trim() ? { linkUrl: link.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
      setValue(""); setImage(""); setLink(""); setNote("");
      setNotice("凭证已上传。");
      setView(await call("GET") as OrderEvidenceView);
    } catch (e) { setError(e instanceof Error ? e.message : "上传失败"); }
    finally { setBusy(false); }
  }

  // A blown run is recorded with a screenshot and raises the target by the order's snapshotted bonus.
  const blownRule = guarantee && canUploadVault(status) && view?.blownBonusWan ? ["BLOWN_RUN"] as EvidenceKind[] : [];
  const kinds: EvidenceKind[] = [...(guarantee && canUploadVault(status) ? ["VAULT_START", "VAULT_END"] as EvidenceKind[] : []), ...blownRule, "RECORDING", "OTHER"];
  return (
    <div className="mt-3">
      <button type="button" className="text-sm text-cyan-200 underline" aria-expanded={open}
        onClick={() => { const next = !open; setOpen(next); if (next) void load(); }}>
        {open ? "收起凭证" : guarantee ? "保底凭证与进度" : "服务凭证"}
      </button>
      {open ? (
        <section aria-label="订单凭证" className="mt-2 space-y-3 rounded-dfc border border-cyan-300/20 p-3 text-sm">
          {busy && !view ? <p role="status">正在读取凭证…</p> : null}
          {view?.progress ? (
            <p className={view.progress.reached ? "font-bold text-emerald-200" : "font-bold text-amber-100"}>{guaranteeProgressText(view.targetWan, view.progress)}</p>
          ) : null}
          {view ? (
            view.evidence.length ? (
              <ul className="grid gap-3 sm:grid-cols-2">
                {view.evidence.map(item => (
                  <li key={item.id} className="min-w-0 break-words rounded-dfc-control border border-cyan-300/15 p-2">
                    <p className="font-bold">{evidenceKindLabel[item.kind]}{item.vaultValueWan !== null ? ` · ${item.vaultValueWan} 万` : ""}</p>
                    <p className="text-xs text-dfc-muted">{item.uploader} · {new Date(item.createdAt).toLocaleString("zh-CN")}</p>
                    {item.hasImage ? (images[item.id]
                      ? <img src={images[item.id]} alt={evidenceKindLabel[item.kind]} className="mt-2 max-h-60 rounded" />
                      : <button type="button" className="mt-1 text-cyan-200 underline" onClick={() => void showImage(item.id)}>查看截图</button>) : null}
                    {item.linkUrl ? <a href={item.linkUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block text-cyan-200 underline">打开录屏链接</a> : null}
                    {item.note ? <p className="mt-1 whitespace-pre-wrap">{item.note}</p> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="text-dfc-subtext">还没有凭证。</p>
          ) : null}
          {canUploadEvidence(status) ? (
            <div className="space-y-2 border-t border-cyan-300/15 pt-3">
              <div className="flex flex-wrap gap-3">
                <label>类型 <select className="rounded border border-cyan-300/30 bg-[#050711] text-white ml-1 p-1" value={kind} onChange={e => setKind(e.target.value as EvidenceKind)}>
                  {kinds.map(k => <option key={k} value={k}>{evidenceKindLabel[k]}</option>)}
                </select></label>
                {vault ? <label>仓库总价值 <input inputMode="numeric" className="rounded border border-cyan-300/30 bg-[#050711] text-white ml-1 w-28 p-1" placeholder="万" value={value} onChange={e => setValue(e.target.value)} /> 万</label> : null}
              </div>
              {kind === "BLOWN_RUN" && view?.blownBonusWan ? (
                <p className="text-xs text-amber-100">上传炸单截图后，本单保底目标增加 {view.blownBonusWan} 万（可累计），客户能看到。</p>
              ) : null}
              <label className="block">截图 <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => void pick(e.target.files?.[0])} /></label>
              {!vault ? <input className="rounded border border-cyan-300/30 bg-[#050711] text-white w-full p-1" placeholder="录屏链接（可选）https://…" value={link} onChange={e => setLink(e.target.value)} /> : null}
              <input className="rounded border border-cyan-300/30 bg-[#050711] text-white w-full p-1" maxLength={200} placeholder="备注（可选）" value={note} onChange={e => setNote(e.target.value)} />
              <button type="button" className="rounded border border-cyan-300/40 px-3 py-1 font-bold text-cyan-100 disabled:opacity-50" disabled={busy} onClick={() => void submit()}>{busy ? "正在上传…" : "上传凭证"}</button>
            </div>
          ) : null}
          {error ? <p role="alert" className="text-rose-200">{error}</p> : null}
          {notice ? <p role="status" className="text-emerald-200">{notice}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
