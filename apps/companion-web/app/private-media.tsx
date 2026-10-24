"use client";

import { useEffect, useState } from "react";

const TOKEN_KEY = "dfc_companion_token";

/**
 * Unlisted uploads are served only with the owner's bearer token, which <img> and <audio> cannot send.
 * Fetch them with it and hand the element a temporary blob URL; public URLs pass straight through.
 */
export function usePrivateMediaUrl(src?: string | null) {
  const [url, setUrl] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    const path = src?.startsWith("/uploads/") ? `/api${src}` : src || undefined;
    if (!path || !path.startsWith("/api/uploads/")) { setUrl(path); return; }
    let token: string | null = null;
    try { token = localStorage.getItem(TOKEN_KEY); } catch { /* fetch without it; the API decides */ }
    let closed = false;
    let objectUrl: string | undefined;
    setUrl(undefined);
    fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store" })
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(String(response.status)))))
      .then((blob) => {
        if (closed) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => { if (!closed) setFailed(true); });
    return () => {
      closed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  return { url, failed };
}

export function PrivateAudio({ src, className }: { src: string; className?: string }) {
  const { url, failed } = usePrivateMediaUrl(src);
  if (failed) return <p className="mt-2 text-xs text-dfc-muted">试音暂时无法播放，请刷新页面</p>;
  return url ? <audio controls src={url} className={className} /> : null;
}
