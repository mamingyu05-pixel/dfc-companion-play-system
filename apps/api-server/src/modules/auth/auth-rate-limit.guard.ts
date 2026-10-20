import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";

type RateLimitRequest = {
  ip?: string;
  body?: { email?: unknown };
  user?: { id: string };
  socket?: { remoteAddress?: string };
};

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RateLimitRequest>();
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    // Express applies the explicitly configured trusted proxy boundary.
    const ip = request.ip || request.socket?.remoteAddress || "unknown";
    const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase().slice(0, 320) : "";
    const identities = [{ value: `ip:${ip}`, limit: 30 }];
    if (request.user?.id || email) identities.push({ value: `account:${request.user?.id || email}`, limit: 5 });
    const buckets = identities.map(({ value, limit }) => ({ key: createHash("sha256").update(`${route}:${value}`).digest("hex"), limit }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const counts = await this.prisma.$transaction(async (tx) => {
      const results: number[] = [];
      for (const bucket of buckets) {
        const rows = await tx.$queryRaw<Array<{ attempts: number }>>`
          INSERT INTO "auth_rate_limit_buckets" ("key", "attempts", "expiresAt")
          VALUES (${bucket.key}, 1, NOW() + INTERVAL '60 seconds')
          ON CONFLICT ("key") DO UPDATE SET
            "attempts" = CASE WHEN "auth_rate_limit_buckets"."expiresAt" <= NOW() THEN 1 ELSE LEAST("auth_rate_limit_buckets"."attempts" + 1, 1000) END,
            "expiresAt" = CASE WHEN "auth_rate_limit_buckets"."expiresAt" <= NOW() THEN NOW() + INTERVAL '60 seconds' ELSE "auth_rate_limit_buckets"."expiresAt" END
          RETURNING "attempts"`;
        results.push(rows[0].attempts);
      }
      await tx.$executeRaw`DELETE FROM "auth_rate_limit_buckets" WHERE "key" IN
        (SELECT "key" FROM "auth_rate_limit_buckets" WHERE "expiresAt" < NOW() - INTERVAL '1 minute' LIMIT 100)`;
      return results;
    });
    if (counts.some((count, index) => count > buckets[index].limit)) {
      throw new HttpException("Too many attempts, please try again later", HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
