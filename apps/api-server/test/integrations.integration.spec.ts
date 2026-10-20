import { randomUUID } from "node:crypto";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import {
  enqueueJob,
  IntegrationJobsService,
} from "../src/modules/bot/integration-jobs.service";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { OrderDraftsService } from "../src/modules/orders/order-drafts.service";
import { PlatformSupportService } from "../src/modules/support/platform-support.service";
import { KookWebhookController } from "../src/modules/kook/kook-webhook.controller";
import { AuthService } from "../src/modules/auth/auth.service";
import { NotificationDeliveryService } from "../src/modules/bot/notification-delivery.service";

const prisma = new PrismaService();
const jobs = new IntegrationJobsService(prisma);
const deliveries = new NotificationDeliveryService(prisma);
const bot = new BotNotificationService(prisma, jobs, deliveries);
const orders = new OrdersService(prisma, bot);
const drafts = new OrderDraftsService(prisma, orders, bot);
const support = new PlatformSupportService(prisma, drafts);
const kookCards = new Map<string, string>();
const outbound: Array<{ url: string; body: any; method: string }> = [];
beforeAll(async () => {
  await prisma.$connect();
  bot.onModuleInit();
});
beforeEach(async () => {
  await prisma.integrationJob.deleteMany();
  await prisma.notificationDelivery.deleteMany();
  outbound.length = 0;
  kookCards.clear();
  Object.assign(process.env, {
    DISCORD_TOKEN: "synthetic",
    DISCORD_ORDER_CHANNEL_ID: "synthetic-discord",
    KOOK_TOKEN: "synthetic",
    KOOK_ORDER_CHANNEL_ID: "synthetic-kook",
    KOOK_VERIFY_TOKEN: "synthetic-verify",
    PLATFORM_AUTO_CREATE_CUSTOMER_ENABLED: "false",
    AI_AUTO_DISPATCH_ENABLED: "true",
  });
  (global.fetch as jest.Mock).mockImplementation(
    async (url: string, init: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.includes("/api/v3/message/view?")) {
        return { ok: true, json: async () => ({ code: 0,
          data: { content: kookCards.get(new URL(url).searchParams.get("msg_id")!) } }) };
      }
      outbound.push({ url, body, method: init.method! });
      if (url.endsWith("/message/create") && url.includes("kook")) kookCards.set(`kook-${outbound.length}`, body.content);
      if (url.endsWith("/message/update")) kookCards.set(body.msg_id, body.content);
      return {
        ok: true,
        json: async () =>
          url.includes("discord.com")
            ? {
                id: `discord-${outbound.length}`,
                channel_id: "synthetic-discord",
              }
            : { code: 0, data: { msg_id: `kook-${outbound.length}` } },
      };
    },
  );
});
afterAll(async () => {
  jobs.onModuleDestroy();
  await prisma.$disconnect();
});

async function makeUser(role: "ADMIN" | "CUSTOMER" | "COMPANION") {
  const id = randomUUID();
  return prisma.user.create({
    data: {
      email: `${id}@synthetic.invalid`,
      displayName: id,
      displayNameKey: id,
      passwordHash: "synthetic",
      role,
    },
  });
}

test("platform notifications: assigned Discord and KOOK cards both carry order.accept, and refresh removes actions", async () => {
  const [customer, companion] = await Promise.all([
    makeUser("CUSTOMER"),
    makeUser("COMPANION"),
  ]);
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      companionId: companion.id,
      orderNo: randomUUID(),
      mode: "synthetic",
      hours: "1",
      unitPrice: "100",
      totalAmount: "100",
      status: "ASSIGNED",
    },
  });
  const result = await bot.sendOrderAssignedNotifications(order.id);
  expect(result.every((r) => r.status === "SENT")).toBe(true);
  const discord = outbound.find((r) => r.url.includes("discord.com"))!.body;
  const kook = JSON.parse(
    outbound.find((r) => r.url.includes("kook"))!.body.content,
  );
  expect(discord.components[0].components[0].custom_id).toBe(
    `order.accept.${order.id}.${order.dispatchVersion}`,
  );
  expect(JSON.stringify(kook)).toContain(`order.accept.${order.id}.${order.dispatchVersion}`);
  await prisma.order.update({
    where: { id: order.id },
    data: { status: "ACCEPTED" },
  });
  await bot.refreshAcceptedOrderCards(order.id);
  expect(
    outbound.filter((r) => r.method === "PATCH")[0].body.components,
  ).toEqual([]);
  expect(
    outbound.find((r) => r.url.endsWith("message/update"))!.body.content,
  ).not.toContain("return-val");
});

