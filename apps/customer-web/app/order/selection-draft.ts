import type { OrderView, Selection } from "./order-client";
import { ORDER_HOURS, ORDER_MODES } from "./order-entry";

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const defaults = (): Selection => ({ companionId: "", mode: "烽火地带", hours: "1" });
const maxAge = 2 * 60 * 60 * 1000;
const validSelection = (value: unknown): value is Selection => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const selection = value as Selection;
  return typeof selection.companionId === "string" && selection.companionId.length <= 128 &&
    !/[\u0000-\u001f\u007f]/.test(selection.companionId) &&
    ORDER_MODES.includes(selection.mode) && ORDER_HOURS.includes(selection.hours);
};
const selectionOnly = (selection: Selection): Selection => ({
  companionId: selection.companionId, mode: selection.mode, hours: selection.hours
});

/** Convenience input only. This namespace never reads or clears an order-request journal. */
export function createSelectionDraft({ storage, scope, now = () => Date.now() }: {
  storage: DraftStorage | null; scope: string; now?: () => number;
}) {
  const key = (subject: string) => {
    if (!subject || subject.length > 128 || !scope || scope.length > 512) throw new Error("Invalid draft scope");
    return `dfc.web-selection.v1:${encodeURIComponent(scope)}:${encodeURIComponent(subject)}`;
  };
  function clear(subject: string) {
    try { storage?.removeItem(key(subject)); } catch { /* Draft cleanup never changes order recovery. */ }
  }
  return {
    clear,
    save(subject: string, selection: Selection): string {
      if (!validSelection(selection)) return "当前选择无法保存，刷新后可能需要重选。";
      try {
        if (!storage) throw new Error("Storage unavailable");
        storage.setItem(key(subject), JSON.stringify({ version: 1, savedAt: now(), selection: selectionOnly(selection) }));
        return "";
      } catch { return "选择暂未保存，刷新后可能需要重选。"; }
    },
    restore(subject: string, view: Pick<OrderView, "connected" | "busy" | "error" | "pending" | "receipt" | "companions">, search: string) {
      if (!subject || !view.connected || view.busy || view.error || view.pending || view.receipt) return null;
      let selection = defaults(), message = "";
      try {
        if (!storage) throw new Error("Storage unavailable");
        const raw = storage.getItem(key(subject));
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved?.version !== 1 || !Number.isSafeInteger(saved.savedAt) || !validSelection(saved.selection)) {
            clear(subject); message = "上次选择无法恢复，请重新选择。";
          } else if (saved.savedAt > now() || now() - saved.savedAt >= maxAge) {
            clear(subject); message = "上次选择已过期，请重新选择。";
          } else {
            selection = selectionOnly(saved.selection);
            message = "已恢复本标签页的选择，请重新核对陪玩状态与金额。";
            if (selection.companionId && !view.companions.some(companion => companion.id === selection.companionId)) {
              selection.companionId = "";
              message = "上次选择的陪玩暂时不能下单，请另选；模式和时长已保留。";
            }
          }
        }
      } catch { message = "上次选择暂时无法读取，请重新选择。"; }
      const params = new URLSearchParams(search);
      const requested = params.get("companionId"), mode = params.get("mode"), hours = params.get("hours");
      const prefilled: string[] = [];
      let ignored = false;
      if (mode !== null) {
        if (ORDER_MODES.includes(mode)) { selection.mode = mode; prefilled.push("模式"); } else ignored = true;
      }
      if (hours !== null) {
        if (ORDER_HOURS.includes(hours)) { selection.hours = hours; prefilled.push("时长"); } else ignored = true;
      }
      const carried = prefilled.join("和");
      if (requested) {
        selection.companionId = view.companions.some(companion => companion.id === requested) ? requested : "";
        message = selection.companionId
          ? carried ? `已带入上一单的陪玩、${carried}，请重新核对状态与金额。` : "已带入当前入口的陪玩，请重新核对状态与金额。"
          : carried ? `这位陪玩暂时不能下单，请另选；${carried}已带入。` : "这位陪玩暂时不能下单，请另选";
      } else if (carried) {
        message = `已带入${carried}，请选择陪玩并核对金额。`;
      }
      if (ignored) message = `${message.replace(/。$/, "")}${message ? "；" : ""}链接中的部分选项无效，已忽略。`;
      return { selection, message };
    }
  };
}
