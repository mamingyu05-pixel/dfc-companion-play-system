import { INestApplication, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PrismaClient, UserRole, UserStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { AdminController } from "../src/modules/admin/admin.controller";
import { CompanionExternalAccountsService } from "../src/modules/admin/companion-external-accounts.service";
import { JwtAuthGuard } from "../src/modules/auth/jwt-auth.guard";
import { RolesGuard } from "../src/modules/auth/roles.guard";
import { OrdersService } from "../src/modules/orders/orders.service";
import { OrderDraftsService } from "../src/modules/orders/order-drafts.service";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { WalletService } from "../src/modules/wallet/wallet.service";

const prisma = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
const cohort = "admin-directory-" + randomUUID();
const ids: string[] = [];
const made = new Date("2026-01-02T00:00:00Z");
const rows = Array.from({ length: 137 }, (_, i) => ({
  id: cohort + "-" + String(i).padStart(3, "0"),
  email: cohort + "-" + i + "@synthetic.invalid",
  displayName: cohort + " member " + i,
  displayNameKey: cohort + "-" + i,
  role: UserRole.CUSTOMER,
  passwordHash: "synthetic-unusable",
  createdAt: made
}));
let counting = false, measuredUserReads: Array<{ query: string; parameters: unknown[] }> = [];
prisma.$on("query", event => {
  if (counting && /\bFROM\s+"public"\."users"/i.test(event.query) && !/\bCOUNT\(/i.test(event.query)) {
    measuredUserReads.push({ query: event.query, parameters: JSON.parse(event.params) });
  }
});

@Module({
  imports: [JwtModule.register({})], controllers: [AdminController],
  providers: [JwtAuthGuard, RolesGuard, { provide: PrismaService, useValue: prisma },
    { provide: OrdersService, useValue: {} }, { provide: OrderDraftsService, useValue: {} },
    { provide: WalletService, useValue: {} }, { provide: CompanionExternalAccountsService, useValue: {} }]
})
class AdminDirectoryModule {}
let app: INestApplication, adminToken: string, customerToken: string;
let baseStats: { customers: number; companions: number; admins: number; banned: number };
let noWallet: string, companion: string, admin: string, banned: string, placeholder: string, percent: string;
let foreignName: string, profileName: string, externalId: string, longEmail: string;

function visibleWhere() {
  return { NOT: { AND: [
    { status: UserStatus.BANNED }, { email: { endsWith: "@platform.maycatplay.local" } },
    { displayName: { startsWith: "Merged platform placeholder " } }
  ] } };
}
async function counts() {
  const where = visibleWhere();
  const [customers, companions, admins, banned] = await Promise.all([
    prisma.user.count({ where: { AND: [where, { role: UserRole.CUSTOMER }] } }),
    prisma.user.count({ where: { AND: [where, { companionProfile: { isNot: null } }] } }),
    prisma.user.count({ where: { AND: [where, { role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] } }] } }),
    prisma.user.count({ where: { AND: [where, { status: UserStatus.BANNED }] } })
  ]);
  return { customers, companions, admins, banned };
}
async function create(role: UserRole, suffix: string, status: UserStatus = UserStatus.ACTIVE) {
  const id = cohort + "-" + suffix;
  ids.push(id);
  return prisma.user.create({ data: { id, email: id + "@synthetic.invalid", displayName: id,
    displayNameKey: id, role, status, passwordHash: "synthetic-unusable", createdAt: made } });
}
beforeAll(async () => {
  await prisma.$connect(); baseStats = await counts();
  await prisma.user.createMany({ data: rows }); ids.push(...rows.map(r => r.id));
  await prisma.wallet.createMany({ data: rows.map(r => ({ userId: r.id })) });
  longEmail = cohort + "@" + "d".repeat(50) + "." + "e".repeat(50) + "." + "f".repeat(50) + ".test";
  await prisma.user.update({ where: { id: rows[7].id }, data: { email: longEmail } });
  noWallet = (await create(UserRole.CUSTOMER, "no-wallet")).id;
  companion = (await create(UserRole.COMPANION, "companion")).id;
  await prisma.wallet.create({ data: { userId: companion } });
  profileName = "专属陪玩昵称-" + randomUUID();
  await prisma.companionProfile.create({ data: { userId: companion, nickname: profileName,
    skillModes: [], pricePerHour: "50", status: "LISTED" } });
  admin = (await create(UserRole.ADMIN, "admin")).id;
  await prisma.wallet.create({ data: { userId: admin } });
  banned = (await create(UserRole.CUSTOMER, "banned", UserStatus.BANNED)).id;
  await prisma.wallet.create({ data: { userId: banned } });
  placeholder = (await create(UserRole.CUSTOMER, "merged", UserStatus.BANNED)).id;
  await prisma.user.update({ where: { id: placeholder }, data: {
    email: cohort + "@platform.maycatplay.local", displayName: "Merged platform placeholder " + cohort
  } });
  percent = (await create(UserRole.CUSTOMER, "literal")).id;
  await prisma.user.update({ where: { id: percent }, data: { displayName: cohort + " literal %_\\marker" } });
  foreignName = "外部昵称-" + randomUUID();
  externalId = "9" + Date.now().toString() + String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  await prisma.userExternalAccount.createMany({ data: [
    { userId: rows[0].id, platform: "KOOK", externalUserId: externalId, displayName: foreignName },
    { userId: rows[1].id, platform: "DISCORD", externalUserId: externalId + "1", displayName: "Discord-" + foreignName }
  ] });
  app = await NestFactory.create(AdminDirectoryModule, { logger: false, abortOnError: false });
  app.setGlobalPrefix("api"); await app.listen(0, "127.0.0.1");
  const jwt = app.get(JwtService);
  adminToken = await jwt.signAsync({ sub: admin, role: UserRole.ADMIN, sv: 0 }, { secret: process.env.JWT_SECRET });
  customerToken = await jwt.signAsync({ sub: rows[0].id, role: UserRole.CUSTOMER, sv: 0 }, { secret: process.env.JWT_SECRET });
});
afterAll(async () => {
  try {
    await prisma.userExternalAccount.deleteMany({ where: { userId: { in: ids } } });
    await prisma.companionProfile.deleteMany({ where: { userId: { in: ids } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    expect(await prisma.user.count({ where: { id: { in: ids } } })).toBe(0);
  } finally { await app?.close(); await prisma.$disconnect(); }
});
function call(path: string, token: string | null = adminToken) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: app.getHttpServer().address().port,
      path: "/api/admin/users" + path, headers: token ? { Authorization: "Bearer " + token } : {} }, res => {
      const chunks: Buffer[] = []; res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => { try { resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) }); } catch (e) { reject(e); } });
    }); req.on("error", reject); req.end();
  });
}
const query = (value: string) => encodeURIComponent(value);
test("legacy array remains compatible and demonstrates the old unbounded response", async () => {
  const r = await call("");
  expect(r.status).toBe(200); expect(Array.isArray(r.body)).toBe(true);
  expect(r.body.length).toBeGreaterThan(137);
  expect(r.body.some((u: any) => u.id === rows[136].id)).toBe(true);
  expect(r.body.every((u: any) => !("passwordHash" in u) && !("sessionVersion" in u))).toBe(true);
  console.info("ADMIN_DIRECTORY_OLD_BASELINE legacyRows=" + r.body.length + " syntheticCohort=143");
});
test("new directory and options retain admin-only access", async () => {
  for (const path of ["/directory", "/options?purpose=balance-adjustment"]) {
    expect((await call(path, null)).status).toBe(401);
    expect((await call(path, customerToken)).status).toBe(403);
  }
});
test("directory defaults to fifty and exposes only the existing display fields", async () => {
  const r = await call("/directory?q=" + query(cohort));
  expect(r.status).toBe(200); expect(r.body.page).toBe(1); expect(r.body.limit).toBe(50);
  expect(r.body.items).toHaveLength(50); expect(r.body.total).toBe(142);
  expect(r.body.items.every((u: any) => !("passwordHash" in u) && !("sessionVersion" in u))).toBe(true);
  expect(r.body.items[0]).toEqual(expect.objectContaining({ externalAccounts: expect.any(Array) }));
});
test("stable tied-timestamp pagination has no duplicates or omissions", async () => {
  const expected = ids.filter(id => id !== placeholder).sort().reverse();
  const found: string[] = [];
  for (let page = 1; page <= 3; page++) {
    const r = await call("/directory?q=" + query(cohort) + "&page=" + page);
    expect(r.status).toBe(200); expect(r.body.total).toBe(expected.length);
    found.push(...r.body.items.map((u: any) => u.id));
  }
  expect(found).toEqual(expected); expect(new Set(found).size).toBe(expected.length);
});
test("empty out-of-range pages retain matching total and global stats", async () => {
  const a = await call("/directory?q=" + query(cohort));
  const r = await call("/directory?q=" + query(cohort) + "&page=999");
  expect(r.status).toBe(200); expect(r.body.items).toEqual([]); expect(r.body.total).toBe(142);
  expect(r.body.stats).toEqual(a.body.stats);
  expect(r.body.stats).toEqual({ customers: baseStats.customers + 140, companions: baseStats.companions + 1,
    admins: baseStats.admins + 1, banned: baseStats.banned + 1 });
});
test.each(["page=0", "page=-1", "page=1.5", "page=no", "page=9007199254740991", "limit=0", "limit=no", "q=a&q=b"])(
  "invalid directory query is rejected: %s", async bad => { expect((await call("/directory?" + bad)).status).toBe(400); }
);
test("directory clamps limits at one hundred and SQL materialization remains bounded", async () => {
  measuredUserReads = []; counting = true;
  let r;
  try { r = await call("/directory?q=" + query(cohort) + "&limit=10000"); }
  finally { counting = false; }
  expect(r!.status).toBe(200); expect(r!.body.limit).toBe(100); expect(r!.body.items).toHaveLength(100);
  expect(measuredUserReads.length).toBeGreaterThan(0);
  expect(measuredUserReads.every(x => /\bLIMIT\b/.test(x.query))).toBe(true);
  console.info("ADMIN_DIRECTORY_BOUNDED parentRows=100 total=" + r!.body.total + " readQueries=" + measuredUserReads.length);
});
test.each(["id", "email", "nickname", "external-name", "external-id", "role", "status"])(
  "server search covers %s without loading all users into the response", async kind => {
    const value = kind === "id" ? rows[5].id : kind === "email" ? rows[6].email.toUpperCase()
      : kind === "nickname" ? profileName : kind === "external-name" ? foreignName
      : kind === "external-id" ? externalId : kind === "role" ? cohort + " 管理员" : cohort + " 封禁";
    const r = await call("/directory?q=" + query(value));
    expect(r.status).toBe(200);
    const matches = r.body.items.map((u: any) => u.id);
    const target = kind === "id" ? rows[5].id : kind === "email" ? rows[6].id : kind === "nickname" ? companion
      : kind.startsWith("external") ? rows[0].id : kind === "role" ? admin : banned;
    expect(matches).toContain(target); expect(matches).not.toContain(placeholder);
    expect(matches.length).toBeLessThanOrEqual(50);
  }
);
test("SQL LIKE wildcard characters are literal search text", async () => {
  const r = await call("/directory?q=" + query(cohort + " %_\\marker"));
  expect(r.status).toBe(200); expect(r.body.items.map((u: any) => u.id)).toEqual([percent]);
});
test("a complete valid email longer than 200 characters remains searchable", async () => {
  expect(longEmail.length).toBeGreaterThan(200);
  const r = await call("/directory?q=" + query(longEmail));
  expect(r.status).toBe(200); expect(r.body.items.map((u: any) => u.id)).toEqual([rows[7].id]);
});
test("global stats do not shrink with filtered results or another page", async () => {
  const a = await call("/directory?q=" + query(rows[5].id)), b = await call("/directory?q=" + query(cohort) + "&page=2");
  expect(a.status).toBe(200); expect(a.body.items).toHaveLength(1);
  expect(a.body.stats).toEqual(b.body.stats);
});
test("balance options are bounded eligible customers and pin an off-search selection once", async () => {
  const selected = rows[136].id;
  const r = await call("/options?purpose=balance-adjustment&q=" + query(rows[0].id) + "&selectedId=" + query(selected));
  expect(r.status).toBe(200); expect(r.body.selectedId).toBe(selected); expect(r.body.items[0].id).toBe(selected);
  expect(r.body.items.map((u: any) => u.id)).toEqual([selected, rows[0].id]);
  expect(r.body.items.every((u: any) => u.role === "CUSTOMER" && u.status === "ACTIVE" && u.wallet)).toBe(true);
  const defaults = await call("/options?purpose=balance-adjustment&q=" + query(cohort));
  expect(defaults.body.items).toHaveLength(25); expect(defaults.body.hasMore).toBe(true); expect(defaults.body.limit).toBe(25);
  const capped = await call("/options?purpose=balance-adjustment&q=" + query(cohort) + "&limit=999");
  expect(capped.body.limit).toBe(50); expect(capped.body.items).toHaveLength(50);
});
test.each(["banned", "admin", "no-wallet", "missing"])("ineligible selected balance target is not reintroduced: %s", async kind => {
  const selected = kind === "banned" ? banned : kind === "admin" ? admin : kind === "no-wallet" ? noWallet : "not-an-id";
  const r = await call("/options?purpose=balance-adjustment&q=" + query(cohort) + "&selectedId=" + query(selected));
  expect(r.status).toBe(200); expect(r.body.selectedId).toBeNull();
  expect(r.body.items.some((u: any) => u.id === selected)).toBe(false);
});
test.each(["companion-onboarding", "password-reset", "admin-promotion"])("purpose %s preserves its existing target eligibility", async purpose => {
  const r = await call("/options?purpose=" + purpose + "&q=" + query(cohort));
  expect(r.status).toBe(200); expect(r.body.purpose).toBe(purpose); expect(r.body.items.length).toBeLessThanOrEqual(25);
  expect(r.body.items.every((u: any) => u.status === "ACTIVE")).toBe(true);
  if (purpose === "companion-onboarding") expect(r.body.items.every((u: any) => !u.companionProfile)).toBe(true);
});
test.each(["", "purpose=unknown", "purpose=balance-adjustment&limit=0", "purpose=balance-adjustment&limit=1.5", "purpose=balance-adjustment&selectedId=a&selectedId=b"])(
  "invalid options query is rejected: %s", async bad => { expect((await call("/options?" + bad)).status).toBe(400); }
);
