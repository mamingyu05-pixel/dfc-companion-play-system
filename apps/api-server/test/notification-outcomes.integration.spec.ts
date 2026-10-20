import { randomUUID } from "node:crypto";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { NotificationDeliveryService } from "../src/modules/bot/notification-delivery.service";
import {
  enqueueJob,
  IntegrationJobsService,
} from "../src/modules/bot/integration-jobs.service";

const prisma = new PrismaService();
const deliveries = new NotificationDeliveryService(prisma);
let calls = 0;
beforeAll(() => prisma.$connect());
beforeEach(async () => {
  await prisma.notificationDelivery.deleteMany();
  await prisma.integrationJob.deleteMany();
  calls = 0;
  process.env.DISCORD_TOKEN = "synthetic";
  process.env.KOOK_TOKEN = "synthetic";
  process.env.DFC_BACKGROUND_JOBS_ENABLED = "false";
  delete process.env.NOTIFICATION_TEST_TIMEOUT_MS;
  (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
    calls++;
    return {
      ok: true,
      json: async () =>
        url.includes("discord")
          ? { id: "synthetic-receipt", channel_id: "synthetic-channel" }
          : { code: 0, data: { msg_id: "synthetic-receipt" } },
    };
  });
});
afterAll(() => prisma.$disconnect());

async function user(role: "ADMIN" | "CUSTOMER") {
  const id = randomUUID();
  return prisma.user.create({
    data: {
      id,
      email: `${id}@synthetic.invalid`,
      displayName: id,
      displayNameKey: id,
      passwordHash: "synthetic",
      role,
    },
  });
}
const send = (key: string) =>
  deliveries.send(
    "DISCORD",
    "synthetic-channel",
    "/channels/synthetic-channel/messages",
    { content: `synthetic ${key}` },
    key,
  );

test("notification outcomes: lost acknowledgement blocks 20 replays and a restarted worker without creating orders or money entries", async () => {
  const before = [
    await prisma.order.count(),
    await prisma.orderDraft.count(),
    await prisma.walletTransaction.count(),
  ];
  (global.fetch as jest.Mock).mockImplementation(async () => {
    calls++;
    throw new TypeError(
      "synthetic platform accepted, response connection lost",
    );
  });
  const key = randomUUID();
  const worker = new IntegrationJobsService(prisma);
  worker.register("SYNTHETIC_OUTCOME", async () => {
    await send(key);
  });
  const job = await enqueueJob(prisma, "SYNTHETIC_OUTCOME", key, {});
  await worker.processOne();
  expect(
    (await prisma.integrationJob.findUniqueOrThrow({ where: { id: job.id } }))
      .status,
  ).toBe("UNKNOWN");
  await Promise.allSettled(Array.from({ length: 20 }, () => send(key)));
  const restarted = new IntegrationJobsService(prisma);
  restarted.register("SYNTHETIC_OUTCOME", async () => {
    await new NotificationDeliveryService(prisma).send(
      "DISCORD",
      "synthetic-channel",
      "/channels/synthetic-channel/messages",
      { content: "replayed" },
      key,
    );
  });
  await restarted.processOne();
  expect(calls).toBe(1);
  expect(await prisma.notificationDelivery.count()).toBe(1);
  expect([
    await prisma.order.count(),
    await prisma.orderDraft.count(),
    await prisma.walletTransaction.count(),
  ]).toEqual(before);
});

test("notification outcomes: an observed platform receipt reconciles to SENT without any resend", async () => {
  const admin = await user("ADMIN");
  const key = randomUUID();
  (global.fetch as jest.Mock).mockImplementationOnce(async () => {
    calls++;
    throw new TypeError("lost reply");
  });
  await expect(send(key)).rejects.toThrow("NotificationOutcomeUnknown");
  const row = await prisma.notificationDelivery.findFirstOrThrow();
  await deliveries.reconcile(row.id, admin.id, {
    decision: "SENT",
    evidence: "Synthetic channel history and business reference matched",
    messageId: "observed-message",
  });
  expect((await send(key)).id).toBe("observed-message");
  expect(calls).toBe(1);
  expect(
    await prisma.adminLog.count({
      where: { entityId: row.id, action: "RECONCILE_NOTIFICATION" },
    }),
  ).toBe(1);
  await expect(
    deliveries.reconcile(row.id, admin.id, {
      decision: "NOT_SENT",
      evidence: "Duplicate decision must be rejected",
    }),
  ).rejects.toThrow();
});

