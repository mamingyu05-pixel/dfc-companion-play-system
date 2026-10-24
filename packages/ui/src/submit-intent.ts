/**
 * One request id per money-moving submit intent, kept in sessionStorage so a retry after a lost
 * response, or a resubmit after refreshing the page, reuses it and the server replays the first request.
 * The id changes when what is being submitted changes, and is dropped once the server confirms.
 */
export function submitIntentId(key: string, fingerprint: string): string {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? "null") as { fp?: string; id?: string } | null;
    if (saved?.fp === fingerprint && saved.id) return saved.id;
  } catch { /* storage unavailable: fall through to a fresh id for this attempt */ }
  const id = crypto.randomUUID();
  try { sessionStorage.setItem(key, JSON.stringify({ fp: fingerprint, id })); } catch { /* best effort */ }
  return id;
}

export function clearSubmitIntent(key: string) {
  try { sessionStorage.removeItem(key); } catch { /* best effort */ }
}
