import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { INestApplication, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { DeltaForceRank, GameCode, OnlineStatus, Prisma, PrismaClient, UserRole } from "@prisma/client";
import { JwtAuthGuard } from "../src/modules/auth/jwt-auth.guard";
import { RolesGuard } from "../src/modules/auth/roles.guard";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";
import { OrderDraftsService } from "../src/modules/orders/order-drafts.service";
import { OrdersController } from "../src/modules/orders/orders.controller";
import { OrdersService } from "../src/modules/orders/orders.service";
import { PrismaService } from "../src/modules/prisma/prisma.service";

const prisma = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
const orders = new OrdersService(prisma as unknown as PrismaService, {} as BotNotificationService);
const cohort = `directory-${randomUUID()}`;
const game = GameCode.DELTA_FORCE;
const userId = (index: number) => `${cohort}-${String(index).padStart(3, "0")}`;
const time = new Date("2026-01-01T00:00:00.000Z");
const sqlEvidence: Record<string, number> = {};
let counting = false, sqlCount = 0;
let app: INestApplication;
let customerId: string, adminId: string;
const previousJwtSecret = process.env.JWT_SECRET;

function recordDirectoryQuery(event: { query: string }) {
  // Idle pooled connections can emit this exact probe before the requested business query.
  // Do not filter WITH/EXISTS containing SELECT 1 or any other business SQL: those still count.
  if (counting && !/^\s*SELECT\s+1\s*;?\s*$/i.test(event.query)) sqlCount++;
}
prisma.$on("query", recordDirectoryQuery);
async function countSql<T>(action: () => Promise<T>) {
  sqlCount = 0;
  counting = true;
  try {
    const result = await action();
    return { result, count: sqlCount };
  } finally {
    counting = false;
  }
}

test("directory SQL counter excludes only a standalone connection probe and still exposes extra business SQL", () => {
  const previousCounting = counting, previousCount = sqlCount;
  try {
    counting = true; sqlCount = 0;
    recordDirectoryQuery({ query: "SELECT 1" });
    recordDirectoryQuery({ query: "  select 1;  " });
    expect(sqlCount).toBe(0);
    recordDirectoryQuery({ query: "WITH cohort AS (SELECT 1) SELECT * FROM cohort" });
    expect(sqlCount).toBe(1);
    recordDirectoryQuery({ query: 'SELECT "id" FROM "users" WHERE "status" = $1' });
    expect(sqlCount).toBe(2);
    recordDirectoryQuery({ query: 'SELECT 1 FROM "users" LIMIT 1' });
    expect(sqlCount).toBe(3);
  } finally {
    counting = previousCounting; sqlCount = previousCount;
  }
});

const onlineStatus = (index: number) => [OnlineStatus.ONLINE, OnlineStatus.BUSY, OnlineStatus.OFFLINE][index % 3];
const stars = (index: number, review: number) => 1 + (index + review) % (1 + index % 5);
const hidden = (index: number, review: number) => review === 9 && index % 3 === 0;
const visibleReviews = (index: number) => Array.from({ length: 10 }, (_, review) => review)
  .filter(review => !hidden(index, review));
const averageRating = (index: number) => {
  const visible = visibleReviews(index);
  return visible.reduce((sum, review) => sum + stars(index, review), 0) / visible.length;
};
const completedOrders = (index: number) => index % 9;
const price = (index: number) => 20 + index % 17;
const active = (index: number) => index % 10 === 0 || index % 10 === 1;

async function makeUser(role: UserRole) {
  const id = randomUUID();
  return prisma.user.create({ data: {
    id, email: `${id}@synthetic.invalid`, displayName: id, displayNameKey: id,
    passwordHash: "synthetic-unusable-hash", role
  } });
}

async function seedCompanions(start: number, end: number) {
  const indices = Array.from({ length: end - start }, (_, index) => start + index);
  await prisma.user.createMany({ data: indices.map(index => ({
    id: userId(index), email: `${userId(index)}@synthetic.invalid`, displayName: userId(index),
    displayNameKey: userId(index), passwordHash: "synthetic-unusable-hash", role: UserRole.COMPANION
  })) });
  await prisma.companionProfile.createMany({ data: indices.map(index => ({
    userId: userId(index), nickname: userId(index), game, games: [game], skillModes: index % 2 === 0 ? ["合成测试", "教学"] : ["合成测试"],
    deltaForceRank: [DeltaForceRank.BRONZE, DeltaForceRank.DIAMOND, DeltaForceRank.ASCENDANT, DeltaForceRank.IMMORTAL, DeltaForceRank.TOP][index % 5],
    pricePerHour: new Prisma.Decimal(price(index)), onlineStatus: onlineStatus(index),
    verified: index % 2 === 0, badges: ["合成测试"], status: "LISTED", createdAt: time, updatedAt: time
  })) });
  const orderData: Prisma.OrderCreateManyInput[] = [], reviewData: Prisma.OrderReviewCreateManyInput[] = [];
  for (const index of indices) {
    for (let review = 0; review < 10; review++) {
      const id = `${userId(index)}-review-${review}`;
      orderData.push({ id, orderNo: id, customerId, companionId: userId(index), game,
        status: review === 9 ? "CANCELLED" : "COMPLETED", isTest: review !== 9 && review >= completedOrders(index),
        mode: "synthetic", hours: new Prisma.Decimal(1), unitPrice: new Prisma.Decimal(0), totalAmount: new Prisma.Decimal(0) });
      reviewData.push({ id, orderId: id, stars: stars(index, review), hidden: hidden(index, review),
        comment: `synthetic-${index}-${review}`, createdAt: new Date(time.getTime() + review * 1000) });
    }
    if (active(index)) {
      const id = `${userId(index)}-active`;
      orderData.push({ id, orderNo: id, customerId, companionId: userId(index), game,
        status: index % 10 === 0 ? "ACCEPTED" : "IN_PROGRESS", isTest: true,
        mode: "synthetic", hours: new Prisma.Decimal(1), unitPrice: new Prisma.Decimal(0), totalAmount: new Prisma.Decimal(0) });
    }
  }
  // Keep each batch comfortably below PostgreSQL's bind parameter limit.
  for (let index = 0; index < orderData.length; index += 500) {
    await prisma.order.createMany({ data: orderData.slice(index, index + 500) });
  }
  for (let index = 0; index < reviewData.length; index += 500) {
    await prisma.orderReview.createMany({ data: reviewData.slice(index, index + 500) });
  }
}

@Module({
  imports: [JwtModule.register({})], controllers: [OrdersController],
  providers: [JwtAuthGuard, RolesGuard,
    { provide: PrismaService, useValue: prisma }, { provide: OrdersService, useValue: orders },
    { provide: OrderDraftsService, useValue: {} }]
})
class DirectoryHttpModule {}

async function get(path: string, token?: string) {
  const address = app.getHttpServer().address();
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: address.port, path,
      headers: token ? { Authorization: `Bearer ${token}` } : {} }, res => {
      const data: Buffer[] = [];
      res.on("data", chunk => data.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(data).toString("utf8")) }));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  await prisma.$connect();
  customerId = (await makeUser(UserRole.CUSTOMER)).id;
  adminId = (await makeUser(UserRole.ADMIN)).id;
  await seedCompanions(0, 1);
  const one = await countSql(() => orders.listOrderableCompanions(game, { page: 1, limit: 60, q: cohort }));
  expect(one.result.total).toBe(1);
  sqlEvidence.oneCompanion = one.count;
  await seedCompanions(1, 300);
  const many = await countSql(() => orders.listOrderableCompanions(game, { page: 1, limit: 60, q: cohort }));
  expect(many.result.total).toBe(300);
  sqlEvidence.threeHundredCompanions = many.count;
  sqlEvidence.emptyPage = (await countSql(() => orders.listOrderableCompanions(game, { page: 1000, q: cohort }))).count;
  process.env.JWT_SECRET = previousJwtSecret || randomUUID();
  app = await NestFactory.create(DirectoryHttpModule, { logger: false });
  await app.listen(0, "127.0.0.1");
}, 120000);

