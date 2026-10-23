import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { BotPlatform, CompanionProfileStatus, GameCode, Prisma, UserRole } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { createPasswordHash } from "../auth/password.util";
import { normalizeDisplayNameKey } from "../auth/display-name.util";
import { PrismaService } from "../prisma/prisma.service";
import {
  classifyMembers, companionPlaceholderEmail, customerPlaceholderEmail, displayNameCandidates,
  KookGuildMember, KookGuildRole, parseGuildMember
} from "./kook-member-import";

const KOOK_API = "https://www.kookapp.cn";
const PAGE_SIZE = 100;
const MAX_PAGES = 500; // 50,000 members
const CACHE_MS = 10 * 60 * 1000;
const BATCH_LIMIT = 200;

type RoleSelection = { companionRoleIds?: unknown; staffRoleIds?: unknown };
export type ImportRequest = RoleSelection & { kind?: unknown; pricePerHour?: unknown; memberIds?: unknown };

@Injectable()
export class KookMemberImportService {
  private readonly logger = new Logger(KookMemberImportService.name);
  private cache?: { guildId: string; at: number; members: KookGuildMember[]; roles: KookGuildRole[] };

  constructor(private readonly prisma: PrismaService) {}

  async preview(selection: RoleSelection, refresh: boolean) {
    const { guildId, members, roles } = await this.loadGuild(refresh);
    const roleIds = this.resolveRoles(selection, roles);
    const groups = classifyMembers(members, await this.boundKookIds(), roleIds);
    const roleCounts = new Map<string, number>();
    for (const member of members) for (const role of member.roles) roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
    return {
      guildId,
      total: members.length,
      roles: roles.map(role => ({ ...role, memberCount: roleCounts.get(role.id) ?? 0 })),
      selection: roleIds,
      counts: { bound: groups.bound.length, staff: groups.staff.length, companions: groups.companions.length, customers: groups.customers.length, bots: groups.bots },
      companions: groups.companions.map(m => ({ id: m.id, name: m.name })),
      customerSample: groups.customers.slice(0, 20).map(m => ({ id: m.id, name: m.name }))
    };
  }