test.each([
  ["ACCEPTED", false, undefined, true],
  ["IN_PROGRESS", true, undefined, true],
  ["AWAITING_ACCEPTANCE", true, undefined, true],
  ["COMPLETED", true, undefined, true],
  ["DISPUTED", true, undefined, true],
  ["DISPUTED", false, undefined, false],
  ["IN_PROGRESS", false, undefined, false],
  ["CANCELLED", false, undefined, false],
  ["CANCELLED", true, undefined, false],
  ["REFUND_REQUESTED", true, undefined, false],
  ["REFUNDED", true, undefined, false],
  ["ASSIGNED", false, 2, false],
  ["PAID", false, 2, false],
  ["ACCEPTED", true, 2, false],
  ["COMPLETED", true, 2, false],
] as const)("card refresh: status=%s acceptedAt=%s staleBeforeVersion=%s accepted wording=%s", async (status, accepted, staleBeforeVersion, acceptedWording) => {
  const [customer, companion] = await Promise.all([makeUser("CUSTOMER"), makeUser("COMPANION")]);
  const order = await prisma.order.create({ data: {
    customerId: customer.id, companionId: companion.id, orderNo: randomUUID(),
    mode: "synthetic", hours: "1", unitPrice: "100", totalAmount: "100",
    status: "ASSIGNED", dispatchVersion: 1,
  } });
  await bot.sendOrderAssignedNotifications(order.id);
  await prisma.order.update({ where: { id: order.id }, data: {
    status, acceptedAt: accepted ? new Date() : null,
  } });
  outbound.length = 0;
  await bot.refreshAcceptedOrderCards(order.id, staleBeforeVersion);
  const original = `订单 ${order.orderNo} 状态已更新，此卡片已失效，请到订单页查看。`;
  const kook = outbound.find(r => r.url.endsWith("/message/update"))!.body;
  // Exact payload also proves there are no action modules or private companion fields.
  expect(JSON.parse(kook.content)).toEqual([{
    type: "card", theme: "success", size: "lg", modules: [{
      type: "section", text: { type: "plain-text", content: acceptedWording
        ? `订单 ${order.orderNo} 已被接单，此卡片已关闭` : status === "CANCELLED"
          ? `订单 ${order.orderNo} 已取消，此卡片已关闭` : original },
    }],
  }]);
  for (const privateValue of [companion.id, companion.displayName, companion.email]) {
    expect(kook.content).not.toContain(privateValue);
  }
  // Cancelling an accepted order leaves its Discord card alone.
  if (status === "CANCELLED" && accepted) {
    expect(outbound.filter(r => r.method === "PATCH")).toHaveLength(0);
    return;
  }
  expect(outbound.find(r => r.method === "PATCH")!.body).toEqual({
    content: acceptedWording ? `订单 ${order.orderNo} 已被接单，此卡片已关闭` : original, components: [], allowed_mentions: { parse: [] },
  });
});

