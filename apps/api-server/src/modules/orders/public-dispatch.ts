import { ServicePriceTier } from "@prisma/client";

// Public dispatch never interpolates free text from a private demand or note.
export function publicServiceLabel(tier: ServicePriceTier): string {
  return { ENTERTAINMENT: "娱乐陪玩", RANKED: "上分陪玩", HIGH_RANKED: "高段位陪玩", CUSTOM: "定制服务（详情联系授权客服）" }[tier];
}
