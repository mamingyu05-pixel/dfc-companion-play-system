import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { IntegrationJob, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { randomUUID } from "node:crypto";
import {
  NotificationOutcomeUnknown,
  withDeliveryContext,
} from "./delivery-context";

export async function enqueueJob(
  tx: Prisma.TransactionClient,
  kind: string,
  key: string,
  payload: Prisma.InputJsonValue,
) {
  const rows = await tx.$queryRaw<IntegrationJob[]>`
    INSERT INTO "integration_jobs" ("id", "key", "kind", "payload", "updatedAt")
    VALUES (${randomUUID()}, ${key}, ${kind}, ${JSON.stringify(payload)}::jsonb, NOW())
    ON CONFLICT ("key") DO UPDATE SET "key" = EXCLUDED."key" RETURNING *`;
  return rows[0];
}

@Injectable()
export class IntegrationJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly handlers = new Map<
    string,
    (payload: Prisma.JsonValue) => Promise<void>
  >();
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly polls = new Map<string, { run: () => Promise<unknown>; nextAt: number; running: boolean }>();
  registerPoll(name: string, run: () => Promise<unknown>) {
    this.polls.set(name, { run, nextAt: 0, running: false });
  }
  async processPolls(now = Date.now()) {
    for (const [name, poll] of this.polls) {
      if (poll.running || poll.nextAt > now) continue;
      poll.running = true;
      poll.nextAt = now + 60_000;
      try { await poll.run(); }
      catch { Logger.error(`Background poll failed: ${name}`, "IntegrationJobsService"); }
      finally { poll.running = false; }
    }
  }
  constructor(private readonly prisma: PrismaService) {}
  register(
    kind: string,
    handler: (payload: Prisma.JsonValue) => Promise<void>,
  ) {
    this.handlers.set(kind, handler);
  }
  onModuleInit() {
    if (process.env.DFC_BACKGROUND_JOBS_ENABLED === "true") {
      this.timer = setInterval(() => {
        void this.processOne().catch(() => undefined);
        void this.processPolls();
      }, 250);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async processOne() {
    if (this.running || !this.handlers.size) return false;
    this.running = true;
    try {
      await this.prisma
        .$executeRaw`UPDATE "integration_jobs" SET "status" = 'FAILED', "leaseUntil" = NULL,
        "lastError" = 'RetryLimitAfterWorkerExit', "updatedAt" = NOW()
        WHERE "status" = 'PROCESSING' AND "leaseUntil" < NOW() AND "attempts" >= 5`;
      const rows = await this.prisma.$queryRaw<IntegrationJob[]>(Prisma.sql`
        WITH candidate AS (
          SELECT "id" FROM "integration_jobs" WHERE "kind" IN (${Prisma.join([...this.handlers.keys()])}) AND "attempts" < 5
            AND (("status" = 'PENDING' AND "nextAttemptAt" <= NOW()) OR ("status" = 'PROCESSING' AND "leaseUntil" < NOW()))
          ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
        ) UPDATE "integration_jobs" AS j SET "status" = 'PROCESSING', "attempts" = j."attempts" + 1,
          "leaseUntil" = NOW() + INTERVAL '5 minutes', "updatedAt" = NOW()
        FROM candidate WHERE j."id" = candidate."id" RETURNING j.*`);
      const job = rows[0];
      if (!job) return false;
      const heartbeat = setInterval(() => {
        void this.prisma.integrationJob
          .updateMany({
            where: { id: job.id, attempts: job.attempts, status: "PROCESSING" },
            data: { leaseUntil: new Date(Date.now() + 300000) },
          })
          .catch(() => undefined);
      }, 30000);
      heartbeat.unref();
      try {
        await withDeliveryContext(job.key, () =>
          this.handlers.get(job.kind)!(job.payload),
        );
        await this.prisma.integrationJob.updateMany({
          where: { id: job.id, attempts: job.attempts, status: "PROCESSING" },
          data: { status: "COMPLETED", leaseUntil: null, lastError: null },
        });
      } catch (error) {
        await this.prisma.integrationJob.updateMany({
          where: { id: job.id, attempts: job.attempts, status: "PROCESSING" },
          data: {
            status:
              error instanceof NotificationOutcomeUnknown
                ? "UNKNOWN"
                : job.attempts >= 5
                  ? "FAILED"
                  : "PENDING",
            leaseUntil: null,
            nextAttemptAt: new Date(
              Date.now() + Math.min(60, 2 ** job.attempts) * 1000,
            ),
            lastError: error instanceof Error ? error.name : "ProcessingError",
          },
        });
      } finally {
        clearInterval(heartbeat);
      }
      return true;
    } finally {
      this.running = false;
    }
  }
}