test.each(["replacement", "decline", "timeout"])("accepted refresh preserves old cards after %s and redispatch", async (reason) => {
  const order = { id: "synthetic-order", orderNo: "SYNTHETIC", status: "ASSIGNED",
    dispatchVersion: 1, acceptedAt: null as Date | null };
  const events: any[] = [];
  const receipts: any[] = [];
  const localBot = new BotNotificationService({
    order: { findUniqueOrThrow: async () => order },
    botEvent: { findMany: async () => events },
    notificationDelivery: { findMany: async () => receipts },
  } as any, jobs, deliveries);
  const addCards = (version?: number) => {
    for (const platform of ["KOOK", "DISCORD"]) {
      // Cover events, delivery-only recovery, and deduplication of both records.
      for (const source of ["event", "receipt", "both"]) {
        const id = `${platform}-${version ?? "legacy"}-${source}`;
        if (source !== "receipt") events.push({ platform, platformMessageId: id,
          platformChannelId: "synthetic-channel", payload: version === undefined ? {} : { dispatchVersion: version } });
        if (source !== "event") receipts.push({ platform, messageId: id, target: "synthetic-channel",
          businessKey: `order-notice:${order.id}:companion${version === undefined ? "" : `:v${version}`}` });
      }
    }
  };
  addCards();
  addCards(1);
  // Replacement dispatches immediately; decline and timeout first return to PAID.
  order.status = reason === "replacement" ? "ASSIGNED" : "PAID";
  order.dispatchVersion = 2;
  await localBot.refreshAcceptedOrderCards(order.id, 2);
  const messageId = (r: typeof outbound[number]) => r.body.msg_id ?? r.url.split("/").pop();
  const oldCards = new Map(outbound.map(r => [messageId(r), r.body.content]));
  expect(oldCards.size).toBe(12);
  for (const content of oldCards.values()) expect(content).toContain("状态已更新");
  order.status = "ASSIGNED";
  addCards(2);
  outbound.length = 0;
  order.status = "ACCEPTED";
  order.acceptedAt = new Date();
  await localBot.refreshAcceptedOrderCards(order.id);
  expect(outbound).toHaveLength(6);
  for (const update of outbound) {
    expect(messageId(update)).toMatch(/-2-/);
    expect(oldCards.has(messageId(update))).toBe(false);
    if (update.method === "PATCH") {
      expect(update.body).toEqual({ content: "订单 SYNTHETIC 已被接单，此卡片已关闭",
        components: [], allowed_mentions: { parse: [] } });
    } else {
      expect(JSON.parse(update.body.content)).toEqual([{ type: "card", theme: "success", size: "lg",
        modules: [{ type: "section", text: { type: "plain-text", content: "订单 SYNTHETIC 已被接单，此卡片已关闭" } }] }]);
    }
  }
  // Apply actual simulated updates: old text must survive unchanged.
  const displayed = new Map(oldCards);
  for (const update of outbound) displayed.set(messageId(update), update.body.content);
  for (const [id, text] of oldCards) expect(displayed.get(id)).toBe(text);
});