afterAll(async () => {
  if (app) await app.close();
  await prisma.$disconnect();
  if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousJwtSecret;
});

test("directory: 300 companions x 10 reviews match the previous visible-review algorithm and non-test completion counts", async () => {
  expect(await prisma.orderReview.count({ where: { order: { companionId: { startsWith: cohort } } } })).toBe(3000);
  const previousReviews = await prisma.orderReview.findMany({ where: { hidden: false, order: { companionId: { startsWith: cohort } } },
    select: { stars: true, order: { select: { companionId: true } } } });
  const actual = [];
  for (let page = 1; page <= 5; page++) {
    const result = await orders.listOrderableCompanions(game, { page, limit: 60, q: cohort });
    expect(result.total).toBe(300);
    actual.push(...result.companions);
  }
  expect(actual).toHaveLength(300);
  const byId = new Map(actual.map(companion => [companion.id, companion]));
  for (let index = 0; index < 300; index++) {
    const companion = byId.get(userId(index))!;
    expect(companion).toBeDefined();
    const previous = previousReviews.filter(review => review.order.companionId === userId(index));
    expect(companion.averageRating).toBeCloseTo(previous.reduce((sum, review) => sum + review.stars, 0) / previous.length, 12);
    expect(companion.averageRating).toBeCloseTo(averageRating(index), 12);
    expect(companion.reviewCount).toBe(visibleReviews(index).length);
    expect(companion.completedOrders).toBe(completedOrders(index));
    expect(companion).toMatchObject({ verified: index % 2 === 0, badges: ["合成测试"],
      onlineStatus: onlineStatus(index), activeServiceCount: active(index) ? 1 : 0 });
    expect(companion.reviews.map(review => review.comment)).toEqual(visibleReviews(index).reverse().map(review => `synthetic-${index}-${review}`));
    for (const review of companion.reviews) {
      const reviewIndex = Number(review.comment.split("-").at(-1));
      expect(review.createdAt).toMatch(/Z$/);
      expect(new Date(review.createdAt).getTime()).toBe(time.getTime() + reviewIndex * 1000);
    }
  }
  console.info("Directory data evidence: 300 companions, 3000 reviews; visible ratings/counts and real completed-order counts match the previous algorithm.");
});