test("notification outcomes: confirmed absence retries only the saved notification, once, with the worker default off", async () => {
  const admin = await user("ADMIN");
  const key = randomUUID();
  const payload = {
    content: "synthetic stable business reference",
    components: [
      {
        type: 1,
        components: [
          { type: 2, custom_id: "order.accept.synthetic-existing-order" },
        ],
      },
    ],
  };
  (global.fetch as jest.Mock).mockImplementationOnce(async () => {
    calls++;
    throw new TypeError("synthetic pre-delivery disconnect");
  });
  await expect(
    deliveries.send(
      "DISCORD",
      "synthetic-channel",
      "/channels/synthetic-channel/messages",
      payload,
      key,
    ),
  ).rejects.toThrow();
  const row = await prisma.notificationDelivery.findFirstOrThrow();
  const before = [
    await prisma.order.count(),
    await prisma.orderDraft.count(),
    await prisma.walletTransaction.count(),
  ];
  const result = await deliveries.reconcile(row.id, admin.id, {
    decision: "NOT_SENT",
    evidence: "Synthetic platform audit confirms request never reached channel",
  });
  expect(result.backgroundDeliveryEnabled).toBe(false);
  expect(result.retryQueued).toBe(true);
  expect(calls).toBe(1);
  const worker = new IntegrationJobsService(prisma);
  worker.register("NOTIFICATION_RESEND", async (p) => {
    await deliveries.retry((p as { deliveryId: string }).deliveryId);
  });
  worker.onModuleInit();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(calls).toBe(1);
  await worker.processOne();
  worker.onModuleDestroy();
  expect(calls).toBe(2);
  const request = (global.fetch as jest.Mock).mock.calls.at(-1)![1];
  expect(JSON.parse(request.body)).toEqual(row.requestBody);
  expect(JSON.parse(request.body).components).toEqual(payload.components);
  expect(JSON.parse(request.body).content).toContain(
    `通知核对号：${row.key.slice(0, 12)}`,
  );
  await deliveries.retry(row.id);
  expect(calls).toBe(2);
  expect([
    await prisma.order.count(),
    await prisma.orderDraft.count(),
    await prisma.walletTransaction.count(),
  ]).toEqual(before);
  expect(
    (
      await prisma.notificationDelivery.findUniqueOrThrow({
        where: { id: row.id },
      })
    ).status,
  ).toBe("SENT");
});

test("notification outcomes: delayed success after timeout remains UNKNOWN and cannot silently trigger another POST", async () => {
  process.env.NOTIFICATION_TEST_TIMEOUT_MS = "20";
  const key = randomUUID();
  (global.fetch as jest.Mock).mockImplementationOnce(async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 90));
    return { ok: true, json: async () => ({ id: "late-platform-message" }) };
  });
  await expect(send(key)).rejects.toThrow("NotificationOutcomeUnknown");
  await new Promise((resolve) => setTimeout(resolve, 120));
  await expect(send(key)).rejects.toThrow("NotificationOutcomeUnknown");
  expect((await prisma.notificationDelivery.findFirstOrThrow()).status).toBe(
    "UNKNOWN",
  );
  expect(calls).toBe(1);
});

test("notification outcomes: persisted SENDING after process loss is quarantined by a fresh service", async () => {
  const key = randomUUID();
  await send(key);
  const row = await prisma.notificationDelivery.findFirstOrThrow();
  await prisma.notificationDelivery.update({
    where: { id: row.id },
    data: {
      status: "SENDING",
      response: undefined,
      messageId: null,
      startedAt: new Date(0),
    },
  });
  await expect(
    new NotificationDeliveryService(prisma).send(
      "DISCORD",
      "synthetic-channel",
      "/channels/synthetic-channel/messages",
      { content: "same business" },
      key,
    ),
  ).rejects.toThrow("NotificationOutcomeUnknown");
  expect(calls).toBe(1);
  expect(
    (
      await prisma.notificationDelivery.findUniqueOrThrow({
        where: { id: row.id },
      })
    ).status,
  ).toBe("UNKNOWN");
});

test("notification outcomes: reconciliation rejects a customer, missing evidence and a missing platform receipt", async () => {
  const [admin, customer] = await Promise.all([
    user("ADMIN"),
    user("CUSTOMER"),
  ]);
  (global.fetch as jest.Mock).mockImplementationOnce(async () => {
    throw new TypeError("synthetic lost reply");
  });
  await expect(send(randomUUID())).rejects.toThrow();
  const row = await prisma.notificationDelivery.findFirstOrThrow();
  await expect(
    deliveries.reconcile(row.id, customer.id, {
      decision: "NOT_SENT",
      evidence: "Synthetic evidence provided by wrong role",
    }),
  ).rejects.toThrow();
  await expect(
    deliveries.reconcile(row.id, admin.id, {
      decision: "NOT_SENT",
      evidence: "",
    }),
  ).rejects.toThrow();
  await expect(
    deliveries.reconcile(row.id, admin.id, {
      decision: "SENT",
      evidence: "Synthetic evidence but no receipt",
    }),
  ).rejects.toThrow();
  expect(
    (
      await prisma.notificationDelivery.findUniqueOrThrow({
        where: { id: row.id },
      })
    ).status,
  ).toBe("UNKNOWN");
});
