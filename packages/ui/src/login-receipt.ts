export type LoginReceiptUser = { id: string; displayName: string; role: string };
export type LoginReceiptResult =
  | { ok: true; accessToken: string; user: LoginReceiptUser; platform: string; confirm: boolean }
  | { ok: false; message: string };

/**
 * Reads the callback URL (errors in the query, the one-time receipt in the fragment), wipes it from the
 * address bar, and trades the receipt for a session. The API only accepts it from the browser that
 * started the login, so a crafted link opened elsewhere cannot swap in someone else's account.
 */
export async function redeemLoginReceipt(fallbackError: string): Promise<LoginReceiptResult> {
  const params = new URLSearchParams(window.location.search);
  new URLSearchParams(window.location.hash.slice(1)).forEach((value, key) => params.set(key, value));
  window.history.replaceState(null, "", window.location.pathname);
  const error = params.get("error");
  const receipt = params.get("receipt");
  if (error || !receipt) return { ok: false, message: error || fallbackError };
  try {
    const response = await fetch("/api/auth/login-receipt", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receipt })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.accessToken !== "string" || !data.user) {
      const message = Array.isArray(data.message) ? data.message.join("；") : data.message;
      return { ok: false, message: message || fallbackError };
    }
    return { ok: true, accessToken: data.accessToken, user: data.user, platform: String(data.platform ?? ""), confirm: data.confirm === true };
  } catch {
    return { ok: false, message: "网络不稳定，登录没有完成，请重新登录。" };
  }
}

/** Display name of the account already signed in on this portal, if any. */
export function currentPortalUser(storageKey: string): string | null {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as { displayName?: string }).displayName ?? null : null;
  } catch {
    return null;
  }
}
