import { randomUUID } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";
import { IntegrationJobsService } from "../src/modules/bot/integration-jobs.service";
import { NotificationDeliveryService } from "../src/modules/bot/notification-delivery.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { OrderDraftsService } from "../src/modules/orders/order-drafts.service";
import { PlatformSupportService } from "../src/modules/support/platform-support.service";
import { SupportKnowledgeController } from "../src/modules/support/support-knowledge.controller";
import { extractiveAnswer, groundedInstruction, knowledgeTerms, retrieveKnowledge } from "../src/modules/support/knowledge";

const prisma = new PrismaService();
const jobs = new IntegrationJobsService(prisma);
const bot = new BotNotificationService(prisma, jobs, new NotificationDeliveryService(prisma));
const drafts = new OrderDraftsService(prisma, new OrdersService(prisma, bot), bot);
const support = new PlatformSupportService(prisma, drafts);
const admin = new SupportKnowledgeController(prisma, support);
const AI_ENV = ["AI_SUPPORT_ENABLED", "AI_SUPPORT_API_KEY", "AI_SUPPORT_API_STYLE", "AI_SUPPORT_BASE_URL", "AI_SUPPORT_MODEL"];
beforeAll(() => prisma.$connect());
afterAll(() => prisma.$disconnect());
afterEach(() => { for (const key of AI_ENV) delete process.env[key]; support.invalidateKnowledgeCache(); jest.restoreAllMocks(); });

async function customer() {
  const id = randomUUID();
  return prisma.user.create({ data: { email: `${id}@synthetic.invalid`, displayName: id, displayNameKey: id, passwordHash: "synthetic", role: "CUSTOMER" } });
}
const doc = (id: string, title: string, content: string, keywords: string[] = []) => ({ id, title, content, keywords });

test("knowledge retrieval: CJK bigrams rank the right entry and ignore unrelated chatter", () => {
  expect([...knowledgeTerms("保底护航 688W")]).toEqual(expect.arrayContaining(["688w", "保底", "底护", "护航"]));
  expect(knowledgeTerms("怎么")).toEqual(new Set());
  const docs = [
    doc("escrow", "资金托管", "下单只冻结余额，验收后才结算给陪玩。", ["托管", "验收"]),
    doc("refund", "退款和投诉", "验收前提交投诉，资金继续冻结。", ["退款", "投诉"]),
  ];
  expect(retrieveKnowledge("钱什么时候结算给陪玩", docs)[0].doc.id).toBe("escrow");
  expect(retrieveKnowledge("想退款", docs)[0].doc.id).toBe("refund");
  expect(retrieveKnowledge("今天天气怎么样", docs)).toEqual([]);
  expect(retrieveKnowledge("", docs)).toEqual([]);
  const long = doc("long", "长", "第一句很短。第二句也不长。" + "很长的第三句".repeat(40) + "。");
  expect(extractiveAnswer({ doc: long, score: 1 }, 20)).toBe("第一句很短。第二句也不长。");
  const instruction = groundedInstruction([{ doc: docs[0], score: 1 }]);
  expect(instruction).toContain("只能依据这些资料回答");
  expect(instruction).toContain("【资料1：资金托管】下单只冻结余额");
});

test("web support answers from seeded knowledge without a model and keeps money issues with humans", async () => {
  const user = await customer();
  const escrow = await support.autoReplyForWeb(user.id, "钱什么时候给陪玩");
  expect(escrow.matchedTopic).toBe("知识库:资金托管：钱什么时候给陪玩");
  expect(escrow.answer).toContain("冻结");
  const guarantee = await support.autoReplyForWeb(user.id, "保底没打到怎么办");
  expect(guarantee.matchedTopic).toMatch(/^知识库:/);
  expect(guarantee.answer).toMatch(/净增|档位|保底/);
  const prices = await support.autoReplyForWeb(user.id, "保底护航档位多少钱");
  expect(prices.matchedTopic).toBe("知识库:保底护航当前档位价格");
  expect(prices.answer).toMatch(/¥\d+\.\d{2}/);
  // Refund and recharge questions still go to a person before any knowledge lookup.
  const refund = await support.autoReplyForWeb(user.id, "我要退款");
  expect([refund.matchedTopic, refund.handoffRequired]).toEqual(["人工核实", true]);
  const chatter = await support.autoReplyForWeb(user.id, "今天天气怎么样");
  expect(chatter.matchedTopic).not.toMatch(/^知识库:/);
});