test.each(["PAID", "ASSIGNED", "ACCEPTED"] as const)("admin cancellation queues card closure after commit from %s", async status => {
  const [customer, companion, admin] = await Promise.all([
    makeUser("CUSTOMER"), makeUser("COMPANION"), makeUser("ADMIN"),
  ]);
  await prisma.wallet.create({ data: { userId: customer.id, frozenBalance: "100" } });
  const order = await prisma.order.create({ data: {
    customerId: customer.id, companionId: companion.id, orderNo: randomUUID(),
    mode: "synthetic", hours: "1", unitPrice: "100", totalAmount: "100",
    status: "ASSIGNED", dispatchVersion: 1,
  } });
  await bot.sendOrderAssignedNotifications(order.id);
  await prisma.order.update({ where: { id: order.id }, data: {
    status, acceptedAt: status === "ACCEPTED" ? new Date() : null,
  } });
  if (status === "ACCEPTED") await bot.refreshAcceptedOrderCards(order.id);
  outbound.length = 0;
  await orders.cancelOrderByAdmin(admin.id, order.id);
  expect(outbound).toHaveLength(0);
  const cancelled = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  expect(cancelled.status).toBe("REFUNDED");
  expect(cancelled.cancelledAt).not.toBeNull();
  const job = await prisma.integrationJob.findUniqueOrThrow({
    where: { key: `order-cancelled:${order.id}:1` },
  });
  expect(job.kind).toBe("ORDER_CARD_REFRESH");
  expect(await jobs.processOne()).toBe(true);
  expect((await prisma.integrationJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("COMPLETED");
  const updates = outbound.filter(r => r.url.endsWith("/message/update"));
  expect(updates).toHaveLength(status === "ACCEPTED" ? 0 : 1);
  if (status !== "ACCEPTED") {
    expect(JSON.parse(updates[0].body.content)).toEqual([{
      type: "card", theme: "success", size: "lg", modules: [{ type: "section",
        text: { type: "plain-text", content: `订单 ${order.orderNo} 已取消，此卡片已关闭` } }],
    }]);
  }
  // The "已被接单" Discord card keeps its wording; a still-open one is closed once.
  const patches = outbound.filter(r => r.method === "PATCH");
  expect(patches).toHaveLength(status === "ACCEPTED" ? 0 : 1);
  if (status !== "ACCEPTED") {
    expect(patches[0].body).toEqual({
      content: `订单 ${order.orderNo} 状态已更新，此卡片已失效，请到订单页查看。`,
      components: [], allowed_mentions: { parse: [] },
    });
  }
  outbound.length = 0;
  await bot.refreshAcceptedOrderCards(order.id);
  expect(outbound.filter(r => r.url.endsWith("/message/update"))).toHaveLength(0);
});

test.each([
  ["decline", "cancel-first"], ["decline", "return-first"],
  ["timeout", "cancel-first"], ["timeout", "return-first"],
] as const)("cancellation right after %s (%s) still closes the returned card with its original wording", async (reason, sequence) => {
  const [customer, companion] = await Promise.all([makeUser("CUSTOMER"), makeUser("COMPANION")]);
  const order = await prisma.order.create({ data: {
    customerId: customer.id, companionId: companion.id, orderNo: randomUUID(),
    mode: "synthetic", hours: "1", unitPrice: "100", totalAmount: "100",
    status: "ASSIGNED", dispatchVersion: 1,
  } });
  await bot.sendOrderAssignedNotifications(order.id);
  const sent = outbound.find(r => r.url.endsWith("/message/create") && r.url.includes("kook"))!;
  const kookId = [...kookCards.entries()].find(([, content]) => content === sent.body.content)![0];
  // Decline and timeout both return the order to PAID on the next dispatch version,
  // then it is cancelled before (or while) the returned-card refresh runs.
  await prisma.order.update({ where: { id: order.id }, data: {
    status: "CANCELLED", cancelledAt: new Date(), dispatchVersion: 2,
  } });
  outbound.length = 0;
  const original = `订单 ${order.orderNo} 状态已更新，此卡片已失效，请到订单页查看。`;
  const returnedRefresh = async () => {
    await bot.refreshAcceptedOrderCards(order.id, 2);
    const updates = outbound.filter(r => r.url.endsWith("/message/update"));
    expect(updates.map(r => r.body.msg_id)).toEqual([kookId]);
    expect(JSON.parse(updates[0].body.content)).toEqual([{
      type: "card", theme: "success", size: "lg", modules: [{ type: "section",
        text: { type: "plain-text", content: original } }],
    }]);
    expect(outbound.filter(r => r.method === "PATCH").map(r => r.body)).toEqual([
      { content: original, components: [], allowed_mentions: { parse: [] } },
    ]);
    outbound.length = 0;
  };
  // The cancellation job only owns cards of the current dispatch, of which there are none.
  const cancelRefresh = async () => {
    await bot.refreshAcceptedOrderCards(order.id);
    expect(outbound).toHaveLength(0);
  };
  if (sequence === "cancel-first") { await cancelRefresh(); await returnedRefresh(); }
  else { await returnedRefresh(); await cancelRefresh(); }
  expect(kookCards.get(kookId)).not.toContain("return-val");
});

test("cancellation leaves Discord cards of other dispatch versions untouched", async () => {
  const order = { id: "synthetic-order", orderNo: "SYNTHETIC", status: "CANCELLED",
    dispatchVersion: 2, acceptedAt: null as Date | null, cancelledAt: new Date() };
  const events = [undefined, 1, 2, 3].map(version => ({ platform: "DISCORD",
    platformMessageId: `discord-${version ?? "legacy"}`, platformChannelId: "synthetic-channel",
    payload: version === undefined ? {} : { dispatchVersion: version } }));
  const localBot = new BotNotificationService({
    order: { findUniqueOrThrow: async () => order },
    botEvent: { findMany: async () => events },
    notificationDelivery: { findMany: async () => [] },
  } as any, jobs, deliveries);
  await localBot.refreshAcceptedOrderCards(order.id);
  expect(outbound.map(r => r.url.split("/").pop())).toEqual(["discord-2"]);
  outbound.length = 0;
  order.acceptedAt = new Date();
  await localBot.refreshAcceptedOrderCards(order.id);
  expect(outbound).toHaveLength(0);
});

test.each(["accepted", "replacement", "decline", "timeout"])("cancellation preserves cards already closed by %s, legacy and other versions", async reason => {
  const customer = await makeUser("CUSTOMER");
  const order = await prisma.order.create({ data: {
    customerId: customer.id, orderNo: randomUUID(), mode: "synthetic",
    hours: "1", unitPrice: "100", totalAmount: "100", status: "ASSIGNED", dispatchVersion: 1,
  } });
  await bot.sendOrderAssignedNotifications(order.id);
  if (reason === "accepted") {
    await prisma.order.update({ where: { id: order.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
    await bot.refreshAcceptedOrderCards(order.id);
  } else {
    await prisma.order.update({ where: { id: order.id }, data: { status: reason === "replacement" ? "ASSIGNED" : "PAID" } });
    await bot.refreshAcceptedOrderCards(order.id, 2);
  }
  const old = outbound.find(r => r.url.endsWith("/message/update"))!;
  expect(old.body.content).toContain(reason === "accepted" ? "已被接单" : "状态已更新");
  // Also cover unmarked older, unversioned and future cards and receipt-only recovery.
  for (const version of [undefined, 0, 2, 1]) {
    kookCards.set(`${order.id}-${version ?? "legacy"}`, JSON.stringify([{ modules: [{
      type: "action-group", elements: [{ click: "return-val", value: `order.accept.${order.id}.${version ?? 1}` }],
    }] }]));
    await prisma.botEvent.create({ data: {
      orderId: order.id, type: "ORDER_NOTIFICATION_SENT", status: "SENT", platform: "KOOK",
      platformMessageId: `${order.id}-${version ?? "legacy"}`,
      payload: version === undefined ? {} : { dispatchVersion: version },
    } });
  }
  kookCards.set(`${order.id}-receipt`, kookCards.get(`${order.id}-1`)!);
  await prisma.notificationDelivery.create({ data: {
    key: randomUUID(), platform: "KOOK", target: "synthetic-kook", path: "/api/v3/message/create",
    businessKey: `order-notice:${order.id}:receipt-only:v1`, status: "SENT",
    messageId: `${order.id}-receipt`, requestBody: {},
  } });
  await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
  outbound.length = 0;
  await bot.refreshAcceptedOrderCards(order.id);
  const updates = outbound.filter(r => r.url.endsWith("/message/update"));
  expect(updates.map(r => r.body.msg_id).sort()).toEqual([`${order.id}-1`, `${order.id}-receipt`].sort());
  for (const update of updates) {
    expect(JSON.parse(update.body.content)).toEqual([{
      type: "card", theme: "success", size: "lg", modules: [{ type: "section",
        text: { type: "plain-text", content: `订单 ${order.orderNo} 已取消，此卡片已关闭` } }],
    }]);
  }
  outbound.length = 0;
  // A fresh service instance must retain closure knowledge.
  await new BotNotificationService(prisma, jobs, deliveries).refreshAcceptedOrderCards(order.id);
  expect(outbound.filter(r => r.url.endsWith("/message/update"))).toHaveLength(0);
});

test("cancelled card lookup failure leaves the card untouched and allows a later retry", async () => {
  const customer = await makeUser("CUSTOMER");
  const order = await prisma.order.create({ data: {
    customerId: customer.id, orderNo: randomUUID(), mode: "synthetic",
    hours: "1", unitPrice: "100", totalAmount: "100", status: "ASSIGNED", dispatchVersion: 1,
  } });
  await bot.sendOrderAssignedNotifications(order.id);
  await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
  outbound.length = 0;
  const success = (global.fetch as jest.Mock).getMockImplementation()!;
  (global.fetch as jest.Mock).mockImplementation(async (url: string, init: RequestInit) =>
    url.includes("/message/view?") ? { ok: false, status: 503 } : success(url, init));
  await expect(bot.refreshAcceptedOrderCards(order.id)).rejects.toThrow("KOOK card lookup HTTP 503");
  expect(outbound.filter(r => r.url.endsWith("/message/update"))).toHaveLength(0);
  (global.fetch as jest.Mock).mockImplementation(success);
  await bot.refreshAcceptedOrderCards(order.id);
  expect(outbound.filter(r => r.url.endsWith("/message/update"))).toHaveLength(1);
});

test("KOOK inbox: 20 replays ACK before slow support processing; one draft and one notification set survive worker recreation", async () => {
  const [admin, customer] = await Promise.all([
    makeUser("ADMIN"),
    makeUser("CUSTOMER"),
  ]);
  const platformUserId = String(Date.now());
  await prisma.userExternalAccount.create({
    data: {
      userId: customer.id,
      platform: "KOOK",
      externalUserId: platformUserId,
    },
  });
  // The summary must already be on record; only the customer's confirmation travels through the inbox.
  const collected = await support.handlePlatformMessage({
    platform: "KOOK",
    platformUserId,
    isDirect: true,
    messageId: randomUUID(),
    content:
      "三角洲行动 娱乐陪玩1小时，现在开始，不用试音，预算100元，找陪玩",
  });
  expect(collected.matchedTopic).toBe("需求待确认");
  const handle = support.handlePlatformMessage.bind(support);
  const resolver = jest
    .spyOn(support, "handlePlatformMessage")
    .mockImplementation(async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return handle(input);
    });
  const body = {
    verify_token: "synthetic-verify",
    d: {
      type: 1,
      channel_type: "PERSON",
      author_id: platformUserId,
      msg_id: randomUUID(),
      content: "确认发布需求",
    },
  };
  const receiver = new KookWebhookController(
    orders,
    drafts,
    support,
    bot,
    {} as AuthService,
    prisma,
    jobs,
  );
  receiver.onModuleInit();
  const started = Date.now();
  await Promise.all(Array.from({ length: 20 }, () => receiver.webhook(body)));
  expect(Date.now() - started).toBeLessThan(1000);
  expect(resolver).not.toHaveBeenCalled();
  expect(
    await prisma.integrationJob.count({ where: { kind: "KOOK_EVENT" } }),
  ).toBe(1);
  const inbox = await prisma.integrationJob.findFirstOrThrow({
    where: { kind: "KOOK_EVENT" },
  });
  expect(JSON.stringify(inbox.payload)).not.toContain("synthetic-verify");
  // A new process has no in-memory receipt cache and still consumes the saved event.
  const restarted = new IntegrationJobsService(prisma);
  const restartedReceiver = new KookWebhookController(
    orders,
    drafts,
    support,
    bot,
    {} as AuthService,
    prisma,
    restarted,
  );
  restartedReceiver.onModuleInit();
  await Promise.all([restarted.processOne(), jobs.processOne()]);
  expect(resolver).toHaveBeenCalledTimes(1);
  const created = await prisma.orderDraft.findMany({
    where: { customerId: customer.id },
  });
  expect(created.length).toBe(1);
  const notifications = () =>
    prisma.botEvent.count({
      where: {
        status: "SENT",
        payload: { path: ["draftId"], equals: created[0].id },
      },
    });
  // The demand waits with the service desk; recruitment starts only with the manual fallback.
  await jobs.processOne();
  expect(await notifications()).toBe(0);
  await drafts.publishFallback(admin.id, created[0].id);
  await jobs.processOne();
  expect(await notifications()).toBe(2);
  await receiver.webhook(body);
  await jobs.processOne();
  expect(resolver).toHaveBeenCalledTimes(1);
  expect(
    await prisma.orderDraft.count({
      where: { customerId: customer.id },
    }),
  ).toBe(1);
  resolver.mockRestore();
});

test("draft business idempotency: 20 direct same-source calls create one draft and one dispatch job", async () => {
  const admin = await makeUser("ADMIN");
  const message = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      drafts.createDraftFromDemand(admin.id, {
        sourcePlatform: "KOOK",
        sourceMessageId: message,
        sourceChannelId: "synthetic",
        demandText: "三角洲行动 娱乐陪玩1小时",
      }),
    ),
  );
  expect(new Set(results.map((r) => r.draft.id)).size).toBe(1);
  // The single dispatch job now comes from the service desk's manual fallback, not from draft creation.
  await drafts.publishFallback(admin.id, results[0].draft.id);
  expect(
    await prisma.integrationJob.count({
      where: { key: `draft-dispatch:${results[0].draft.id}` },
    }),
  ).toBe(1);
});

test("draft business idempotency: same-source calls wait for manual fallback, repeated publication creates one job", async () => {
  const admin = await makeUser("ADMIN");
  const message = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      drafts.createDraftFromDemand(admin.id, {
        sourcePlatform: "KOOK",
        sourceMessageId: message,
        sourceChannelId: "synthetic",
        demandText: "三角洲行动 娱乐陪玩1小时",
      }),
    ),
  );
  expect(new Set(results.map((r) => r.draft.id)).size).toBe(1);
  expect(await prisma.integrationJob.count({ where: { key: `draft-dispatch:${results[0].draft.id}` } })).toBe(0);
  await Promise.all(Array.from({ length: 3 }, () => drafts.publishFallback(admin.id, results[0].draft.id)));
  expect(
    await prisma.integrationJob.count({
      where: { key: `draft-dispatch:${results[0].draft.id}` },
    }),
  ).toBe(1);
});

