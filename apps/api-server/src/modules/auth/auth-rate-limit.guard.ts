import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";

const WINDOW_MS = 60_000;
const LIMIT = 5;
const attempts = new Map<string, number[]>();

type RateLimitRequest = {
  method?: string;
  originalUrl?: string;
  url?: string;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: { email?: string; portal?: string };
  socket?: { remoteAddress?: string };
  connection?: { remoteAddress?: string };
};

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RateLimitRequest>();
    const now = Date.now();
    const key = buildKey(request);
    const recent = (attempts.get(key) ?? []).filter((timestamp) => now - timestamp < WINDOW_MS);

    if (recent.length >= LIMIT) {
      attempts.set(key, recent);
      throw new HttpException("Too many authentication attempts, please try again later", HttpStatus.TOO_MANY_REQUESTS);
    }

    recent.push(now);
    attempts.set(key, recent);
    cleanup(now);
    return true;
  }
}

function buildKey(request: RateLimitRequest) {
  const method = request.method ?? "UNKNOWN";
  const path = request.originalUrl ?? request.url ?? "unknown-path";
  const ip = getClientIp(request);
  const email = request.body?.email?.trim().toLowerCase() || "unknown-email";
  const portal = request.body?.portal ?? "default";
  return `${method}:${path}:${ip}:${email}:${portal}`;
}

function getClientIp(request: RateLimitRequest) {
  const forwardedFor = request.headers?.["x-forwarded-for"];
  const raw = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return raw?.split(",")[0]?.trim() || request.ip || request.socket?.remoteAddress || request.connection?.remoteAddress || "unknown-ip";
}

function cleanup(now: number) {
  for (const [key, timestamps] of attempts.entries()) {
    const recent = timestamps.filter((timestamp) => now - timestamp < WINDOW_MS);
    if (recent.length) attempts.set(key, recent);
    else attempts.delete(key);
  }
}
