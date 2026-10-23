import { randomInt, randomUUID } from "node:crypto";
import { BotPlatform } from "@prisma/client";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { KookMemberImportService } from "../src/modules/admin/kook-member-import.service";
import { classifyMembers, displayNameCandidates, parseGuildMember } from "../src/modules/admin/kook-member-import";
import { migrateSafePlatformPlaceholderAccount } from "../src/modules/auth/platform-account-merge.util";
import { createConfirmedKookCustomer } from "../src/modules/kook/kook-customer-onboarding";

const prisma = new PrismaService();
beforeAll(() => prisma.$connect());
afterAll(() => prisma.$disconnect());
afterEach(() => { delete process.env.KOOK_TOKEN; delete process.env.KOOK_GUILD_ID; jest.restoreAllMocks(); });

const kookId = () => String(randomInt(10 ** 9, 2 ** 47));
const COMPANION_ROLE = "9101";
const STAFF_ROLE = "9102";

async function adminUser() {
  const id = randomUUID();
  return prisma.user.create({ data: { email: `${id}@synthetic.invalid`, displayName: id, displayNameKey: id, passwordHash: "synthetic", role: "ADMIN" } });
}

// Serves a fake guild split over two pages, the way KOOK paginates guild/user-list.
function mockGuild(members: unknown[]) {
  const pages = [members.slice(0, 3), members.slice(3)];
  const calls: string[] = [];
  jest.spyOn(globalThis, "fetch").mockImplementation(async input => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, message: "", data }), { status: 200 });
    if (url.pathname === "/api/v3/guild-role/list") {
      return ok({ items: [{ role_id: 0, name: "@全体成员" }, { role_id: Number(COMPANION_ROLE), name: "认证陪玩" }, { role_id: Number(STAFF_ROLE), name: "客服" }] });
    }
    if (url.pathname === "/api/v3/guild/user-list") {
      const page = Number(url.searchParams.get("page"));
      return ok({ items: pages[page - 1] ?? [], meta: { page, page_total: pages.length } });
    }
    return new Response("not found", { status: 404 });
  });
  return calls;
}

test("member rules: parse, classify and fall back to distinct names", () => {
  expect(parseGuildMember({ id: "abc" })).toBeNull();
  const m = parseGuildMember({ id: 12345678, nickname: " 小\n猫  饼 ", username: "x", identify_num: "0420", roles: [1, 2], bot: false })!;
  expect(m).toEqual({ id: "12345678", name: "小猫 饼", identifyNum: "0420", roles: ["1", "2"], bot: false });
  expect(parseGuildMember({ id: "99887766", nickname: "", username: "" })!.name).toBe("KOOK用户887766");
  expect(displayNameCandidates(m)).toEqual(["小猫 饼", "小猫 饼#0420", "小猫 饼-12345678"]);

  const member = (id: string, roles: string[] = [], bot = false) => ({ id, name: id, roles, bot });
  const groups = classifyMembers(
    [member("1"), member("2", ["c"]), member("3", ["c", "s"]), member("4", [], true), member("5"), member("1")],
    new Set(["5"]), { companionRoleIds: ["c"], staffRoleIds: ["s"] });
  expect(groups.customers.map(m => m.id)).toEqual(["1"]);
  expect(groups.companions.map(m => m.id)).toEqual(["2"]);
  expect(groups.staff.map(m => m.id)).toEqual(["3"]);
  expect(groups.bound.map(m => m.id)).toEqual(["5"]);
  expect(groups.bots).toBe(1);
});

