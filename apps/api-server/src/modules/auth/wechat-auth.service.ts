import { BadRequestException, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma, UserRole, UserStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";

type Environment = Readonly<Record<string, string | undefined>>;
type Customer = { id: string; email: string; role: UserRole; status: UserStatus; displayName: string };
const TOKEN_SECONDS = 3600;

// No mock provider or fallback identity is available on this endpoint.
export function wechatConfig(env: Environment = process.env) {
  const appId = env.WECHAT_MINIAPP_APP_ID || "";
  const appSecret = env.WECHAT_MINIAPP_APP_SECRET || "";
  const jwtSecret = env.JWT_SECRET || "";
  const isolated = (env.DFC_ISOLATED_API && env.DFC_ISOLATED_API !== "0") ||
    (env.DFC_TEST_MODE && env.DFC_TEST_MODE !== "0") || env.NODE_ENV === "test" ||
    !!env.DFC_ISOLATED_DATABASE || !!env.DFC_TEST_SUBJECT || env.DFC_OUTBOUND_POLICY === "deny";
  const enabled = !isolated && env.WECHAT_LOGIN_ENABLED === "1" && /^wx[0-9a-f]{16}$/.test(appId) &&
    !!appSecret && !/\s/.test(appSecret) && jwtSecret.length >= 32 && !/\s/.test(jwtSecret);
  return { enabled, appId, appSecret, jwtSecret };
}

export async function exchangeWechatCode(code: string, config: ReturnType<typeof wechatConfig>, request: typeof fetch = fetch) {
  if (!config.enabled) throw new ServiceUnavailableException("微信登录尚未配置或当前环境禁止真实登录");
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.search = new URLSearchParams({ appid: config.appId, secret: config.appSecret,
    js_code: code, grant_type: "authorization_code" }).toString();
  let data: Record<string, unknown>;
  try {
    const response = await request(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("upstream");
    data = await response.json() as Record<string, unknown>;
  } catch {
    // Never propagate the URL, upstream body, session key, or transport exception.
    throw new ServiceUnavailableException("微信登录服务暂时不可用，请重新登录");
  }
  if (!data || typeof data !== "object" || (data.errcode !== undefined && data.errcode !== 0) ||
      typeof data.openid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(data.openid) ||
      typeof data.session_key !== "string" || !data.session_key) {
    throw new UnauthorizedException("微信登录凭证无效或已失效，请重新登录");
  }
  // session_key and unionid are intentionally discarded; never expose or persist them.
  return { appId: config.appId, openId: data.openid };
}

@Injectable()
export class WechatAuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

  publicConfig() {
    const config = wechatConfig();
    return { mode: "wechat-api", enabled: config.enabled, appId: config.enabled ? config.appId : null,
      payment: "NOT_CONNECTED", nativeOrdering: "NOT_CONNECTED" };
  }

  async login(body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some(key => key !== "code") ||
        typeof (body as { code?: unknown }).code !== "string" ||
        !/^[A-Za-z0-9_-]{1,512}$/.test((body as { code: string }).code)) {
      throw new BadRequestException("仅接受微信临时登录凭证 code");
    }
    const config = wechatConfig();
    const identity = await exchangeWechatCode((body as { code: string }).code, config);
    let user = await this.findCustomer(this.prisma, identity);
    if (!user) {
      try {
        user = await this.prisma.$transaction(async tx => {
          const existing = await this.findCustomer(tx, identity);
          if (existing) return existing;
          const id = randomUUID();
          const displayName = "微信用户" + id.replace(/-/g, "");
          const created = await tx.user.create({ data: {
            id, email: "wechat-" + id + "@wechat.invalid", passwordHash: "!wechat-only",
            role: UserRole.CUSTOMER, displayName, displayNameKey: displayName.toLowerCase(),
            wallet: { create: {} }
          }, select: { id: true, email: true, role: true, status: true, displayName: true } });
          // Parameterized SQL matches the existing rate-limit table approach, and
          // avoids depending on a locally regenerated client to compile this change.
          await tx.$executeRaw`INSERT INTO "wechat_identities" ("appId", "openId", "userId")
            VALUES (${identity.appId}, ${identity.openId}, ${created.id})`;
          return created;
        });
      } catch (error) {
        // A simultaneous first login can win the unique identity constraint.
        // Its losing transaction rolls back the otherwise orphaned user/wallet.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) ||
            !(error.code === "P2002" || (error.code === "P2010" && error.meta?.code === "23505"))) throw error;
        user = await this.findCustomer(this.prisma, identity);
        if (!user) throw new ServiceUnavailableException("微信登录暂未完成，请重新登录");
      }
    }
    if (user.role !== UserRole.CUSTOMER || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException("客户账户当前不可用");
    }
    const current = await this.prisma.user.findUnique({ where: { id: user.id }, select: { sessionVersion: true } });
    const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email, role: user.role, sv: current?.sessionVersion ?? 0 },
      { secret: config.jwtSecret, algorithm: "HS256", expiresIn: TOKEN_SECONDS });
    return { mode: "wechat-api", user: { id: user.id, role: user.role, displayName: user.displayName },
      accessToken, expiresIn: TOKEN_SECONDS, payment: "NOT_CONNECTED", nativeOrdering: "NOT_CONNECTED" };
  }

  private async findCustomer(tx: Pick<Prisma.TransactionClient, "$queryRaw">, identity: { appId: string; openId: string }) {
    const users = await tx.$queryRaw<Customer[]>`SELECT u."id", u."email", u."role", u."status", u."displayName"
      FROM "wechat_identities" w JOIN "users" u ON u."id" = w."userId"
      WHERE w."appId" = ${identity.appId} AND w."openId" = ${identity.openId}`;
    return users[0];
  }
}
