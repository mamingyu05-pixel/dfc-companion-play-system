import { randomBytes, randomUUID } from "node:crypto";
import { JwtService } from "@nestjs/jwt";
import { BotPlatform, UserRole } from "@prisma/client";
import { AdminController } from "../src/modules/admin/admin.controller";
import { AuthService } from "../src/modules/auth/auth.service";
import { JwtAuthGuard } from "../src/modules/auth/jwt-auth.guard";
import { createPasswordHash } from "../src/modules/auth/password.util";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { WalletService } from "../src/modules/wallet/wallet.service";

const prisma = new PrismaService();
const jwt = new JwtService({});
const auth = new AuthService(prisma, jwt);
const guard = new JwtAuthGuard(jwt, prisma);
const wallet = new WalletService(prisma, { syncCustomerMembershipLevels: jest.fn().mockResolvedValue([]) } as unknown as BotNotificationService);
// The status and password handlers only touch Prisma.
const admin = Object.assign(Object.create(AdminController.prototype), { prisma }) as AdminController;

beforeAll(() => {
  process.env.JWT_SECRET ??= "review-fixes-test-secret";
  process.env.CUSTOMER_WEB_URL = "https://demo.invalid/customer";
  process.env.COMPANION_WEB_URL = "https://demo.invalid/companion";
  return prisma.$connect();
});
afterAll(() => prisma.$disconnect());

async function user(role: UserRole, extra: Record<string, unknown> = {}) {
  const name = randomUUID();
  return prisma.user.create({ data: {
    email: `${name}@synthetic.invalid`, displayName: name, displayNameKey: name, role,
    passwordHash: await createPasswordHash("old-password-1"), wallet: { create: {} }, ...extra
  } });
}
const actor = (u: { id: string; email: string; role: UserRole }) => ({ id: u.id, email: u.email, role: u.role });
const accepts = (token: string) =>
  guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ header: (n: string) => (n === "authorization" ? `Bearer ${token}` : undefined) }) }) } as never);
const nonce = () => randomBytes(32).toString("base64url");

test("a password reset ends every session issued before it, and the new password signs in", async () => {
  const customer = await user(UserRole.CUSTOMER);
  const boss = await user(UserRole.SUPER_ADMIN);
  const { accessToken } = await auth.login({ email: customer.email, password: "old-password-1", portal: "customer" });
  await expect(accepts(accessToken)).resolves.toBe(true);

  await admin.resetUserPassword(actor(boss), customer.id, { password: "new-password-2" });
  await expect(accepts(accessToken)).rejects.toThrow("Session expired");
  const fresh = await auth.login({ email: customer.email, password: "new-password-2", portal: "customer" });
  await expect(accepts(fresh.accessToken)).resolves.toBe(true);
});

test("operations admins cannot ban or reactivate staff; a super admin's ban ends the target's sessions", async () => {
  const ops = await user(UserRole.ADMIN);
  const boss = await user(UserRole.SUPER_ADMIN);
  const otherOps = await user(UserRole.ADMIN);
  await expect(admin.updateUserStatus(actor(ops), boss.id, { status: "BANNED" })).rejects.toThrow("只有超级管理员");
  await expect(admin.updateUserStatus(actor(ops), otherOps.id, { status: "BANNED" })).rejects.toThrow("只有超级管理员");
  expect((await prisma.user.findUniqueOrThrow({ where: { id: boss.id } })).status).toBe("ACTIVE");

  const { accessToken } = await auth.login({ email: otherOps.email, password: "old-password-1", portal: "admin" });
  await admin.updateUserStatus(actor(boss), otherOps.id, { status: "BANNED" });
  await expect(accepts(accessToken)).rejects.toThrow();
  await admin.updateUserStatus(actor(boss), otherOps.id, { status: "ACTIVE" });
  // Reactivation does not resurrect the old session.
  await expect(accepts(accessToken)).rejects.toThrow("Session expired");
});

test("a binding code posted in a channel is burned and can no longer be redeemed", async () => {
  const customer = await user(UserRole.CUSTOMER);
  const { code } = await auth.createPlatformBindingCode(customer.id, { platform: BotPlatform.DISCORD });
  expect(await auth.discardPlatformBindingCode(BotPlatform.DISCORD, code)).toEqual({ discarded: true });
  await expect(auth.consumePlatformBindingCode(BotPlatform.DISCORD, { code, externalUserId: `d-${randomUUID()}` })).rejects.toThrow("绑定码无效");
});

test("a login receipt only works once, in the browser it was issued to, and chat links ask for confirmation", async () => {
  const customer = await user(UserRole.CUSTOMER);
  const link = new URL(await auth.issueWebLoginLink(customer.id));
  const browser = nonce();
  const redirect = new URL(await auth.redeemWebLoginLink(link.searchParams.get("t"), browser));
  expect(redirect.origin + redirect.pathname).toBe("https://demo.invalid/customer/oauth-callback");
  const fragment = new URLSearchParams(redirect.hash.slice(1));
  // No session in the URL any more, only the receipt.
  expect(fragment.get("token")).toBeNull();
  const receipt = fragment.get("receipt")!;

  // A crafted link opened in another browser (no or different nonce) cannot sign that browser in.
  await expect(auth.exchangeLoginReceipt(receipt, nonce())).rejects.toThrow("不是在这个浏览器");
  await expect(auth.exchangeLoginReceipt(receipt, undefined)).rejects.toThrow();
  const session = await auth.exchangeLoginReceipt(receipt, browser);
  expect(session).toMatchObject({ confirm: true, platform: "kook", user: { id: customer.id, role: "CUSTOMER" } });
  await expect(accepts(session.accessToken)).resolves.toBe(true);
  await expect(auth.exchangeLoginReceipt(receipt, browser)).rejects.toThrow();
  expect(await prisma.loginReceipt.count({ where: { codeHash: receipt } })).toBe(0);
});

test("a retried withdrawal or recharge returns the first request instead of freezing or filing again", async () => {
  const companion = await user(UserRole.COMPANION, {
    wallet: { create: { availableIncome: "100.00" } },
    companionProfile: { create: { nickname: randomUUID(), skillModes: [], pricePerHour: "60.00", status: "LISTED" } }
  });
  const requestId = randomUUID();
  const first = await wallet.createWithdrawalRequest(companion.id, { amount: "30", payoutAccount: "alipay:synthetic", requestId });
  const again = await wallet.createWithdrawalRequest(companion.id, { amount: "30", payoutAccount: "alipay:synthetic", requestId });
  expect(again.id).toBe(first.id);
  const after = await prisma.wallet.findUniqueOrThrow({ where: { userId: companion.id } });
  expect(after.availableIncome.toFixed(2)).toBe("70.00");
  expect(after.frozenIncome.toFixed(2)).toBe("30.00");
  await expect(wallet.createWithdrawalRequest(companion.id, { amount: "40", payoutAccount: "alipay:synthetic", requestId })).rejects.toThrow("金额不一致");

  const customer = await user(UserRole.CUSTOMER);
  const rechargeId = randomUUID();
  const r1 = await wallet.createRechargeRequest(customer.id, { amount: "50", requestId: rechargeId });
  const r2 = await wallet.createRechargeRequest(customer.id, { amount: "50", requestId: rechargeId });
  expect(r2.id).toBe(r1.id);
  expect(await prisma.rechargeRequest.count({ where: { customerId: customer.id } })).toBe(1);
  // Without an id each submit is its own request, as before.
  await wallet.createRechargeRequest(customer.id, { amount: "50" });
  expect(await prisma.rechargeRequest.count({ where: { customerId: customer.id } })).toBe(2);
});
