// Pure rules for importing an existing KOOK server's members. Transport and
// persistence live in KookMemberImportService so these stay unit-testable.

export type KookGuildMember = { id: string; name: string; identifyNum?: string; roles: string[]; bot: boolean };
export type KookGuildRole = { id: string; name: string };
export type MemberGroups = {
  bound: KookGuildMember[];
  staff: KookGuildMember[];
  companions: KookGuildMember[];
  customers: KookGuildMember[];
  bots: number;
};

const NAME_MAX = 40;

export function parseGuildMember(raw: unknown): KookGuildMember | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as { id?: unknown; nickname?: unknown; username?: unknown; identify_num?: unknown; roles?: unknown; bot?: unknown };
  const id = String(item.id ?? "");
  if (!/^\d{1,32}$/.test(id)) return null;
  const nickname = typeof item.nickname === "string" ? item.nickname : "";
  const username = typeof item.username === "string" ? item.username : "";
  return {
    id,
    name: importDisplayName(nickname || username, id),
    identifyNum: typeof item.identify_num === "string" && /^\d{1,8}$/.test(item.identify_num) ? item.identify_num : undefined,
    roles: Array.isArray(item.roles) ? item.roles.map(String) : [],
    bot: item.bot === true
  };
}

export function importDisplayName(raw: string, id: string) {
  // Drop control characters and collapse spaces; KOOK nicknames are user-controlled.
  const cleaned = raw.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return (cleaned || `KOOK用户${id.slice(-6)}`).slice(0, NAME_MAX);
}

// Fallback names tried in order when a display name is already taken in the same role.
export function displayNameCandidates(member: KookGuildMember) {
  const base = member.name;
  const tag = member.identifyNum ?? member.id.slice(-4);
  return [base, `${base.slice(0, NAME_MAX - tag.length - 1)}#${tag}`, `${base.slice(0, NAME_MAX - member.id.length - 1)}-${member.id}`];
}

export function classifyMembers(
  members: KookGuildMember[],
  boundIds: Set<string>,
  roles: { companionRoleIds: string[]; staffRoleIds: string[] }
): MemberGroups {
  const companionRoles = new Set(roles.companionRoleIds);
  const staffRoles = new Set(roles.staffRoleIds);
  const groups: MemberGroups = { bound: [], staff: [], companions: [], customers: [], bots: 0 };
  const seen = new Set<string>();
  for (const member of members) {
    if (seen.has(member.id)) continue;
    seen.add(member.id);
    if (member.bot) groups.bots += 1;
    else if (boundIds.has(member.id)) groups.bound.push(member);
    // Staff accounts carry admin rights on the website, so they are never auto-created.
    else if (member.roles.some(r => staffRoles.has(r))) groups.staff.push(member);
    else if (member.roles.some(r => companionRoles.has(r))) groups.companions.push(member);
    else groups.customers.push(member);
  }
  return groups;
}

export function customerPlaceholderEmail(kookUserId: string) {
  // Same address the "首次使用" flow and the binding merge already recognise.
  return `customer-kook-${kookUserId}@platform.maycatplay.local`;
}

export function companionPlaceholderEmail(kookUserId: string) {
  return `companion-kook-${kookUserId}@platform.maycatplay.local`;
}