test("imports a KOOK server: companions listed and bound, customers as mergeable placeholders, reruns are no-ops", async () => {
  const actor = await adminUser();
  const ids = { companion: kookId(), customer: kookId(), clash: kookId(), staff: kookId(), bot: kookId(), bound: kookId() };
  const tag = randomUUID().slice(0, 8);
  // An existing customer already uses the clash member's nickname, so the import must pick a suffixed name.
  await prisma.user.create({ data: { email: `${randomUUID()}@synthetic.invalid`, displayName: `撞名${tag}`, displayNameKey: `撞名${tag}`, passwordHash: "x", role: "CUSTOMER" } });
  const alreadyBound = await adminUser();
  await prisma.userExternalAccount.create({ data: { userId: alreadyBound.id, platform: BotPlatform.KOOK, externalUserId: ids.bound } });

  process.env.KOOK_TOKEN = "synthetic-token";
  process.env.KOOK_GUILD_ID = "1234567";
  const calls = mockGuild([
    { id: ids.companion, nickname: `阿狸${tag}`, roles: [Number(COMPANION_ROLE)] },
    { id: ids.customer, username: `客户${tag}`, roles: [] },
    { id: ids.clash, nickname: `撞名${tag}`, identify_num: "7788", roles: [] },
    { id: ids.staff, nickname: "客服", roles: [Number(STAFF_ROLE), Number(COMPANION_ROLE)] },
    { id: ids.bot, nickname: "机器人", bot: true },
    { id: ids.bound, nickname: "老客户" }
  ]);
  const service = new KookMemberImportService(prisma);
  const selection = { companionRoleIds: [COMPANION_ROLE], staffRoleIds: [STAFF_ROLE, "424242"] };

  const preview = await service.preview(selection, true);
  expect(preview.total).toBe(6);
  expect(preview.selection).toEqual({ companionRoleIds: [COMPANION_ROLE], staffRoleIds: [STAFF_ROLE] }); // unknown role dropped
  expect(preview.counts).toEqual({ bound: 1, staff: 1, companions: 1, customers: 2, bots: 1 });
  expect(preview.roles.find(r => r.id === COMPANION_ROLE)?.memberCount).toBe(2);
  expect(calls.filter(p => p === "/api/v3/guild/user-list")).toHaveLength(2);

  await expect(service.importBatch(actor.id, { kind: "companions", pricePerHour: "0", ...selection })).rejects.toThrow("默认时薪");
  await expect(service.importBatch(actor.id, { kind: "companions", pricePerHour: "50", companionRoleIds: [], staffRoleIds: [] })).rejects.toThrow("陪玩的 KOOK 角色");

  expect(await service.importBatch(actor.id, { kind: "companions", pricePerHour: "66.5", ...selection })).toEqual({ created: 1, skipped: 0, remaining: 0 });
  expect(await service.importBatch(actor.id, { kind: "customers", ...selection })).toEqual({ created: 2, skipped: 0, remaining: 0 });
  // Second run: everything is bound now, and the cached member list means KOOK is not paged again.
  expect(await service.importBatch(actor.id, { kind: "customers", ...selection })).toEqual({ created: 0, skipped: 0, remaining: 0 });
  expect(calls.filter(p => p === "/api/v3/guild/user-list")).toHaveLength(2);

  const companion = await prisma.userExternalAccount.findUnique({ where: { platform_externalUserId: { platform: BotPlatform.KOOK, externalUserId: ids.companion } }, include: { user: { include: { companionProfile: true, wallet: true } } } });
  expect(companion!.user.role).toBe("COMPANION");
  expect(companion!.user.companionProfile).toMatchObject({ nickname: `阿狸${tag}`, status: "LISTED" });
  expect(companion!.user.companionProfile!.pricePerHour.toString()).toBe("66.5");
  expect(companion!.user.wallet).not.toBeNull();

  const clash = await prisma.userExternalAccount.findUnique({ where: { platform_externalUserId: { platform: BotPlatform.KOOK, externalUserId: ids.clash } }, include: { user: true } });
  expect(clash!.user).toMatchObject({ role: "CUSTOMER", displayName: `撞名${tag}#7788`, email: `customer-kook-${ids.clash}@platform.maycatplay.local` });
  for (const skippedId of [ids.staff, ids.bot]) {
    expect(await prisma.userExternalAccount.findUnique({ where: { platform_externalUserId: { platform: BotPlatform.KOOK, externalUserId: skippedId } } })).toBeNull();
  }
  expect(await prisma.adminLog.count({ where: { actorId: actor.id, action: { in: ["IMPORT_KOOK_COMPANIONS", "IMPORT_KOOK_CUSTOMERS"] } } })).toBe(3);

  // "首次使用" recognises the imported customer instead of creating a second profile...
  const imported = await prisma.$transaction(tx => createConfirmedKookCustomer(tx, ids.customer, Date.now() + 60_000));
  expect(imported.created).toBe(false);
  // ...and binding a real website account later absorbs the empty placeholder.
  const web = await prisma.user.create({ data: { email: `${randomUUID()}@synthetic.invalid`, displayName: randomUUID(), displayNameKey: randomUUID(), passwordHash: "x", role: "CUSTOMER" } });
  const merged = await prisma.$transaction(tx => migrateSafePlatformPlaceholderAccount({ tx, platform: BotPlatform.KOOK, externalUserId: ids.customer, targetUserId: web.id }));
  expect(merged.migrated).toBe(true);
  expect((await prisma.userExternalAccount.findUnique({ where: { platform_externalUserId: { platform: BotPlatform.KOOK, externalUserId: ids.customer } } }))!.userId).toBe(web.id);
});

test("import refuses to run without a configured KOOK bot", async () => {
  await expect(new KookMemberImportService(prisma).preview({}, true)).rejects.toThrow("KOOK_TOKEN");
});
