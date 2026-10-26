"use client";

import { useEffect, useRef, useState } from "react";
import { createFixedOrderClient, type FixedOrderKind, type FixedOrderState } from "./fixed-order-client";

export function useFixedOrder(kind: FixedOrderKind) {
  const client = useRef<ReturnType<typeof createFixedOrderClient> | null>(null);
  const active = useRef(false);
  const [state, setState] = useState<FixedOrderState>({ subject: null, connected: false, busy: true, pending: false,
    pendingKind: null, preview: null, receipt: null, error: "" });
  function update() { if (active.current && client.current) setState(client.current.state()); }
  async function perform(action: (value: NonNullable<typeof client.current>) => Promise<FixedOrderState>) {
    const current = client.current;
    if (!current) return;
    const pending = action(current); update(); await pending;
    if (client.current === current) update();
    return current.state();
  }
  useEffect(() => {
    active.current = true;
    try {
      client.current = createFixedOrderClient({ kind, storage: localStorage, fetcher: fetch,
        getToken: () => { try { return localStorage.getItem("dfc_customer_token"); } catch { return null; } },
        makeRequestId: () => crypto.randomUUID(), scope: window.location.origin });
    } catch {
      setState(value => ({ ...value, busy: false, error: "无法读取申请记录，请联系管理员核对，暂不提交新订单。" }));
    }
    function refresh() { void perform(value => value.refresh()); }
    function visible() { if (document.visibilityState === "visible") refresh(); }
    window.addEventListener("storage", refresh); window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible); refresh();
    return () => {
      active.current = false; client.current = null;
      window.removeEventListener("storage", refresh); window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [kind]);
  return { state,
    refresh: () => perform(value => value.refresh()),
    prepare: (selection: { packageId: string; companionId?: string }) => perform(value => value.prepare(selection)),
    submit: (notes: string) => perform(value => value.submit(notes)),
    retry: () => perform(value => value.retry()),
    beginNew: () => perform(value => value.beginNew()),
    canEdit() { const allowed = client.current?.canEdit() ?? false; update(); return allowed; },
    change() { const changed = client.current?.change() ?? false; update(); return changed; },
  };
}