test("draft dispatch: lost platform ACK plus webhook-source replay preserves one draft and never repeats the uncertain POST", async () => {
  const admin = await makeUser("ADMIN");
  const sourceMessageId = randomUUID();
  const input = {
    sourcePlatform: "KOOK" as const,
    sourceMessageId,
    sourceChannelId: "synthetic",
    demandText: "三角洲行动 娱乐陪玩1小时",
  };
  const created = await drafts.createDraftFromDemand(admin.id, input);
  await drafts.publishFallback(admin.id, created.draft.id);
  const normalFetch = (global.fetch as jest.Mock).getMockImplementation()!;
  let discordPosts = 0;
  (global.fetch as jest.Mock).mockImplementation(async (...args: any[]) => {
    if (String(args[0]).includes("discord.com")) {
      discordPosts++;
      throw new TypeError("synthetic accepted dispatch but lost ACK");
    }
    return normalFetch(...args);
  });
  const moneyEntries = await prisma.walletTransaction.count();
  await jobs.processOne();
  expect(
    (
      await prisma.integrationJob.findUniqueOrThrow({
        where: { key: `draft-dispatch:${created.draft.id}` },
      })
    ).status,
  ).toBe("UNKNOWN");
  await Promise.all(
    Array.from({ length: 20 }, () =>
      drafts.createDraftFromDemand(admin.id, input),
    ),
  );
  const restarted = new IntegrationJobsService(prisma);
  const restartedBot = new BotNotificationService(
    prisma,
    restarted,
    new NotificationDeliveryService(prisma),
  );
  restartedBot.onModuleInit();
  await restarted.processOne();
  await restartedBot.sendOrderDraftDispatchNotifications(created.draft.id);
  expect(discordPosts).toBe(1);
  expect(await prisma.orderDraft.count({ where: { sourceMessageId } })).toBe(1);
  expect(await prisma.walletTransaction.count()).toBe(moneyEntries);
  expect(
    await prisma.notificationDelivery.count({
      where: { businessKey: `draft-dispatch:${created.draft.id}` },
    }),
  ).toBe(2);
});