test("directory: actual Prisma SQL event counts stay fixed at 1 for 1 and 300 companions, including an empty page", () => {
  expect(sqlEvidence).toEqual({ oneCompanion: 1, threeHundredCompanions: 1, emptyPage: 1 });
  console.info(`Directory SQL evidence: companions=1 SQL=${sqlEvidence.oneCompanion}; companions=300 SQL=${sqlEvidence.threeHundredCompanions}; empty page SQL=${sqlEvidence.emptyPage}.`);
});

const compareId = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
function compareIndices(sort: string, left: number, right: number) {
  if (sort === "recommended") {
    const leftStatus = onlineStatus(left) === "ONLINE" ? 0 : 1;
    const rightStatus = onlineStatus(right) === "ONLINE" ? 0 : 1;
    const priority = leftStatus - rightStatus || Number(right % 2 === 0) - Number(left % 2 === 0);
    if (priority) return priority;
  }
  if (sort === "price") return price(left) - price(right) || compareId(userId(left), userId(right));
  if (sort === "orders") return completedOrders(right) - completedOrders(left) || averageRating(right) - averageRating(left) || compareId(userId(left), userId(right));
  return averageRating(right) - averageRating(left) || completedOrders(right) - completedOrders(left) || compareId(userId(left), userId(right));
}

test.each(["recommended", "rating", "orders", "price"])("directory: %s sorting traverses all 300 companions without duplicates or omissions, including ties", async sort => {
  const ids: string[] = [];
  for (let page = 1; page <= Math.ceil(300 / 24); page++) {
    const result = await orders.listOrderableCompanions(game, { page, sort, q: cohort });
    expect(result).toMatchObject({ total: 300, page, limit: 24 });
    ids.push(...result.companions.map(companion => companion.id));
  }
  const expected = Array.from({ length: 300 }, (_, index) => index).sort((left, right) => compareIndices(sort, left, right)).map(userId);
  expect(ids).toEqual(expected);
  expect(new Set(ids).size).toBe(300);
});

test("directory: explicit pagination defaults to 24, caps limit at 60, and preserves total beyond the last page", async () => {
  expect(await orders.listOrderableCompanions(game, { sort: "recommended", q: cohort })).toMatchObject({ page: 1, limit: 24, total: 300 });
  const capped = await orders.listOrderableCompanions(game, { page: 1, limit: 999, q: cohort });
  expect(capped).toMatchObject({ page: 1, limit: 60, total: 300 });
  expect(capped.companions).toHaveLength(60);
  expect(await orders.listOrderableCompanions(game, { page: 14, q: cohort })).toMatchObject({ page: 14, limit: 24, total: 300, companions: [] });
});

