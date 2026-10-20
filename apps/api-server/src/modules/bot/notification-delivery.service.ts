import { BadRequestException, Injectable } from "@nestjs/common";
import { BotPlatform, Prisma, NotificationDelivery } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  deliveryContext,
  markDeliveryUnknown,
  NotificationOutcomeUnknown,
} from "./delivery-context";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
type DeliveryResponse = {
  id?: string;
  msg_id?: string;
  channel_id?: string;
  guild_id?: string;
};

@Injectable()
export class NotificationDeliveryService {
  constructor(private readonly prisma: PrismaService) {}

  async send(
    platform: BotPlatform,
    target: string,
    path: string,
    requestBody: Prisma.InputJsonObject,
    businessKey?: string,
  ): Promise<DeliveryResponse> {
    const jobKey = deliveryContext()?.key;
    const identity =
      businessKey ||
      (jobKey
        ? `${jobKey}:message:${hash(JSON.stringify([target, path, requestBody]))}`
        : `manual-message:${randomUUID()}`);
    const key = hash(`${platform}:${identity}`);
    const storedBody = this.withReference(platform, requestBody, key);
    const id = randomUUID();
    await this.prisma.$executeRaw`INSERT INTO "notification_deliveries"
      ("id", "key", "businessKey", "platform", "target", "path", "requestBody", "jobKey", "updatedAt")
      VALUES (${id}, ${key}, ${identity}, ${platform}::"BotPlatform", ${target}, ${path}, ${JSON.stringify(storedBody)}::jsonb, ${jobKey ?? null}, NOW())
      ON CONFLICT ("key") DO NOTHING`;
    const delivery = await this.prisma.notificationDelivery.findUniqueOrThrow({
      where: { key },
    });
    return this.attempt(delivery);
  }

  private withReference(
    platform: BotPlatform,
    body: Prisma.InputJsonObject,
    key: string,
  ): Prisma.InputJsonObject {
    const result = JSON.parse(JSON.stringify(body));
    const reference = `通知核对号：${key.slice(0, 12)}`;
    if (platform === "KOOK" && result.type === 10) {
      const cards = JSON.parse(result.content);
      cards[0].modules.push({
        type: "section",
        text: { type: "plain-text", content: reference },
      });
      result.content = JSON.stringify(cards);
    } else if (platform === "DISCORD" && result.embeds?.length) {
      result.embeds[0].footer = { text: reference };
    } else {
      result.content = `${result.content || ""}\n${reference}`;
    }
    return result;
  }

  // Uses the persisted request only. Never repeats a webhook, draft conversion,
  // order assignment, payment, or acceptance operation.
  async retry(id: string) {
    const delivery = await this.prisma.notificationDelivery.findUniqueOrThrow({
      where: { id },
    });
    await this.attempt(delivery);
  }

  private unknown(): never {
    markDeliveryUnknown();
    throw new NotificationOutcomeUnknown();
  }