test("with a model configured, the reply is generated from the retrieved material only", async () => {
  const user = await customer();
  Object.assign(process.env, { AI_SUPPORT_ENABLED: "true", AI_SUPPORT_API_KEY: "synthetic-key", AI_SUPPORT_API_STYLE: "chat_completions",
    AI_SUPPORT_BASE_URL: "http://127.0.0.1:9/v1", AI_SUPPORT_MODEL: "synthetic-model" });
  const calls: Array<{ url: string; body: { model: string; messages: Array<{ role: string; content: string }> } }> = [];
  jest.spyOn(global, "fetch").mockImplementation(async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ choices: [{ message: { content: "钱先冻结在平台，你验收后才结算给陪玩。" } }] }), { status: 200 });
  });
  const reply = await support.autoReplyForWeb(user.id, "钱什么时候给陪玩");
  expect(reply.answer).toContain("钱先冻结在平台，你验收后才结算给陪玩。");
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("http://127.0.0.1:9/v1/chat/completions");
  const system = calls[0].body.messages.filter(m => m.role === "system").map(m => m.content).join("\n");
  expect(system).toContain("只能依据这些资料回答");
  expect(system).toContain("【资料1：资金托管：钱什么时候给陪玩】");

  // A failing model never leaves the customer without an answer: the material itself is returned.
  jest.spyOn(global, "fetch").mockResolvedValue(new Response("down", { status: 503 }));
  const fallback = await support.autoReplyForWeb(user.id, "保底没打到怎么办");
  expect(fallback.matchedTopic).toMatch(/^知识库:/);
  expect(fallback.answer).toMatch(/净增|档位/);
});

test("admins manage knowledge with validation; changes reach answers immediately", async () => {
  const user = await customer();
  const actor = await prisma.user.create({ data: { email: `${randomUUID()}@synthetic.invalid`, displayName: randomUUID(), displayNameKey: randomUUID(), passwordHash: "x", role: "ADMIN" } });
  // Random CJK so earlier runs' rows in the shared synthetic database can never match this term.
  const term = Array.from({ length: 5 }, () => String.fromCharCode(0x4e00 + Math.floor(Math.random() * 0x5000))).join("");
  expect((await support.autoReplyForWeb(user.id, `${term}怎么用`)).matchedTopic).not.toMatch(/^知识库:/);
  const row = await admin.create({ id: actor.id } as never, { title: `${term}规则`, content: `${term}每月一号刷新，只能兑换陪玩时长。`, keywords: [term] });
  expect((await support.autoReplyForWeb(user.id, `${term}怎么用`)).answer).toContain("每月一号刷新");
  await admin.update({ id: actor.id } as never, row.id, { isActive: false });
  expect((await support.autoReplyForWeb(user.id, `${term}怎么用`)).matchedTopic).not.toMatch(/^知识库:/);
  expect(await prisma.adminLog.count({ where: { entityId: row.id } })).toBe(2);
  for (const bad of [{}, { title: "x" }, { title: "x".repeat(81), content: "y" }, { title: "x", content: "y", keywords: "a" }, { title: "x", content: "y", keywords: ["k".repeat(21)] }])
    await expect(admin.create({ id: actor.id } as never, bad)).rejects.toBeInstanceOf(BadRequestException);
  await expect(admin.update({ id: actor.id } as never, row.id, {})).rejects.toBeInstanceOf(BadRequestException);
  await expect(admin.update({ id: actor.id } as never, "missing", { isActive: true })).rejects.toThrow("知识条目不存在");
});

test("everyday customer questions get routed to the right answer instead of the fallback", async () => {
  const ask = async (message: string) => support.autoReplyForWeb((await customer()).id, message);
  expect((await ask("你们是真人还是机器人")).matchedTopic).toBe("客服身份");
  expect((await ask("我想当陪玩怎么申请")).matchedTopic).toBe("陪玩入驻");
  // Policy questions about money read the knowledge base; an actual missing payment still goes to a person.
  expect((await ask("怎么充值？可以微信吗")).matchedTopic).not.toBe("人工核实");
  expect(await ask("我充了钱没到账")).toMatchObject({ matchedTopic: "人工核实", handoffRequired: true });
  expect((await ask("提现到账了吗")).answer).toContain("提现");
  expect(await ask("陪玩迟到了半小时怎么办")).toMatchObject({ matchedTopic: "人工核实", handoffRequired: true });
  // Delta Force mode names imply the game, so the price answer doesn't ask which game.
  expect((await ask("烽火地带和全面战场价格一样吗")).answer).not.toContain("哪个游戏");
});
