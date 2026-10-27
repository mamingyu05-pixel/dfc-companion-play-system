import { BadRequestException } from "@nestjs/common";
import { BotPlatform, Prisma, UserRole, UserStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

type DirectoryQuery = { q?: unknown; page?: unknown; limit?: unknown };
type OptionsQuery = { q?: unknown; purpose?: unknown; selectedId?: unknown; limit?: unknown };
type OptionPurpose = "balance-adjustment" | "companion-onboarding" | "password-reset" | "admin-promotion";
const orderBy = [{ createdAt: "desc" }, { id: "desc" }] as const;
const displaySelect = {
  id: true, email: true, role: true, status: true, displayName: true, createdAt: true,
  wallet: { select: { availableBalance: true, frozenBalance: true, availableIncome: true, pendingIncome: true } },
  companionProfile: { select: { nickname: true, game: true, status: true, onlineStatus: true,
    pricePerHour: true, kookPricePerHour: true, discordPricePerHour: true, entertainmentPricePerHour: true,
    rankedPricePerHour: true, highRankedPricePerHour: true } },
  externalAccounts: { select: { platform: true, externalUserId: true, displayName: true } }
} as const;
type DisplayUser = Prisma.UserGetPayload<{ select: typeof displaySelect }>;

// This is the same conjunction excluded by the existing client. Do not hide unrelated banned users.
const visible: Prisma.UserWhereInput = { NOT: { AND: [
  { status: UserStatus.BANNED }, { email: { endsWith: "@platform.maycatplay.local" } },
  { displayName: { startsWith: "Merged platform placeholder " } }
] } };
function positiveInteger(value: unknown, fallback: number, field: string, maximum?: number) {
  if (value === undefined || value === "") return fallback;
  if ((typeof value !== "string" && typeof value !== "number") || !/^[1-9]\d*$/.test(String(value))) {
    throw new BadRequestException(field + "必须是正整数");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new BadRequestException(field + "超出有效范围");
  return maximum ? Math.min(parsed, maximum) : parsed;
}
function text(value: unknown, field: string) {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > 512) throw new BadRequestException(field + "必须是最多512字的文本");
  return value.trim();
}
function searchWhere(value: unknown): Prisma.UserWhereInput {
  const query = text(value, "搜索词");
  if (!query) return {};
  const roleNames: Record<UserRole, string[]> = {
    CUSTOMER: ["customer", "客户"], COMPANION: ["companion", "陪玩"],
    ADMIN: ["admin", "管理员"], SUPER_ADMIN: ["super_admin", "超级管理员"]
  };
  const statusNames: Record<UserStatus, string[]> = {
    ACTIVE: ["active", "正常"], BANNED: ["banned", "封禁", "已封禁"]
  };
  return { AND: query.toLowerCase().split(/\s+/).map(token => {
    // Prisma's PostgreSQL contains uses LIKE/ILIKE. Escape metacharacters so searching a name is literal.
    const literal = token.replace(/[\\%_]/g, "\\$&");
    const contains = { contains: literal, mode: "insensitive" as const };
    const roles = Object.values(UserRole).filter(role => roleNames[role].some(name => name.includes(token)));
    const statuses = Object.values(UserStatus).filter(status => statusNames[status].some(name => name.includes(token)));
    const platforms = Object.values(BotPlatform).filter(platform => platform.toLowerCase().includes(token));
    const matches: Prisma.UserWhereInput[] = [
      { id: contains }, { displayName: contains }, { email: contains },
      { companionProfile: { is: { nickname: contains } } },
      { externalAccounts: { some: { OR: [
        { externalUserId: contains }, { displayName: contains }, ...(platforms.length ? [{ platform: { in: platforms } }] : [])
      ] } } }
    ];
    if (roles.length) matches.push({ role: { in: roles } });
    if (statuses.length) matches.push({ status: { in: statuses } });
    return { OR: matches };
  }) };
}
function display(user: DisplayUser) {
  return {
    ...user,
    wallet: user.wallet ? {
      availableBalance: user.wallet.availableBalance.toString(), frozenBalance: user.wallet.frozenBalance.toString(),
      availableIncome: user.wallet.availableIncome.toString(), pendingIncome: user.wallet.pendingIncome.toString()
    } : null,
    companionProfile: user.companionProfile ? {
      ...user.companionProfile,
      pricePerHour: user.companionProfile.pricePerHour.toString(),
      kookPricePerHour: user.companionProfile.kookPricePerHour?.toString() ?? null,
      discordPricePerHour: user.companionProfile.discordPricePerHour?.toString() ?? null,
      entertainmentPricePerHour: user.companionProfile.entertainmentPricePerHour?.toString() ?? null,
      rankedPricePerHour: user.companionProfile.rankedPricePerHour?.toString() ?? null,
      highRankedPricePerHour: user.companionProfile.highRankedPricePerHour?.toString() ?? null
    } : null
  };
}
export async function listAdminUserDirectory(prisma: PrismaService, query: DirectoryQuery) {
  const page = positiveInteger(query.page, 1, "页码"), limit = positiveInteger(query.limit, 50, "每页数量", 100);
  const skip = (page - 1) * limit;
  if (!Number.isSafeInteger(skip) || skip > 2_147_483_647) throw new BadRequestException("页码超出有效范围");
  const where: Prisma.UserWhereInput = { AND: [visible, searchWhere(query.q)] };
  const groupsQuery = prisma.user.groupBy({ by: ["role", "status"], where: visible,
    _count: { _all: true }, orderBy: [{ role: "asc" }, { status: "asc" }] });
  const [users, total, groups, companions] = await prisma.$transaction([
    prisma.user.findMany({ where, orderBy: [...orderBy], skip, take: limit, select: displaySelect }),
    prisma.user.count({ where }),
    groupsQuery,
    prisma.user.count({ where: { AND: [visible, { companionProfile: { isNot: null } }] } })
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  const stats = { customers: 0, companions, admins: 0, banned: 0 };
  for (const group of groups) {
    if (group.role === UserRole.CUSTOMER) stats.customers += group._count._all;
    if (group.role === UserRole.ADMIN || group.role === UserRole.SUPER_ADMIN) stats.admins += group._count._all;
    if (group.status === UserStatus.BANNED) stats.banned += group._count._all;
  }
  return { items: users.map(display), total, page, limit, stats };
}
function eligibility(purpose: OptionPurpose): Prisma.UserWhereInput {
  switch (purpose) {
    // The adjustment service itself accepts only active customer wallets; this does not change write rules.
    case "balance-adjustment": return { status: UserStatus.ACTIVE, role: UserRole.CUSTOMER, wallet: { isNot: null } };
    case "companion-onboarding": return { status: UserStatus.ACTIVE, companionProfile: { is: null } };
    case "password-reset":
    case "admin-promotion": return { status: UserStatus.ACTIVE };
  }
}
export async function listAdminUserOptions(prisma: PrismaService, query: OptionsQuery) {
  if (typeof query.purpose !== "string" || !["balance-adjustment", "companion-onboarding", "password-reset", "admin-promotion"].includes(query.purpose)) {
    throw new BadRequestException("请选择有效的用户查询用途");
  }
  const purpose = query.purpose as OptionPurpose, limit = positiveInteger(query.limit, 25, "候选数量", 50);
  const selectedId = text(query.selectedId, "所选用户"), search = searchWhere(query.q);
  const eligible: Prisma.UserWhereInput = { AND: [visible, eligibility(purpose)] };
  return prisma.$transaction(async tx => {
    const selected = selectedId ? await tx.user.findFirst({ where: { AND: [eligible, { id: selectedId }] }, select: displaySelect }) : null;
    const remaining = limit - (selected ? 1 : 0);
    const users = await tx.user.findMany({
      where: { AND: [eligible, search, ...(selected ? [{ id: { not: selected.id } }] : [])] },
      orderBy: [...orderBy], take: remaining + 1, select: displaySelect
    });
    return { purpose, selectedId: selected?.id ?? null, items: [
      ...(selected ? [display(selected)] : []), ...users.slice(0, remaining).map(display)
    ], hasMore: users.length > remaining, limit };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