  private async attempt(
    delivery: NotificationDelivery,
  ): Promise<DeliveryResponse> {
    if (delivery.status === "SENT")
      return delivery.response as DeliveryResponse;
    if (delivery.status !== "READY") {
      if (
        delivery.status === "SENDING" &&
        delivery.startedAt &&
        Date.now() - delivery.startedAt.getTime() > 120000
      ) {
        await this.prisma.notificationDelivery.updateMany({
          where: {
            id: delivery.id,
            status: "SENDING",
            attempts: delivery.attempts,
          },
          data: { status: "UNKNOWN", lastError: "WorkerExitedDuringSend" },
        });
      }
      return this.unknown();
    }
    const token =
      process.env[
        delivery.platform === "DISCORD" ? "DISCORD_TOKEN" : "KOOK_TOKEN"
      ];
    if (!token) throw new Error("NotificationPlatformNotConfigured");
    const claimed = await this.prisma.notificationDelivery.updateMany({
      where: { id: delivery.id, status: "READY", attempts: delivery.attempts },
      data: {
        status: "SENDING",
        startedAt: new Date(),
        attempts: { increment: 1 },
        lastError: null,
      },
    });
    if (claimed.count !== 1) return this.unknown();
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout =
      process.env.DFC_TEST_MODE === "1"
        ? Math.max(
            10,
            Number(process.env.NOTIFICATION_TEST_TIMEOUT_MS || 15000),
          )
        : 15000;
    try {
      const base =
        delivery.platform === "DISCORD"
          ? "https://discord.com/api/v10"
          : "https://www.kookapp.cn";
      const response = await Promise.race([
        (async () => {
          const result = await fetch(`${base}${delivery.path}`, {
            method: "POST",
            signal: controller.signal,
            headers: {
              Authorization: `Bot ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(delivery.requestBody),
          });
          // Even an error response is treated conservatively: no automatic POST retry.
          if (!result.ok) throw new Error(`PlatformHTTP${result.status}`);
          const json = (await result.json()) as any;
          if (delivery.platform === "KOOK" && json.code !== 0)
            throw new Error("PlatformRejectedMessage");
          const value: DeliveryResponse =
            delivery.platform === "DISCORD" ? json : json.data;
          if (!value || typeof (value.id || value.msg_id) !== "string")
            throw new Error("MissingMessageReceipt");
          return {
            ...(value.id ? { id: value.id } : {}),
            ...(value.msg_id ? { msg_id: value.msg_id } : {}),
            ...(value.channel_id ? { channel_id: value.channel_id } : {}),
            ...(value.guild_id ? { guild_id: value.guild_id } : {}),
          };
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("MessageResponseTimeout"));
          }, timeout);
        }),
      ]);
      const updated = await this.prisma.notificationDelivery.updateMany({
        where: {
          id: delivery.id,
          status: "SENDING",
          attempts: delivery.attempts + 1,
        },
        data: {
          status: "SENT",
          response,
          messageId: response.id || response.msg_id,
          lastError: null,
        },
      });
      if (updated.count !== 1) return this.unknown();
      await this.finishReconciliation(this.prisma, delivery.jobKey);
      return response;
    } catch (error) {
      await this.prisma.notificationDelivery
        .updateMany({
          where: {
            id: delivery.id,
            status: "SENDING",
            attempts: delivery.attempts + 1,
          },
          data: {
            status: "UNKNOWN",
            lastError:
              error instanceof Error
                ? error.message.slice(0, 100)
                : "UncertainSend",
          },
        })
        .catch(() => undefined);
      return this.unknown();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async reconcile(
    id: string,
    actorId: string,
    body: {
      decision: "SENT" | "NOT_SENT";
      evidence: string;
      messageId?: string;
    },
  ) {
    if (
      !["SENT", "NOT_SENT"].includes(body.decision) ||
      typeof body.evidence !== "string" ||
      body.evidence.trim().length < 10
    )
      throw new BadRequestException(
        "A reconciliation decision and at least 10 characters of evidence are required",
      );
    if (
      body.decision === "SENT" &&
      (!body.messageId?.trim() || body.messageId.length > 200)
    )
      throw new BadRequestException(
        "Confirmed delivery requires the observed platform message ID",
      );
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "notification_deliveries" WHERE "id" = ${id} FOR UPDATE`;
      const delivery = await tx.notificationDelivery.findUniqueOrThrow({
        where: { id },
      });
      const actor = await tx.user.findUniqueOrThrow({
        where: { id: actorId },
        select: { role: true },
      });
      if (actor.role !== "ADMIN" && actor.role !== "SUPER_ADMIN")
        throw new BadRequestException(
          "Only an authorized administrator can reconcile delivery",
        );
      const stale =
        delivery.status === "SENDING" &&
        delivery.startedAt &&
        Date.now() - delivery.startedAt.getTime() > 120000;
      if (delivery.status !== "UNKNOWN" && !stale)
        throw new BadRequestException(
          "Only unknown or abandoned sends can be reconciled",
        );
      const response =
        delivery.platform === "DISCORD"
          ? { id: body.messageId?.trim(), channel_id: delivery.target }
          : { msg_id: body.messageId?.trim() };
      const updated = await tx.notificationDelivery.update({
        where: { id },
        data: {
          status: body.decision === "SENT" ? "SENT" : "READY",
          ...(body.decision === "SENT"
            ? { response, messageId: body.messageId!.trim() }
            : {}),
          lastError: null,
        },
      });
      await tx.adminLog.create({
        data: {
          actorId,
          action: "RECONCILE_NOTIFICATION",
          entityType: "NOTIFICATION_DELIVERY",
          entityId: id,
          detail: {
            decision: body.decision,
            evidence: body.evidence.trim().slice(0, 4000),
            messageId: body.messageId,
            previousStatus: delivery.status,
            attempt: delivery.attempts,
            businessKey: delivery.businessKey,
          },
        },
      });
      if (body.decision === "NOT_SENT") {
        const key = `notification-resend:${id}:${delivery.attempts}`;
        await tx.$executeRaw`INSERT INTO "integration_jobs" ("id", "key", "kind", "payload", "updatedAt")
          VALUES (${randomUUID()}, ${key}, 'NOTIFICATION_RESEND', ${JSON.stringify({ deliveryId: id })}::jsonb, NOW()) ON CONFLICT ("key") DO NOTHING`;
      }
      if (body.decision === "SENT")
        await this.finishReconciliation(tx, delivery.jobKey);
      return {
        id: updated.id,
        status: updated.status,
        retryQueued: body.decision === "NOT_SENT",
        backgroundDeliveryEnabled:
          process.env.DFC_BACKGROUND_JOBS_ENABLED === "true",
      };
    });
  }

  private async finishReconciliation(
    tx: Prisma.TransactionClient,
    jobKey: string | null,
  ) {
    if (!jobKey) return;
    const remaining = await tx.notificationDelivery.count({
      where: { jobKey, status: { not: "SENT" } },
    });
    if (!remaining)
      await tx.integrationJob.updateMany({
        where: { key: jobKey, status: "UNKNOWN" },
        data: { status: "RECONCILED", lastError: null },
      });
  }
}
