import { Prisma } from "@prisma/client";

export type CustomerMembershipLevel = {
  level: number;
  name: string;
  minRecharge: string;
  nextMinRecharge: string | null;
  tierKey: string;
  benefits: string[];
};

const CUSTOMER_MEMBERSHIP_TIERS = [
  { level: 1, name: "猫饼会员 Lv.1", minRecharge: 100, envVar: "KOOK_CUSTOMER_LEVEL_1_ROLE_ID", benefits: ["基础会员标识"] },
  { level: 2, name: "猫饼会员 Lv.2", minRecharge: 300, envVar: "KOOK_CUSTOMER_LEVEL_2_ROLE_ID", benefits: ["基础会员标识"] },
  { level: 3, name: "猫饼会员 Lv.3", minRecharge: 500, envVar: "KOOK_CUSTOMER_LEVEL_3_ROLE_ID", benefits: ["基础会员标识"] },
  { level: 4, name: "猫饼会员 Lv.4", minRecharge: 1000, envVar: "KOOK_CUSTOMER_LEVEL_4_ROLE_ID", benefits: ["基础会员标识"] },
  { level: 5, name: "猫饼会员 Lv.5", minRecharge: 2000, envVar: "KOOK_CUSTOMER_LEVEL_5_ROLE_ID", benefits: ["优先人工响应"] },
  { level: 6, name: "猫饼会员 Lv.6", minRecharge: 3000, envVar: "KOOK_CUSTOMER_LEVEL_6_ROLE_ID", benefits: ["优先人工响应"] },
  { level: 7, name: "猫饼会员 Lv.7", minRecharge: 5000, envVar: "KOOK_CUSTOMER_LEVEL_7_ROLE_ID", benefits: ["优先人工响应"] },
  { level: 8, name: "猫饼会员 Lv.8", minRecharge: 8000, envVar: "KOOK_CUSTOMER_LEVEL_8_ROLE_ID", benefits: ["优先人工响应"] },
  { level: 9, name: "猫饼会员 Lv.9", minRecharge: 12000, envVar: "KOOK_CUSTOMER_LEVEL_9_ROLE_ID", benefits: ["优先人工响应"] },
  { level: 10, name: "猫饼会员 Lv.10", minRecharge: 20000, envVar: "KOOK_CUSTOMER_LEVEL_10_ROLE_ID", benefits: ["高优先级客服"] },
  { level: 11, name: "猫饼会员 Lv.11", minRecharge: 30000, envVar: "KOOK_CUSTOMER_LEVEL_11_ROLE_ID", benefits: ["高优先级客服"] },
  { level: 12, name: "猫饼会员 Lv.12", minRecharge: 50000, envVar: "KOOK_CUSTOMER_LEVEL_12_ROLE_ID", benefits: ["高优先级客服"] },
  { level: 13, name: "猫饼会员 Lv.13", minRecharge: 70000, envVar: "KOOK_CUSTOMER_LEVEL_13_ROLE_ID", benefits: ["高优先级客服"] },
  { level: 14, name: "猫饼会员 Lv.14", minRecharge: 90000, envVar: "KOOK_CUSTOMER_LEVEL_14_ROLE_ID", benefits: ["高优先级客服"] },
  { level: 15, name: "猫饼会员 Lv.15", minRecharge: 120000, envVar: "KOOK_CUSTOMER_LEVEL_15_ROLE_ID", benefits: ["高优先级客服", "活动优先名额"] },
  { level: 16, name: "霓虹贵宾", minRecharge: 200000, envVar: "KOOK_CUSTOMER_SPECIAL_NEON_ROLE_ID", benefits: ["私人专属频道", "专属礼物标识", "人工客服优先处理"] },
  { level: 17, name: "May名人堂", minRecharge: 500000, envVar: "KOOK_CUSTOMER_SPECIAL_HALL_ROLE_ID", benefits: ["私人专属频道", "定制专属礼物", "高额打赏赠时优先确认", "人工客服最高优先级"] }
];

export function getCustomerMembershipLevel(totalRecharge: Prisma.Decimal | string | number | null | undefined): CustomerMembershipLevel {
  const total = Number(totalRecharge?.toString() ?? "0");
  let currentTier: (typeof CUSTOMER_MEMBERSHIP_TIERS)[number] | undefined;

  for (const tier of CUSTOMER_MEMBERSHIP_TIERS) {
    if (total >= tier.minRecharge) {
      currentTier = tier;
    }
  }

  const nextTier = CUSTOMER_MEMBERSHIP_TIERS.find((tier) => tier.minRecharge > total);

  return {
    level: currentTier?.level ?? 0,
    name: currentTier?.name ?? "新人",
    minRecharge: (currentTier?.minRecharge ?? 0).toString(),
    nextMinRecharge: nextTier ? nextTier.minRecharge.toString() : null,
    tierKey: currentTier?.envVar ?? "NEW_CUSTOMER",
    benefits: currentTier?.benefits ?? ["未下单客户标签", "人工客服引导"]
  };
}

function getConfiguredCustomerLevelRoles(platform: "KOOK" | "DISCORD") {
  return CUSTOMER_MEMBERSHIP_TIERS.map((tier) => ({
    level: tier.level,
    roleId: process.env[tier.envVar.replace("KOOK_", `${platform}_`)]?.trim()
  })).filter((item): item is { level: number; roleId: string } => Boolean(item.roleId));
}

export function getConfiguredKookCustomerLevelRoles() {
  return getConfiguredCustomerLevelRoles("KOOK");
}

export function getConfiguredDiscordCustomerLevelRoles() {
  return getConfiguredCustomerLevelRoles("DISCORD");
}
