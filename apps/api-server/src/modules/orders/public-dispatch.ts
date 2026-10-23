import { ServicePriceTier } from "@prisma/client";

// Standard modes staff pick from a fixed list; only these exact values may appear in a public channel.
const PUBLIC_MODES = new Set(["烽火地带", "全面战场", "娱乐陪玩", "排位上分"]);

const GAME_LABELS: Record<string, string> = {
  DELTA_FORCE: "三角洲行动", LEAGUE_OF_LEGENDS: "英雄联盟", VALORANT: "无畏契约", COUNTER_STRIKE_2: "CS2",
  PUBG: "PUBG 绝地求生", APEX_LEGENDS: "Apex 英雄", NARAKA_BLADEPOINT: "永劫无间", CALL_OF_DUTY: "塔科夫 / COD",
  HONOR_OF_KINGS: "王者荣耀", PEACEKEEPER_ELITE: "和平精英"
};

// Public dispatch never interpolates free text from a private demand or note: a mode is shown
// only when it is one of the standard values, otherwise the price tier's generic label is used.
export function publicServiceLabel(tier: ServicePriceTier, mode?: string | null, serviceKind?: string | null): string {
  const standard = mode?.trim();
  if (standard && PUBLIC_MODES.has(standard)) return standard;
  // Guarantee tiers and service packages are named by the system or by staff, never by the customer.
  if (standard && (serviceKind === "GUARANTEE" || serviceKind === "PACKAGE")) return serviceKind === "PACKAGE" ? `套餐 · ${standard}` : standard;
  return { ENTERTAINMENT: "娱乐陪玩", RANKED: "上分陪玩", HIGH_RANKED: "高段位陪玩", CUSTOM: "定制服务（详情联系授权客服）" }[tier];
}

export function publicGameLabel(game: string): string {
  return GAME_LABELS[game] ?? game;
}