test("integration worker: a failed durable job retries without losing its identity", async () => {
  let attempts = 0;
  const worker = new IntegrationJobsService(prisma);
  worker.register("SYNTHETIC_RETRY", async () => {
    if (++attempts === 1) throw new Error("SyntheticFailure");
  });
  const queued = await enqueueJob(prisma, "SYNTHETIC_RETRY", randomUUID(), {
    synthetic: true,
  });
  await worker.processOne();
  expect(
    (
      await prisma.integrationJob.findUniqueOrThrow({
        where: { id: queued.id },
      })
    ).status,
  ).toBe("PENDING");
  await prisma.integrationJob.update({
    where: { id: queued.id },
    data: { nextAttemptAt: new Date(0) },
  });
  await worker.processOne();
  const done = await prisma.integrationJob.findUniqueOrThrow({
    where: { id: queued.id },
  });
  expect(done.status).toBe("COMPLETED");
  expect(done.attempts).toBe(2);
});

test("integration worker: a crash on the final attempt becomes a visible failed job instead of hanging forever", async () => {
  const worker = new IntegrationJobsService(prisma);
  worker.register("SYNTHETIC_CRASH", async () => {
    throw new Error("Must not run");
  });
  const job = await enqueueJob(prisma, "SYNTHETIC_CRASH", randomUUID(), {});
  await prisma.integrationJob.update({
    where: { id: job.id },
    data: { status: "PROCESSING", attempts: 5, leaseUntil: new Date(0) },
  });
  await worker.processOne();
  expect(
    (await prisma.integrationJob.findUniqueOrThrow({ where: { id: job.id } }))
      .status,
  ).toBe("FAILED");
});