  // Creates at most BATCH_LIMIT accounts per call so a large server never hits an HTTP timeout;
  // the admin page calls again until `remaining` is 0. Already-bound members are always skipped.
  async importBatch(actorId: string, body: ImportRequest) {
    const kind = body.kind === "companions" ? "companions" : body.kind === "customers" ? "customers" : null;
    if (!kind) throw new BadRequestException("kind 必须是 companions 或 customers");
    const { members, roles } = await this.loadGuild(false);
    const roleIds = this.resolveRoles(body, roles);
    let pending = classifyMembers(members, await this.boundKookIds(), roleIds)[kind];
    let price: Prisma.Decimal | undefined;
    if (kind === "companions") {
      if (!roleIds.companionRoleIds.length) throw new BadRequestException("请先选择代表陪玩的 KOOK 角色");
      price = parsePrice(body.pricePerHour);
      if (Array.isArray(body.memberIds)) {
        const chosen = new Set(body.memberIds.map(String));
        pending = pending.filter(m => chosen.has(m.id));
      }
    }

    const batch = pending.slice(0, BATCH_LIMIT);
    // Imported accounts sign in through KOOK only; nobody knows this password.
    const passwordHash = await createPasswordHash(randomBytes(32).toString("hex"));
    let created = 0;
    let skipped = 0;
    for (const member of batch) {
      try {
        const ok = kind === "companions"
          ? await this.createCompanion(member, passwordHash, price!)
          : await this.createCustomer(member, passwordHash);
        if (ok) created += 1; else skipped += 1;
      } catch (error) {
        skipped += 1;
        this.logger.warn(`KOOK member ${member.id} import skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await this.prisma.adminLog.create({ data: {
      actorId, action: kind === "companions" ? "IMPORT_KOOK_COMPANIONS" : "IMPORT_KOOK_CUSTOMERS",
      entityType: "USER_EXTERNAL_ACCOUNT", entityId: "kook-member-import",
      detail: { created, skipped, companionRoleIds: roleIds.companionRoleIds, pricePerHour: price?.toString() ?? null }
    } });
    return { created, skipped, remaining: Math.max(0, pending.length - batch.length) };
  }

  private async createCustomer(member: KookGuildMember, passwordHash: string) {
    return this.prisma.$transaction(async tx => {
      if (await this.isTaken(tx, member.id, customerPlaceholderEmail(member.id))) return false;
      const displayName = await this.freeDisplayName(tx, member, UserRole.CUSTOMER);
      await tx.user.create({ data: {
        email: customerPlaceholderEmail(member.id), passwordHash, role: UserRole.CUSTOMER,
        displayName, displayNameKey: normalizeDisplayNameKey(displayName), referralCode: referralCode("C"),
        wallet: { create: {} },
        externalAccounts: { create: { platform: BotPlatform.KOOK, externalUserId: member.id, displayName: member.name } }
      } });
      return true;
    });
  }

  private async createCompanion(member: KookGuildMember, passwordHash: string, pricePerHour: Prisma.Decimal) {
    return this.prisma.$transaction(async tx => {
      if (await this.isTaken(tx, member.id, companionPlaceholderEmail(member.id))) return false;
      const displayName = await this.freeDisplayName(tx, member, UserRole.COMPANION);
      await tx.user.create({ data: {
        email: companionPlaceholderEmail(member.id), passwordHash, role: UserRole.COMPANION,
        displayName, displayNameKey: normalizeDisplayNameKey(displayName), referralCode: referralCode("P"),
        wallet: { create: {} },
        externalAccounts: { create: { platform: BotPlatform.KOOK, externalUserId: member.id, displayName: member.name } },
        // The club already certified these members with a KOOK role, so they are listed straight away;
        // prices, games and photos can be refined later on the companion page.
        companionProfile: { create: {
          nickname: displayName, game: GameCode.DELTA_FORCE, games: [GameCode.DELTA_FORCE], skillModes: [],
          pricePerHour, status: CompanionProfileStatus.LISTED
        } }
      } });
      return true;
    });
  }

  private async isTaken(tx: Prisma.TransactionClient, kookUserId: string, email: string) {
    const [account, user] = await Promise.all([
      tx.userExternalAccount.findUnique({ where: { platform_externalUserId: { platform: BotPlatform.KOOK, externalUserId: kookUserId } }, select: { id: true } }),
      tx.user.findUnique({ where: { email }, select: { id: true } })
    ]);
    return Boolean(account || user);
  }

  private async freeDisplayName(tx: Prisma.TransactionClient, member: KookGuildMember, role: UserRole) {
    for (const name of displayNameCandidates(member)) {
      const key = normalizeDisplayNameKey(name);
      const userTaken = await tx.user.findUnique({ where: { role_displayNameKey: { role, displayNameKey: key } }, select: { id: true } });
      const nicknameTaken = role === UserRole.COMPANION
        && await tx.companionProfile.findFirst({ where: { nickname: { equals: name, mode: "insensitive" } }, select: { id: true } });
      if (!userTaken && !nicknameTaken) return name;
    }
    throw new BadRequestException("昵称冲突，无法自动命名");
  }

  private async boundKookIds() {
    const rows = await this.prisma.userExternalAccount.findMany({ where: { platform: BotPlatform.KOOK }, select: { externalUserId: true } });
    return new Set(rows.map(r => r.externalUserId));
  }

  private resolveRoles(selection: RoleSelection, roles: KookGuildRole[]) {
    const known = new Set(roles.map(r => r.id));
    const pick = (value: unknown, fallback: Array<string | undefined>) => {
      const ids = Array.isArray(value) ? value.map(String) : fallback.filter((id): id is string => Boolean(id?.trim()));
      return [...new Set(ids.map(id => id.trim()))].filter(id => known.has(id));
    };
    return {
      companionRoleIds: pick(selection.companionRoleIds, [process.env.KOOK_COMPANION_ROLE_ID]),
      staffRoleIds: pick(selection.staffRoleIds, [process.env.KOOK_ADMIN_ROLE_ID, process.env.KOOK_SUPER_ADMIN_ROLE_ID, process.env.KOOK_SUPPORT_ROLE_ID])
    };
  }

  private async loadGuild(refresh: boolean) {
    const token = process.env.KOOK_TOKEN?.trim();
    const guildId = process.env.KOOK_GUILD_ID?.trim();
    if (!token || !guildId) throw new BadRequestException("还没有配置 KOOK 机器人（KOOK_TOKEN / KOOK_GUILD_ID）");
    if (!refresh && this.cache && this.cache.guildId === guildId && Date.now() - this.cache.at < CACHE_MS) return this.cache;

    const members: KookGuildMember[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const data = await this.kookGet<{ items?: unknown[]; meta?: { page_total?: number } }>(token, "/api/v3/guild/user-list",
        { guild_id: guildId, page: String(page), page_size: String(PAGE_SIZE) });
      for (const raw of data.items ?? []) {
        const member = parseGuildMember(raw);
        if (member) members.push(member);
      }
      if (page >= Number(data.meta?.page_total ?? 1)) break;
    }
    const roleData = await this.kookGet<{ items?: Array<{ role_id?: unknown; name?: unknown }> }>(token, "/api/v3/guild-role/list",
      { guild_id: guildId, page_size: "100" });
    const roles = (roleData.items ?? [])
      .map(r => ({ id: String(r.role_id ?? ""), name: typeof r.name === "string" ? r.name.slice(0, 40) : "" }))
      .filter(r => /^\d+$/.test(r.id) && r.id !== "0");
    this.cache = { guildId, at: Date.now(), members, roles };
    return this.cache;
  }

  private async kookGet<T>(token: string, path: string, query: Record<string, string>) {
    const response = await fetch(`${KOOK_API}${path}?${new URLSearchParams(query).toString()}`, { headers: { Authorization: `Bot ${token}` } });
    if (!response.ok) throw new BadRequestException(`读取 KOOK 服务器失败（HTTP ${response.status}），请确认机器人已加入服务器`);
    const result = (await response.json()) as { code?: number; message?: string; data?: T };
    if (result.code !== 0 || !result.data) throw new BadRequestException(`读取 KOOK 服务器失败：${result.message ?? "未知错误"}`);
    return result.data;
  }
}

function parsePrice(value: unknown) {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text) || Number(text) <= 0) throw new BadRequestException("请填写陪玩默认时薪（大于0，最多两位小数）");
  return new Prisma.Decimal(text);
}

function referralCode(prefix: "C" | "P") {
  return `${prefix}${randomBytes(12).toString("hex").toUpperCase()}`;
}
