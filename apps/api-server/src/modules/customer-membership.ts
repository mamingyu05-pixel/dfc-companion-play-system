import { Prisma } from "@prisma/client";

export type CustomerMembershipLevel = {
  level: number;
  name: string;
  minRecharge: string;
  nextMinRecharge: string | null;
};

const CUSTOMER_LEVEL_THRESHOLDS = [1, 50, 100, 200, 500, 800, 1200, 2000, 3000, 5000, 8000, 12000, 20000, 30000, 50000];

export function getCustomerMembershipLevel(totalRecharge: Prisma.Decimal | string | number | null | undefined): CustomerMembershipLevel {
  const total = Number(totalRecharge?.toString() ?? "0");
  let level = 0;

  for (let index = 0; index < CUSTOMER_LEVEL_THRESHOLDS.length; index += 1) {
    if (total >= CUSTOMER_LEVEL_THRESHOLDS[index]) {
      level = index + 1;
    }
  }

  const nextThreshold = level < CUSTOMER_LEVEL_THRESHOLDS.length ? CUSTOMER_LEVEL_THRESHOLDS[level] : null;

  return {
    level,
    name: level > 0 ? `猫饼会员 Lv.${level}` : "新人",
    minRecharge: level > 0 ? CUSTOMER_LEVEL_THRESHOLDS[level - 1].toString() : "0",
    nextMinRecharge: nextThreshold === null ? null : nextThreshold.toString()
  };
}

export function getConfiguredKookCustomerLevelRoles() {
  return CUSTOMER_LEVEL_THRESHOLDS.map((_, index) => ({
    level: index + 1,
    roleId: process.env[`KOOK_CUSTOMER_LEVEL_${index + 1}_ROLE_ID`]?.trim()
  })).filter((item): item is { level: number; roleId: string } => Boolean(item.roleId));
}