test("service desk support: confirmed customer demand waits for manual fallback without charging or duplicate drafts", async () => {
  const admin = await makeUser("ADMIN"), customer = await makeUser("CUSTOMER");
  const platformUserId = randomUUID();
  await prisma.userExternalAccount.create({ data: {
    userId: customer.id, platform: "KOOK", externalUserId: platformUserId,
  } });
  const input = { platform: "KOOK" as const, platformUserId, isDirect: true };
  const collected = await support.handlePlatformMessage({ ...input, messageId: randomUUID(),
    content: "三角洲行动 娱乐陪玩1小时，现在开始，不用试音，预算100元，找陪玩",
  });
  expect(collected.matchedTopic).toBe("需求待确认");
  expect(collected.draft).toBeNull();
  const confirmation = { ...input, messageId: randomUUID(), content: "确认发布需求" };
  const confirmed = await support.handlePlatformMessage(confirmation);
  expect(confirmed.matchedTopic).toBe("需求已记录");
  expect(confirmed.draft).not.toBeNull();
  expect(confirmed.reply).toContain("已交给客服安排");
  expect(confirmed.reply).not.toContain("通知待发送");
  await support.handlePlatformMessage(confirmation);
  await support.handlePlatformMessage({ ...confirmation, messageId: randomUUID() });
  const saved = await prisma.orderDraft.findMany({ where: { customerId: customer.id } });
  expect(saved).toHaveLength(1);
  expect(saved[0].status).toBe("OPEN");
  expect(saved[0].serviceAdminId).not.toBeNull();
  expect(saved[0].selectedCompanionId).toBeNull();
  expect(await prisma.order.count({ where: { customerId: customer.id } })).toBe(0);
  expect(await prisma.walletTransaction.count({ where: { userId: customer.id } })).toBe(0);
  expect(await prisma.integrationJob.count({ where: { kind: "DRAFT_DISPATCH" } })).toBe(0);
  // Display-name lookups are reads; nothing may be posted to a platform.
  expect(outbound.filter((r) => r.method)).toHaveLength(0);
  await drafts.publishFallback(admin.id, saved[0].id);
  expect(await prisma.integrationJob.count({ where: { key: `draft-dispatch:${saved[0].id}` } })).toBe(1);
});
