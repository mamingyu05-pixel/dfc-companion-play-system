"use client";

import { useEffect, useState } from "react";
import { ActionButton, DataTable } from "../components";

type GameRankPrice = { id: string; game: string; tierKey: string; tierName: string; unitPrice: string; sortOrder: number; isActive: boolean };
type Draft = { tierName: string; unitPrice: string; isActive: boolean };

const gameNames: Record<string, string> = {
  DELTA_FORCE: "三角洲行动", LEAGUE_OF_LEGENDS: "英雄联盟", VALORANT: "无畏契约", COUNTER_STRIKE_2: "CS2",
  PUBG: "PUBG", APEX_LEGENDS: "Apex 英雄", NARAKA_BLADEPOINT: "永劫无间", CALL_OF_DUTY: "塔科夫 / COD"
};

export function RankPriceSection() {
  const [rankPrices, setRankPrices] = useState<GameRankPrice[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function load() {
    const token = localStorage.getItem("dfc_admin_token");
    if (!token) return;
    const response = await fetch("/api/admin/game-rank-prices", { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error("load rank prices failed");
    const data = (await response.json()) as GameRankPrice[];
    setRankPrices(data);
    setDrafts(Object.fromEntries(data.map((item) => [item.id, { tierName: item.tierName, unitPrice: item.unitPrice, isActive: item.isActive }])));
  }
  useEffect(() => { void load().catch(() => setError("无法加载段位价目")); }, []);

  async function save(id: string) {
    const token = localStorage.getItem("dfc_admin_token");
    const value = drafts[id];
    if (!token || !value) return;
    setError(""); setStatus("");
    const response = await fetch(`/api/admin/game-rank-prices/${id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(value)
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    if (!response.ok) {
      const message = Array.isArray(data.message) ? data.message.join(", ") : data.message;
      setError(message && message.includes("valid amount") ? "请输入正确数字" : message || "保存失败");
      return;
    }
    setStatus("段位价已保存，后续成单会立即按新价格计算");
    await load();
  }

  return (
    <section className="admin-panel">
      <h2 className="text-base font-black text-white">小时陪玩 · 游戏段位价目</h2>
      <p className="mt-1 text-xs leading-5 text-dfc-muted">成单按游戏 × 段位/档位读取平台单价；保存后新订单立即生效，已下的单不变。</p>
      {error ? <p role="alert" className="mt-3 text-sm text-dfc-danger">{error}</p> : null}
      {status ? <p role="status" className="mt-3 text-sm text-dfc-success">{status}</p> : null}
      <div className="mt-5">
        <DataTable
          columns={["游戏", "档位 key", "档位名", "平台单价", "状态", "操作"]}
          rows={rankPrices.map((item) => {
            const value = drafts[item.id] ?? { tierName: item.tierName, unitPrice: item.unitPrice, isActive: item.isActive };
            const set = (next: Partial<Draft>) => setDrafts({ ...drafts, [item.id]: { ...value, ...next } });
            return [
              gameNames[item.game] ?? item.game,
              <span key={`${item.id}-key`} className="font-mono text-xs text-dfc-muted">{item.tierKey}</span>,
              <input key={`${item.id}-name`} value={value.tierName} onChange={(event) => set({ tierName: event.target.value })} className="input min-w-28" />,
              <input key={`${item.id}-price`} value={value.unitPrice} onChange={(event) => set({ unitPrice: event.target.value })} className="input w-28" inputMode="decimal" />,
              <label key={`${item.id}-active`} className="inline-flex items-center gap-2 text-xs font-semibold text-dfc-subtext">
                <input type="checkbox" checked={value.isActive} onChange={(event) => set({ isActive: event.target.checked })} className="accent-cyan-300" />
                启用
              </label>,
              <ActionButton key={`${item.id}-save`} tone="secondary" onClick={() => void save(item.id)}>保存</ActionButton>
            ];
          })}
        />
      </div>
    </section>
  );
}
