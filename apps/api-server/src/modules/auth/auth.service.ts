import { BadRequestException, Injectable, InternalServerErrorException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { BotPlatform, CompanionProfileStatus, Prisma, UserRole } from "@prisma/client";
import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import nodemailer from "nodemailer";
import { PrismaService } from "../prisma/prisma.service";
import { JwtPayload } from "./auth.types";
import { normalizeDisplayNameKey } from "./display-name.util";
import { isValidEmail, normalizeEmail } from "./email.util";
import { createPasswordHash, verifyPassword } from "./password.util";

type Portal = "customer" | "companion" | "admin";
type OAuthPlatform = "discord" | "kook";
type OAuthProfile = {
  externalUserId: string;
  displayName: string;
};

const CUSTOMER_REGISTER_EMAIL_PURPOSE = "CUSTOMER_REGISTER";
const EMAIL_CODE_TTL_MINUTES = 10;
const EMAIL_CODE_RESEND_SECONDS = 60;
const MAX_EMAIL_CODE_ATTEMPTS = 5;
const DISCORD_OAUTH_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const DISCORD_OAUTH_TOKEN_URL = "https://discord.com/api/oauth2/token";
const DISCORD_OAUTH_USER_URL = "https://discord.com/api/users/@me";
const KOOK_OAUTH_AUTHORIZE_URL = "https://www.kookapp.cn/app/oauth2/authorize";
const KOOK_OAUTH_TOKEN_URL = "https://www.kookapp.cn/api/oauth2/token";
const KOOK_OAUTH_USER_URL = "https://www.kookapp.cn/api/v3/user/me";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService
  ) {}

  async requestCustomerEmailVerification(body: { email: string }) {
    if (!body.email) {
      throw new BadRequestException("email is required");
    }

    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) {
      throw new BadRequestException("Invalid email format");
    }

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true }
    });
    if (existing) {
      throw new BadRequestException("Email is already registered");
    }

    const recent = await this.prisma.emailVerificationCode.findFirst({
      where: {
        email,
        purpose: CUSTOMER_REGISTER_EMAIL_PURPOSE,
        consumedAt: null,
        createdAt: { gte: new Date(Date.now() - EMAIL_CODE_RESEND_SECONDS * 1000) }
      },
      select: { id: true }
    });
    if (recent) {
      throw new BadRequestException("Please wait before requesting another verification code");
    }

    const code = generateEmailCode();
    const codeHash = hashEmailCode(email, code);
    const expiresAt = new Date(Date.now() + EMAIL_CODE_TTL_MINUTES * 60 * 1000);

    const verification = await this.prisma.$transaction(async (tx) => {
      await tx.emailVerificationCode.deleteMany({
        where: { email, purpose: CUSTOMER_REGISTER_EMAIL_PURPOSE, consumedAt: null }
      });
      return tx.emailVerificationCode.create({
        data: {
          email,
          purpose: CUSTOMER_REGISTER_EMAIL_PURPOSE,
          codeHash,
          expiresAt
        },
        select: { id: true }
      });
    });

    try {
      await this.sendVerificationEmail(email, code);
    } catch (error) {
      await this.prisma.emailVerificationCode.delete({ where: { id: verification.id } }).catch(() => undefined);
      throw error;
    }

    return { message: "Verification code sent" };
  }

  async registerCustomer(body: { email: string; password: string; displayName: string; emailCode: string }) {
    if (!body.email || !body.password || !body.displayName || !body.emailCode) {
      throw new BadRequestException("email, password, displayName and emailCode are required");
    }

    const email = normalizeEmail(body.email);
    const displayName = body.displayName.trim();
    const displayNameKey = normalizeDisplayNameKey(displayName);
    const emailCode = body.emailCode.trim();

    if (!email || !displayName || !displayNameKey || !emailCode) {
      throw new BadRequestException("email, password, displayName and emailCode are required");
    }
    if (!isValidEmail(email)) {
      throw new BadRequestException("Invalid email format");
    }

    if (body.password.length < 8) {
      throw new BadRequestException("Password must be at least 8 characters");
    }

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true }
    });
    if (existing) {
      throw new BadRequestException("Email is already registered");
    }
    const displayNameTaken = await this.prisma.user.findFirst({
      where: { role: UserRole.CUSTOMER, displayNameKey },
      select: { id: true }
    });
    if (displayNameTaken) {
      throw new BadRequestException("Display name is already taken");
    }

    const verificationId = await this.assertCustomerEmailVerification(email, emailCode);
    const passwordHash = await createPasswordHash(body.password);

    const user = await this.createCustomerUser({
      email,
      passwordHash,
      displayName,
      displayNameKey,
      verificationId
    });

    return {
      user,
      accessToken: await this.issueToken({ sub: user.id, email: user.email, role: user.role })
    };
  }

  private async createCustomerUser(body: { email: string; passwordHash: string; displayName: string; displayNameKey: string; verificationId: string }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const verification = await tx.emailVerificationCode.findUnique({
          where: { id: body.verificationId }
        });

        if (
          !verification ||
          verification.email !== body.email ||
          verification.purpose !== CUSTOMER_REGISTER_EMAIL_PURPOSE ||
          verification.consumedAt ||
          verification.expiresAt <= new Date()
        ) {
          throw new BadRequestException("Verification code is invalid or expired");
        }

        const created = await tx.user.create({
          data: {
            email: body.email,
            passwordHash: body.passwordHash,
            role: UserRole.CUSTOMER,
            displayName: body.displayName,
            displayNameKey: body.displayNameKey
          },
          select: { id: true, email: true, role: true, displayName: true }
        });

        await tx.wallet.create({ data: { userId: created.id } });
        await tx.emailVerificationCode.update({
          where: { id: verification.id },
          data: { consumedAt: new Date() }
        });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException(isDisplayNameUniqueError(error) ? "Display name is already taken" : "Email is already registered");
      }
      throw error;
    }
  }

  private async assertCustomerEmailVerification(email: string, emailCode: string) {
    const verification = await this.prisma.emailVerificationCode.findFirst({
      where: {
        email,
        purpose: CUSTOMER_REGISTER_EMAIL_PURPOSE,
        consumedAt: null
      },
      orderBy: { createdAt: "desc" }
    });

    if (!verification || verification.expiresAt <= new Date()) {
      throw new BadRequestException("Verification code is invalid or expired");
    }
    if (verification.attempts >= MAX_EMAIL_CODE_ATTEMPTS) {
      throw new BadRequestException("Verification code has too many failed attempts");
    }
    if (verification.codeHash !== hashEmailCode(email, emailCode)) {
      await this.prisma.emailVerificationCode.update({
        where: { id: verification.id },
        data: { attempts: { increment: 1 } }
      });
      throw new BadRequestException("Verification code is invalid or expired");
    }

    return verification.id;
  }

  async login(body: { email: string; password: string; portal: Portal }) {
    if (!body.email || !body.password) {
      throw new BadRequestException("email and password are required");
    }

    if (!["customer", "companion", "admin"].includes(body.portal)) {
      throw new BadRequestException("Invalid portal");
    }

    const email = normalizeEmail(body.email);

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        role: true,
        status: true,
        displayName: true,
        companionProfile: { select: { status: true } }
      }
    });

    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password");
    }

    if (user.status !== "ACTIVE") {
      throw new UnauthorizedException("User is not active");
    }

    if (!this.roleCanEnterPortal(user.role, body.portal)) {
      throw new ForbiddenPortalException();
    }

    if (body.portal === "companion" && user.companionProfile?.status === CompanionProfileStatus.BANNED) {
      throw new UnauthorizedException("Companion profile is banned");
    }

    return {
      user: { id: user.id, email: user.email, role: user.role, displayName: user.displayName },
      accessToken: await this.issueToken({ sub: user.id, email: user.email, role: user.role })
    };
  }

  getPublicConfig() {
    return {
      support: {
        discordUrl: process.env.SUPPORT_DISCORD_URL || null,
        kookUrl: process.env.SUPPORT_KOOK_URL || null
      }
    };
  }

  getCustomerOAuthStartUrl(platform: OAuthPlatform) {
    const config = this.getOAuthConfig(platform);
    const url = new URL(config.authorizeUrl);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", config.scope);
    url.searchParams.set("state", signOAuthState(platform));
    return url.toString();
  }

  async completeCustomerOAuth(platform: OAuthPlatform, body: { code?: string; state?: string; error?: string }) {
    const customerWebUrl = getCustomerWebUrl();
    if (body.error) {
      return `${customerWebUrl}/oauth-callback?error=${encodeURIComponent("第三方授权被取消或失败")}`;
    }
    if (!body.code || !body.state || !verifyOAuthState(body.state, platform)) {
      return `${customerWebUrl}/oauth-callback?error=${encodeURIComponent("第三方授权状态无效，请重新登录")}`;
    }

    try {
      const profile = platform === "discord" ? await this.fetchDiscordProfile(body.code) : await this.fetchKookProfile(body.code);
      const result = await this.findOrCreateOAuthCustomer(platform, profile);
      const token = await this.issueToken({ sub: result.user.id, email: result.user.email, role: result.user.role });
      const redirect = new URL(`${customerWebUrl}/oauth-callback`);
      redirect.searchParams.set("token", token);
      redirect.searchParams.set("displayName", result.user.displayName);
      redirect.searchParams.set("platform", platform);
      return redirect.toString();
    } catch (error) {
      const message = error instanceof Error ? error.message : "第三方登录失败，请稍后重试";
      return `${customerWebUrl}/oauth-callback?error=${encodeURIComponent(message)}`;
    }
  }

  private async fetchDiscordProfile(code: string): Promise<OAuthProfile> {
    const config = this.getOAuthConfig("discord");
    const token = await this.exchangeOAuthToken(config, code);
    const response = await fetch(DISCORD_OAUTH_USER_URL, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new BadRequestException("Discord 用户信息获取失败");
    }
    const data = (await response.json()) as { id?: string; global_name?: string | null; username?: string };
    if (!data.id) {
      throw new BadRequestException("Discord 用户信息无效");
    }
    return {
      externalUserId: data.id,
      displayName: sanitizeOAuthDisplayName(data.global_name || data.username || `Discord-${data.id.slice(-6)}`)
    };
  }

  private async fetchKookProfile(code: string): Promise<OAuthProfile> {
    const config = this.getOAuthConfig("kook");
    const token = await this.exchangeOAuthToken(config, code);
    const response = await fetch(config.userUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new BadRequestException("KOOK 用户信息获取失败");
    }
    const body = (await response.json()) as { data?: { id?: string; username?: string; nickname?: string }; id?: string; username?: string; nickname?: string };
    const data = body.data ?? body;
    if (!data.id) {
      throw new BadRequestException("KOOK 用户信息无效");
    }
    return {
      externalUserId: data.id,
      displayName: sanitizeOAuthDisplayName(data.nickname || data.username || `KOOK-${data.id.slice(-6)}`)
    };
  }

  private async exchangeOAuthToken(
    config: ReturnType<AuthService["getOAuthConfig"]>,
    code: string
  ) {
    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri
      })
    });
    if (!response.ok) {
      throw new BadRequestException(`${config.label} 授权换取 token 失败`);
    }
    const data = (await response.json()) as { access_token?: string };
    if (!data.access_token) {
      throw new BadRequestException(`${config.label} 授权响应无效`);
    }
    return data.access_token;
  }

  private async findOrCreateOAuthCustomer(platform: OAuthPlatform, profile: OAuthProfile) {
    const botPlatform = oauthPlatformToBotPlatform(platform);
    const existingAccount = await this.prisma.userExternalAccount.findUnique({
      where: {
        platform_externalUserId: {
          platform: botPlatform,
          externalUserId: profile.externalUserId
        }
      },
      include: { user: true }
    });

    if (existingAccount) {
      if (existingAccount.user.role !== UserRole.CUSTOMER) {
        throw new UnauthorizedException("这个第三方账号已绑定到非客户账号");
      }
      if (existingAccount.user.status !== "ACTIVE") {
        throw new UnauthorizedException("User is not active");
      }
      await this.prisma.userExternalAccount.update({
        where: { id: existingAccount.id },
        data: { displayName: profile.displayName }
      });
      return {
        user: {
          id: existingAccount.user.id,
          email: existingAccount.user.email,
          role: existingAccount.user.role,
          displayName: existingAccount.user.displayName
        }
      };
    }

    const displayName = await this.getAvailableCustomerDisplayName(profile.displayName);
    const displayNameKey = normalizeDisplayNameKey(displayName);
    const email = buildOAuthEmail(platform, profile.externalUserId);
    const passwordHash = await createPasswordHash(randomBytes(32).toString("hex"));

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            passwordHash,
            role: UserRole.CUSTOMER,
            displayName,
            displayNameKey
          },
          select: { id: true, email: true, role: true, displayName: true }
        });
        await tx.wallet.create({ data: { userId: created.id } });
        await tx.userExternalAccount.create({
          data: {
            userId: created.id,
            platform: botPlatform,
            externalUserId: profile.externalUserId,
            displayName: profile.displayName
          }
        });
        return created;
      });
      return { user };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("第三方账号已经注册，请直接登录");
      }
      throw error;
    }
  }

  private async getAvailableCustomerDisplayName(displayName: string) {
    const baseName = sanitizeOAuthDisplayName(displayName);
    for (let index = 0; index < 50; index += 1) {
      const candidate = index === 0 ? baseName : `${baseName}-${index + 1}`;
      const displayNameKey = normalizeDisplayNameKey(candidate);
      const existing = await this.prisma.user.findFirst({
        where: { role: UserRole.CUSTOMER, displayNameKey },
        select: { id: true }
      });
      if (!existing) return candidate;
    }
    return `${baseName}-${randomInt(1000, 9999)}`;
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        displayName: true,
        wallet: {
          select: {
            availableBalance: true,
            frozenBalance: true,
            availableIncome: true,
            pendingIncome: true
          }
        },
        companionProfile: {
          select: {
            nickname: true,
            game: true,
            onlineStatus: true,
            status: true,
            pricePerHour: true
          }
        },
        customerOrders: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            orderNo: true,
            mode: true,
            status: true,
            totalAmount: true,
            companion: { select: { displayName: true } },
            createdAt: true
          }
        },
        companionOrders: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            orderNo: true,
            mode: true,
            status: true,
            hours: true,
            totalAmount: true,
            companionIncome: true,
            customer: { select: { displayName: true } },
            createdAt: true
          }
        },
        walletTransactions: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            type: true,
            direction: true,
            amount: true,
            balanceAfter: true,
            createdAt: true
          }
        }
      }
    });

    if (!user) {
      throw new UnauthorizedException("User is not active");
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.displayName
      },
      wallet: user.wallet
        ? {
            availableBalance: user.wallet.availableBalance.toString(),
            frozenBalance: user.wallet.frozenBalance.toString(),
            availableIncome: user.wallet.availableIncome.toString(),
            pendingIncome: user.wallet.pendingIncome.toString()
          }
        : null,
      recentOrders: user.customerOrders.map((order) => ({
        id: order.id,
        orderNo: order.orderNo,
        mode: order.mode,
        status: order.status,
        totalAmount: order.totalAmount.toString(),
        companionName: order.companion?.displayName ?? "平台待匹配",
        createdAt: order.createdAt
      })),
      companionProfile: user.companionProfile
        ? {
            nickname: user.companionProfile.nickname,
            game: user.companionProfile.game,
            onlineStatus: user.companionProfile.onlineStatus,
            status: user.companionProfile.status,
            pricePerHour: user.companionProfile.pricePerHour.toString()
          }
        : null,
      companionOrders: user.companionOrders.map((order) => ({
        id: order.id,
        orderNo: order.orderNo,
        mode: order.mode,
        status: order.status,
        hours: order.hours.toString(),
        totalAmount: order.totalAmount.toString(),
        companionIncome: order.companionIncome.toString(),
        customerName: order.customer.displayName,
        createdAt: order.createdAt
      })),
      walletTransactions: user.walletTransactions.map((transaction) => ({
        id: transaction.id,
        type: transaction.type,
        direction: transaction.direction,
        amount: transaction.amount.toString(),
        balanceAfter: transaction.balanceAfter.toString(),
        createdAt: transaction.createdAt
      }))
    };
  }

  private issueToken(payload: JwtPayload) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new UnauthorizedException("JWT_SECRET is not configured");
    }
    return this.jwt.signAsync(payload, { secret, expiresIn: process.env.JWT_EXPIRES_IN ?? "7d" });
  }

  private roleCanEnterPortal(role: UserRole, portal: Portal) {
    if (portal === "customer") return role === UserRole.CUSTOMER;
    if (portal === "companion") return role === UserRole.COMPANION;
    return role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;
  }

  private async sendVerificationEmail(email: string, code: string) {
    const host = process.env.SMTP_HOST?.trim();
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM?.trim() || user;
    const port = Number(process.env.SMTP_PORT ?? "587");

    if (!host || !user || !pass || !from || !Number.isFinite(port)) {
      throw new InternalServerErrorException("Email service is not configured");
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });

    await transporter.sendMail({
      from,
      to: email,
      subject: "May猫饼电竞注册验证码",
      text: `你的 May猫饼电竞注册验证码是：${code}。验证码 ${EMAIL_CODE_TTL_MINUTES} 分钟内有效，请勿转发给他人。`,
      html: `<p>你的 May猫饼电竞注册验证码是：</p><p style="font-size:24px;font-weight:700;letter-spacing:4px;">${code}</p><p>验证码 ${EMAIL_CODE_TTL_MINUTES} 分钟内有效，请勿转发给他人。</p>`
    });
  }

  private getOAuthConfig(platform: OAuthPlatform) {
    const upper = platform.toUpperCase();
    const clientId = process.env[`${upper}_CLIENT_ID`]?.trim();
    const clientSecret = process.env[`${upper}_CLIENT_SECRET`]?.trim();
    const redirectUri = process.env[`${upper}_REDIRECT_URI`]?.trim();

    if (!clientId || !clientSecret || !redirectUri) {
      throw new InternalServerErrorException(`${upper} OAuth is not configured`);
    }

    if (platform === "discord") {
      return {
        label: "Discord",
        clientId,
        clientSecret,
        redirectUri,
        authorizeUrl: DISCORD_OAUTH_AUTHORIZE_URL,
        tokenUrl: DISCORD_OAUTH_TOKEN_URL,
        userUrl: DISCORD_OAUTH_USER_URL,
        scope: "identify"
      };
    }

    return {
      label: "KOOK",
      clientId,
      clientSecret,
      redirectUri,
      authorizeUrl: process.env.KOOK_OAUTH_AUTHORIZE_URL?.trim() || KOOK_OAUTH_AUTHORIZE_URL,
      tokenUrl: process.env.KOOK_OAUTH_TOKEN_URL?.trim() || KOOK_OAUTH_TOKEN_URL,
      userUrl: process.env.KOOK_OAUTH_USER_URL?.trim() || KOOK_OAUTH_USER_URL,
      scope: process.env.KOOK_OAUTH_SCOPE?.trim() || "user"
    };
  }
}

