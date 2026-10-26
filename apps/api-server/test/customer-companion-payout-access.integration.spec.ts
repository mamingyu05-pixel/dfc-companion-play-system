import { INestApplication, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { CompanionProfileStatus, UserRole, UserStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { JwtAuthGuard } from "../src/modules/auth/jwt-auth.guard";
import { RolesGuard } from "../src/modules/auth/roles.guard";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { WalletController } from "../src/modules/wallet/wallet.controller";
import { WalletService } from "../src/modules/wallet/wallet.service";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";

const prisma = new PrismaService();
const ownedUsers: string[] = [];
const notifications = { syncCustomerMembershipLevels: jest.fn() } as unknown as BotNotificationService;

@Module({
  imports: [JwtModule.register({})],
  controllers: [WalletController],
  providers: [JwtAuthGuard, RolesGuard, { provide: PrismaService, useValue: prisma },
    { provide: WalletService, useFactory: () => new WalletService(prisma, notifications) }]
})
class PayoutHttpModule {}

let app: INestApplication;
beforeAll(async () => {
  await prisma.$connect();
  app = await NestFactory.create(PayoutHttpModule, { logger: false, abortOnError: false });
  app.setGlobalPrefix("api");
  await app.listen(0, "127.0.0.1");
});
afterAll(async () => {
  try {
    await prisma.companionProfile.deleteMany({ where: { userId: { in: ownedUsers } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: ownedUsers } } });
    await prisma.user.deleteMany({ where: { id: { in: ownedUsers } } });
    expect(await prisma.user.count({ where: { id: { in: ownedUsers } } })).toBe(0);
  } finally {
    await app?.close();
    await prisma.$disconnect();
  }
});

async function user(role: UserRole = "CUSTOMER", profile: CompanionProfileStatus | null = "LISTED", status: UserStatus = "ACTIVE") {
  const id = randomUUID();
  const row = await prisma.user.create({ data: {
    id, email: `${id}@synthetic.invalid`, displayName: id, displayNameKey: id, passwordHash: "synthetic-unusable", role, status,
    wallet: { create: {} },
    ...(profile ? { companionProfile: { create: {
      nickname: id, pricePerHour: "50", skillModes: [], status: profile,
      payoutMethod: "ALIPAY", payoutAccountName: "合成旧姓名", payoutAccountNo: "synthetic-old@invalid"
    } } } : {})
  } });
  ownedUsers.push(id);
  const token = await app.get(JwtService).signAsync({ sub: id, role: row.role, sv: row.sessionVersion }, { secret: process.env.JWT_SECRET });
  return { id, token };
}

async function call(method: "GET" | "PATCH", token?: string, body?: unknown) {
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request({ hostname: "127.0.0.1", port: app.getHttpServer().address().port,
      path: "/api/wallet/companion-payout-profile", method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}) } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
        catch (error) { reject(error); }
      });
    });
    req.on("error", reject); req.end(payload);
  });
}
const payout = { payoutMethod: "ALIPAY", payoutAccountName: "合成新姓名", payoutAccountNo: "synthetic-new@invalid" };

test("CUSTOMER with an active companion profile reads and saves only their own payout profile through real guards and HTTP", async () => {
  const owner = await user(), other = await user();
  const otherBefore = await prisma.companionProfile.findUniqueOrThrow({ where: { userId: other.id } });
  const walletBefore = await prisma.wallet.findUniqueOrThrow({ where: { userId: owner.id } });
  expect((await call("GET", owner.token)).status).toBe(200);
  const updated = await call("PATCH", owner.token, { ...payout, userId: other.id });
  expect(updated.status).toBe(200); expect(updated.body).toMatchObject(payout);
  expect((await call("GET", owner.token)).body).toMatchObject(payout);
  expect(await prisma.companionProfile.findUniqueOrThrow({ where: { userId: owner.id } })).toMatchObject(payout);
  expect(await prisma.companionProfile.findUniqueOrThrow({ where: { userId: other.id } })).toEqual(otherBefore);
  expect(await prisma.wallet.findUniqueOrThrow({ where: { userId: owner.id } })).toEqual(walletBefore);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).role).toBe("CUSTOMER");
});

test("a plain CUSTOMER without a companion profile is rejected by the existing service predicate", async () => {
  const owner = await user("CUSTOMER", null);
  expect((await call("GET", owner.token)).status).toBe(400);
  expect((await call("PATCH", owner.token, payout)).status).toBe(400);
  expect(await prisma.companionProfile.count({ where: { userId: owner.id } })).toBe(0);
});

test("a BANNED companion profile cannot read or update payout data", async () => {
  const owner = await user("CUSTOMER", "BANNED");
  const before = await prisma.companionProfile.findUniqueOrThrow({ where: { userId: owner.id } });
  expect((await call("GET", owner.token)).status).toBe(400);
  expect((await call("PATCH", owner.token, payout)).status).toBe(400);
  expect(await prisma.companionProfile.findUniqueOrThrow({ where: { userId: owner.id } })).toEqual(before);
});

test("a BANNED account is rejected by JwtAuthGuard even with a companion profile and a signed token", async () => {
  const owner = await user("CUSTOMER", "LISTED", "BANNED");
  const before = await prisma.companionProfile.findUniqueOrThrow({ where: { userId: owner.id } });
  expect((await call("GET", owner.token)).status).toBe(401);
  expect((await call("PATCH", owner.token, payout)).status).toBe(401);
  expect(await prisma.companionProfile.findUniqueOrThrow({ where: { userId: owner.id } })).toEqual(before);
});

test("missing authentication remains HTTP 401 for both methods", async () => {
  expect((await call("GET")).status).toBe(401);
  expect((await call("PATCH", undefined, payout)).status).toBe(401);
});

test("the existing COMPANION read/write permissions still work", async () => {
  const owner = await user("COMPANION");
  expect((await call("GET", owner.token)).status).toBe(200);
  expect((await call("PATCH", owner.token, payout)).status).toBe(200);
  expect(await prisma.companionProfile.findUniqueOrThrow({ where: { userId: owner.id } })).toMatchObject(payout);
});

test.each<UserRole>(["ADMIN", "SUPER_ADMIN"])("existing %s GET access is retained and PATCH is not broadened", async role => {
  const owner = await user(role);
  const before = await prisma.companionProfile.findUniqueOrThrow({ where: { userId: owner.id } });
  expect((await call("GET", owner.token)).status).toBe(200);
  expect((await call("PATCH", owner.token, payout)).status).toBe(403);
  expect(await prisma.companionProfile.findUniqueOrThrow({ where: { userId: owner.id } })).toEqual(before);
});