test("directory: legacy clients receive every listed companion rather than an implicit 24-item truncation", async () => {
  const result = await orders.listOrderableCompanions(game);
  expect(Array.isArray(result)).toBe(true);
  expect(result.filter(companion => companion.nickname.startsWith(cohort))).toHaveLength(300);
  const response = await get("/orders/public/companions?game=DELTA_FORCE");
  expect(response.status).toBe(200);
  expect(Array.isArray(response.body)).toBe(true);
  expect(response.body.filter((companion: { nickname: string }) => companion.nickname.startsWith(cohort))).toHaveLength(300);
});

test.each([
  { page: 0 }, { page: -1 }, { page: 1.5 }, { page: "invalid" },
  { limit: 0 }, { limit: -1 }, { limit: 1.5 }, { limit: "invalid" }, { sort: "unknown" }
])("directory: invalid query %j receives a Chinese validation error", async query => {
  await expect(orders.listOrderableCompanions(game, query)).rejects.toThrow(/[\u3400-\u9fff]/);
});

test("directory: complete options include all eligible online companions and exclude active services, offline and banned profiles", async () => {
  const invalidIds: string[] = [];
  for (const status of ["UNLISTED", "BANNED", "PENDING_REVIEW"] as const) {
    const user = await makeUser(UserRole.COMPANION);
    invalidIds.push(user.id);
    await prisma.companionProfile.create({ data: { userId: user.id, nickname: `excluded-${cohort}-${status}`, game,
      status, onlineStatus: "ONLINE", skillModes: [], pricePerHour: new Prisma.Decimal(0) } });
  }
  const banned = await makeUser(UserRole.COMPANION);
  invalidIds.push(banned.id);
  await prisma.user.update({ where: { id: banned.id }, data: { status: "BANNED" } });
  await prisma.companionProfile.create({ data: { userId: banned.id, nickname: `excluded-${cohort}-user`, game,
    status: "LISTED", onlineStatus: "ONLINE", skillModes: [], pricePerHour: new Prisma.Decimal(0) } });
  const result = await orders.listOrderableCompanionOptions(game);
  const actual = result.filter(companion => companion.id.startsWith(cohort)).map(companion => companion.id).sort(compareId);
  const expected = Array.from({ length: 300 }, (_, index) => index)
    .filter(index => onlineStatus(index) === "ONLINE" && !active(index)).map(userId).sort(compareId);
  expect(expected.length).toBeGreaterThan(60);
  expect(actual).toEqual(expected);
  expect(result.every(companion => companion.onlineStatus === "ONLINE" && !invalidIds.includes(companion.id))).toBe(true);
  for (const companion of result) {
    expect(Object.keys(companion).sort()).toEqual(["displayName", "id", "nickname", "onlineStatus", "pricePerHour"].sort());
  }
  const publicPage = await orders.listOrderableCompanions(game, { page: 1, limit: 60, q: `excluded-${cohort}` });
  expect(publicPage).toMatchObject({ total: 0, companions: [] });
});

test("directory: options preserve customer-only authentication and public paging works through HTTP", async () => {
  expect((await get("/orders/companions/options?game=DELTA_FORCE")).status).toBe(401);
  const jwt = app.get(JwtService);
  const sign = (sub: string, role: UserRole) => jwt.sign({ sub, role }, { secret: process.env.JWT_SECRET });
  expect((await get("/orders/companions/options", sign(adminId, UserRole.ADMIN))).status).toBe(403);
  expect((await get("/orders/companions/options", sign(userId(0), UserRole.COMPANION))).status).toBe(403);
  const allowed = await get("/orders/companions/options?game=DELTA_FORCE", sign(customerId, UserRole.CUSTOMER));
  expect(allowed.status).toBe(200);
  expect(allowed.body.filter((companion: { id: string }) => companion.id.startsWith(cohort)).length).toBeGreaterThan(60);
  const page = await get(`/orders/public/companions?game=DELTA_FORCE&page=1&q=${encodeURIComponent(cohort)}`);
  expect(page.status).toBe(200);
  expect(page.body).toMatchObject({ total: 300, page: 1, limit: 24 });
  expect(page.body.companions).toHaveLength(24);
});