class ForbiddenPortalException extends UnauthorizedException {
  constructor() {
    super("User role cannot access this portal");
  }
}

function generateEmailCode() {
  return String(randomInt(100000, 1000000));
}

function hashEmailCode(email: string, code: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new InternalServerErrorException("JWT_SECRET is not configured");
  }
  return createHash("sha256").update(`${secret}:${email}:${code}`).digest("hex");
}

function signOAuthState(platform: OAuthPlatform) {
  const payload = `${platform}:${Date.now()}:${randomBytes(12).toString("hex")}`;
  return `${Buffer.from(payload).toString("base64url")}.${signValue(payload)}`;
}

function verifyOAuthState(state: string, platform: OAuthPlatform) {
  const [payloadBase64, signature] = state.split(".");
  if (!payloadBase64 || !signature) return false;
  const payload = Buffer.from(payloadBase64, "base64url").toString("utf8");
  const [statePlatform, timestamp] = payload.split(":");
  if (statePlatform !== platform) return false;
  if (signValue(payload) !== signature) return false;
  const createdAt = Number(timestamp);
  return Number.isFinite(createdAt) && Date.now() - createdAt < 10 * 60 * 1000;
}

function signValue(value: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new InternalServerErrorException("JWT_SECRET is not configured");
  }
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function getCustomerWebUrl() {
  return (process.env.CUSTOMER_WEB_URL || "http://localhost:3000/customer").replace(/\/$/, "");
}

function oauthPlatformToBotPlatform(platform: OAuthPlatform) {
  return platform === "discord" ? BotPlatform.DISCORD : BotPlatform.KOOK;
}

function buildOAuthEmail(platform: OAuthPlatform, externalUserId: string) {
  return `${platform}-${externalUserId}@oauth.maycatplay.local`.toLowerCase();
}

function sanitizeOAuthDisplayName(displayName: string) {
  const normalized = displayName.normalize("NFKC").trim().replace(/\s+/g, " ");
  return normalized.slice(0, 32) || `玩家-${randomInt(1000, 9999)}`;
}

function isDisplayNameUniqueError(error: Prisma.PrismaClientKnownRequestError) {
  const target = error.meta?.target;
  return Array.isArray(target) && target.includes("displayNameKey");
}
