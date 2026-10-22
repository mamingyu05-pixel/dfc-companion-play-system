"use client";

import { useState } from "react";

// Inline evidence is stored as data URLs; browsers block opening those in a new tab, and lists stay small
// by loading one image only when an operator asks for it.
export function LazyImage({ path, field, label }: { path: string; field: "imageUrl" | "screenshotUrl"; label: string }) {
  const [src, setSrc] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function load() {
    setState("loading");
    try {
      const token = localStorage.getItem("dfc_admin_token");
      if (!token) throw new Error("no token");
      const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const data = await response.json();
      if (!response.ok || typeof data[field] !== "string") throw new Error("load failed");
      setSrc(data[field]);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  if (src) return <img src={src} alt={label} className="max-h-64 max-w-xs rounded border border-cyan-300/20" />;
  return (
    <button type="button" onClick={() => void load()} disabled={state === "loading"} className="font-bold text-cyan-200 hover:text-white disabled:opacity-50">
      {state === "loading" ? "加载中…" : state === "error" ? "加载失败，重试" : label}
    </button>
  );
}