test("directory: leaderboard is an independent, lightweight top-five result from the entire directory", async () => {
  const all = await orders.listOrderableCompanions(game);
  const expected = [...all].sort((left, right) => right.completedOrders - left.completedOrders ||
    (right.averageRating ?? 0) - (left.averageRating ?? 0) || compareId(left.id, right.id)).slice(0, 5);
  const measured = await countSql(() => orders.listCompanionLeaderboard(game));
  expect(measured.count).toBe(1);
  expect(measured.result.map(companion => companion.id)).toEqual(expected.map(companion => companion.id));
  expect(measured.result).toHaveLength(5);
  for (const companion of measured.result) {
    expect(companion).not.toHaveProperty("reviews");
    expect(companion).not.toHaveProperty("photoUrls");
    expect(companion).not.toHaveProperty("bio");
    expect(companion).not.toHaveProperty("externalAccounts");
  }
  const response = await get("/orders/public/companions/leaderboard?game=DELTA_FORCE");
  expect(response.status).toBe(200);
  expect(response.body.map((companion: { id: string }) => companion.id)).toEqual(expected.map(companion => companion.id));
});

test("directory: no-review fields stay null/zero and review previews stop at the latest 20 visible rows", async () => {
  const companion = await makeUser(UserRole.COMPANION);
  const nickname = `preview-${randomUUID()}`;
  await prisma.companionProfile.create({ data: { userId: companion.id, nickname, game, games: [],
    status: "LISTED", onlineStatus: "ONLINE", skillModes: [], pricePerHour: new Prisma.Decimal(1) } });
  const empty = await orders.listOrderableCompanions(game, { page: 1, q: nickname });
  expect(empty.total).toBe(1);
  expect(empty.companions[0]).toMatchObject({ averageRating: null, rating: null, reviewCount: 0,
    reviews: [], completedOrders: 0, games: [game] });
  const data = Array.from({ length: 25 }, (_, index) => ({
    id: `${companion.id}-${index}`, orderNo: `${companion.id}-${index}`, customerId, companionId: companion.id,
    game, status: "COMPLETED" as const, isTest: true, mode: "synthetic",
    hours: new Prisma.Decimal(1), unitPrice: new Prisma.Decimal(0), totalAmount: new Prisma.Decimal(0)
  }));
  await prisma.order.createMany({ data });
  await prisma.orderReview.createMany({ data: data.map((order, index) => ({
    orderId: order.id, stars: 5, comment: `preview-${index}`, hidden: index === 24,
    createdAt: new Date(time.getTime() + index * 1000)
  })) });
  const result = await orders.listOrderableCompanions(game, { page: 1, q: nickname });
  expect(result.companions[0]).toMatchObject({ averageRating: 5, rating: 5, reviewCount: 24, completedOrders: 0 });
  expect(result.companions[0].reviews.map(review => review.comment)).toEqual(Array.from({ length: 20 }, (_, index) => `preview-${23 - index}`));
});

test("directory: online filters and case-insensitive literal search apply before pagination and total", async () => {
  for (const filter of ["online", "recommended"]) {
    const result = await orders.listOrderableCompanions(game, { page: 1, q: cohort.toUpperCase(), filter });
    expect(result).toMatchObject({ total: 100, limit: 24 });
    expect(result.companions).toHaveLength(24);
    expect(result.companions.every(companion => companion.onlineStatus === "ONLINE")).toBe(true);
  }
  const voice = await orders.listOrderableCompanions(game, { page: 1, q: cohort, filter: "voice" });
  expect(voice.total).toBe(300);
  const highRank = await orders.listOrderableCompanions(game, { page: 1, q: cohort, filter: "high-rank" });
  expect(highRank.total).toBe(240);
  expect(highRank.companions.every(companion => ["DIAMOND", "ASCENDANT", "IMMORTAL", "TOP"].includes(companion.deltaForceRank))).toBe(true);
  const newbie = await orders.listOrderableCompanions(game, { page: 1, q: cohort, filter: "newbie" });
  expect(newbie.total).toBe(150);
  expect(newbie.companions.every(companion => companion.skillModes.includes("教学"))).toBe(true);
  const literal = await orders.listOrderableCompanions(game, { page: 1, q: "%' OR true --" });
  expect(literal).toMatchObject({ total: 0, companions: [] });
  await expect(orders.listOrderableCompanions(game, { page: 1, q: "x".repeat(81) })).rejects.toThrow(/[\u3400-\u9fff]/);
  await expect(orders.listOrderableCompanions(game, { page: 1, filter: "unknown" })).rejects.toThrow(/[\u3400-\u9fff]/);
});
