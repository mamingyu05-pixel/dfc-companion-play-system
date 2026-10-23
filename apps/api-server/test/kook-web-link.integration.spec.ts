import { randomInt, randomUUID } from "node:crypto";
import { JwtService } from "@nestjs/jwt";
import { BotPlatform, UserRole } from "@prisma/client";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { AuthService } from "../src/modules/auth/auth.service";
import { KookOrderFlowService } from "../src/modules/kook/kook-order-flow.service";
import { flowCard } from "../src/modules/kook/kook-flow-card";

const prisma = new PrismaService();
const auth = new AuthService(prisma, new JwtService({}));
beforeAll(() => { process.env.JWT_SECRET ??= "web-link-test-secret"; process.env.CUSTOMER_WEB_URL = "https://demo.invalid/customer"; process.env.COMPANION_WEB_URL = "https://demo.invalid/companion"; return prisma.$connect(); });
afterAll(() => prisma.$disconnect());

async function kookUser(role: UserRole, balance = "0") {
  const name = randomUUID();
  const kookId = String(randomInt(10 ** 9, 2 ** 47));
  const user = await prisma.user.create({ data: {
    email: `${name}@synthetic.invalid`, displayName: name, displayNameKey: name, passwordHash: "x", role,
    wallet: { create: { availableBalance: balance, pendingIncome: role === "COMPANION" ? "80.00" : "0" } },
    externalAccounts: { create: { platform: BotPlatform.KOOK, externalUserId: kookId } }
  } });
  return { user, kookId };
}

function flows() {
  const sent: Array<{ userId: string; card: unknown }> = [];
  const port = { send: async (userId: string, card: unknown) => { sent.push({ userId, card }); return {}; }, wasIssuedTo: async () => true, wasIssuedInChannel: async () => true };
  return { sent, service: new KookOrderFlowService(prisma, {} as never, {} as never, port as never, auth) };
}
const buttons = (card: unknown) => (card as Array<{ modules: Array<{ type: string; elements?: Array<{ click: string; value: string; text: { content: string } }> }> }>)
  .flatMap(c => c.modules).filter(m => m.type === "action-group").flatMap(m => m.elements ?? []);
const texts = (card: unknown) => JSON.stringify(card);

test("card buttons with a url open the browser instead of calling the bot", () => {
  const [link] = buttons(flowCard("t", [], [{ label: "网页", value: "", url: "https://demo.invalid/x" }]));
  expect(link).toMatchObject({ click: "link", value: "https://demo.invalid/x" });
});

test("余额 shows balance and level, and its web button signs the customer in exactly once", async () => {
  const { user, kookId } = await kookUser("CUSTOMER", "88.50");
  await prisma.rechargeRequest.create({ data: { customerId: user.id, amount: "300.00", screenshotUrl: "x", status: "APPROVED" } });
  const { sent, service } = flows();
  expect(service.acceptsCommand("余额")).toBe(true);
  await service.command(kookId, randomUUID(), "余额");
  const card = sent[0].card;
  expect(texts(card)).toContain("可用余额 ¥88.50");
  expect(texts(card)).toContain("累计充值 ¥300.00 · 会员等级 小小会员 Lv.2");
  const link = buttons(card).find(b => b.click === "link")!;
  expect(link.value).toMatch(/^https:\/\/demo\.invalid\/api\/auth\/web-link\?t=[A-Za-z0-9_-]{43}$/);

  const token = new URL(link.value).searchParams.get("t");
  const first = new URL(await auth.redeemWebLoginLink(token));
  expect(first.origin + first.pathname).toBe("https://demo.invalid/customer/oauth-callback");
  // The session travels in the fragment, which browsers never send to the server (so it never lands in access logs).
  expect(first.search).toBe("");
  const session = new URLSearchParams(first.hash.slice(1));
  expect(session.get("role")).toBe("CUSTOMER");
  expect(session.get("token")).toBeTruthy();
  // A second tap or a forwarded copy no longer works.
  const second = new URL(await auth.redeemWebLoginLink(token));
  expect(second.searchParams.get("error")).toContain("链接已失效");
  // Only the hash is stored.
  expect(await prisma.webLoginLink.count({ where: { tokenHash: token! } })).toBe(0);
});

test("companions get their earnings and a link into the companion portal; expired or malformed links fail", async () => {
  const { user, kookId } = await kookUser("COMPANION");
  const { sent, service } = flows();
  await service.command(kookId, randomUUID(), "余额");
  expect(texts(sent[0].card)).toContain("待结算 ¥80.00");
  const token = new URL(buttons(sent[0].card).find(b => b.click === "link")!.value).searchParams.get("t");
  expect(new URL(await auth.redeemWebLoginLink(token)).pathname).toBe("/companion/oauth-callback");

  await service.command(kookId, randomUUID(), "我的订单");
  const orderLink = buttons(sent[1].card).find(b => b.click === "link")!;
  expect(orderLink.text.content).toBe("在网页打开工作台");
  await prisma.webLoginLink.updateMany({ where: { userId: user.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
  expect(new URL(await auth.redeemWebLoginLink(new URL(orderLink.value).searchParams.get("t"))).searchParams.get("error")).toBeTruthy();
  expect(new URL(await auth.redeemWebLoginLink("not-a-token")).searchParams.get("error")).toBeTruthy();
  expect(new URL(await auth.redeemWebLoginLink(undefined)).searchParams.get("error")).toBeTruthy();
});
