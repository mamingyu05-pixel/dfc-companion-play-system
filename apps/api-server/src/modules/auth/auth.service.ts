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
type OAuthPortal = "customer" | "companion";
type OAuthPlatform = "discord" | "kook";
type OAuthProfile = {
  externalUserId: string;
  displayName: string;
  avatarUrl?: string;
};

const CUSTOMER_REGISTER_EMAIL_PURPOSE = "CUSTOMER_REGISTER";
const CUSTOMER_PASSWORD_RESET_EMAIL_PURPOSE = "CUSTOMER_PASSWORD_RESET";
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

  async requestCustomerPasswordResetCode(body: { email: string }) {
    if (!body.email) {
      throw new BadRequestException("email is required");
    }

    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) {
      throw new BadRequestException("Invalid email format");
    }

    const existing = await this.prisma.user.findFirst({
      where: { email, role: UserRole.CUSTOMER, status: "ACTIVE" },
      select: { id: true }
    });
    if (!existing) {
      return { message: "If the account exists, a verification code has been sent" };
    }

    const recent = await this.prisma.emailVerificationCode.findFirst({
      where: {
        email,
        purpose: CUSTOMER_PASSWORD_RESET_EMAIL_PURPOSE,
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
        where: { email, purpose: CUSTOMER_PASSWORD_RESET_EMAIL_PURPOSE, consumedAt: null }
      });
      return tx.emailVerificationCode.create({
        data: {
          email,
          purpose: CUSTOMER_PASSWORD_RESET_EMAIL_PURPOSE,
          codeHash,
          expiresAt
        },
        select: { id: true }
      });
    });

    try {
      await this.sendVerificationEmail(email, code, "重置密码");
    } catch (error) {
      await this.prisma.emailVerificationCode.delete({ where: { id: verification.id } }).catch(() => undefined);
      throw error;
    }

    return { message: "Verification code sent" };
  }

  async resetCustomerPassword(body: { email: string; emailCode: string; password: string }) {
    if (!body.email || !body.emailCode || !body.password) {
      throw new BadRequestException("email, emailCode and password are required");
    }
    if (body.password.length < 8) {
      throw new BadRequestException("Password must be at least 8 characters");
    }

    const email = normalizeEmail(body.email);
    const emailCode = body.emailCode.trim();
    if (!isValidEmail(email) || !emailCode) {
      throw new BadRequestException("email, emailCode and password are required");
    }

    const verificationId = await this.assertEmailVerification(email, emailCode, CUSTOMER_PASSWORD_RESET_EMAIL_PURPOSE);
    const passwordHash = await createPasswordHash(body.password);

    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        where: { email, role: UserRole.CUSTOMER, status: "ACTIVE" },
        select: { id: true }
      });
      if (!user) {
        throw new BadRequestException("Verification code is invalid or expired");
      }

      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash }
      });
      await tx.emailVerificationCode.update({
        where: { id: verificationId },
        data: { consumedAt: new Date() }
      });
    });

    return { message: "Password reset successfully" };
  }

  async registerCustomer(body: { email: string; password: string; displayName: string; emailCode: string; referralCode?: string }) {
    try {
      if (!body.email || !body.password || !body.displayName || !body.emailCode) {
        throw new BadRequestException("email, password, displayName and emailCode are required");
      }

      const email = normalizeEmail(body.email);
      const displayName = body.displayName.trim();
      const displayNameKey = normalizeDisplayNameKey(displayName);
      const emailCode = body.emailCode.trim();
      const referralCode = body.referralCode?.trim().toUpperCase();

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
        verificationId,
        referralCode
      });

      return {
        user,
        accessToken: await this.issueToken({ sub: user.id, email: user.email, role: user.role })
      };
    } catch (error) {
      throw mapRegistrationError(error);
    }
  }

  private async createCustomerUser(body: { email: string; passwordHash: string; displayName: string; displayNameKey: string; verificationId: string; referralCode?: string }) {
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

        const referrer = body.referralCode
          ? await tx.user.findFirst({
              where: { referralCode: body.referralCode, status: "ACTIVE" },
              select: { id: true, role: true }
            })
          : null;
        if (body.referralCode && !referrer) {
          throw new BadRequestException("Referral code is invalid");
        }
        if (referrer?.role === UserRole.ADMIN || referrer?.role === UserRole.SUPER_ADMIN) {
          throw new BadRequestException("Referral code is invalid");
        }

        const created = await tx.user.create({
          data: {
            email: body.email,
            passwordHash: body.passwordHash,
            role: UserRole.CUSTOMER,
            displayName: body.displayName,
            displayNameKey: body.displayNameKey,
            referralCode: await generateUniqueReferralCode(tx, "C")
          },
          select: { id: true, email: true, role: true, displayName: true, referralCode: true }
        });

        await tx.wallet.create({ data: { userId: created.id } });
        if (referrer && referrer.id !== created.id) {
          await tx.userReferral.create({
            data: {
              referrerId: referrer.id,
              referredUserId: created.id,
              sourceType: referrer.role === UserRole.COMPANION ? "COMPANION" : "CUSTOMER"
            }
          });
        }
        await tx.emailVerificationCode.update({
          where: { id: verification.id },
          data: { consumedAt: new Date() }
        });
        return created;
      });
    } catch (error) {
      if (isPrismaErrorCode(error, "P2002")) {
        throw new BadRequestException(isDisplayNameUniqueError(error) ? "Display name is already taken" : "Email is already registered");
      }
      throw error;
    }
  }

  private async assertCustomerEmailVerification(email: string, emailCode: string) {
    return this.assertEmailVerification(email, emailCode, CUSTOMER_REGISTER_EMAIL_PURPOSE);
  }

  private async assertEmailVerification(email: string, emailCode: string, purpose: string) {
    const verification = await this.prisma.emailVerificationCode.findFirst({
      where: {
        email,
        purpose,
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
        kookUrl: process.env.SUPPORT_KOOK_URL || null,
        wechatId: process.env.SUPPORT_WECHAT_ID || null,
        wechatQrUrl: process.env.SUPPORT_WECHAT_QR_URL || null
      }
    };
  }

  getOAuthStartUrl(platform: OAuthPlatform, portal: OAuthPortal) {
    const config = this.getOAuthConfig(platform);
    const url = new URL(config.authorizeUrl);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", config.scope);
    url.searchParams.set("state", signOAuthState(platform, portal));
    return url.toString();
  }

  async completeOAuth(platform: OAuthPlatform, body: { code?: string; state?: string; error?: string }) {
    const state = body.state ? parseOAuthState(body.state) : null;
    const portal = state?.portal ?? "customer";
    const webUrl = getPortalWebUrl(portal);
    if (body.error) {
      return `${webUrl}/oauth-callback?error=${encodeURIComponent("第三方授权被取消或失败")}`;
    }
    if (!body.code || !body.state || !state || state.platform !== platform || !verifyOAuthState(body.state, platform, portal)) {
      return `${webUrl}/oauth-callback?error=${encodeURIComponent("第三方授权状态无效，请重新登录")}`;
    }

    try {
      const profile = platform === "discord" ? await this.fetchDiscordProfile(body.code) : await this.fetchKookProfile(body.code);
      const result = await this.findOrCreateOAuthUser(platform, portal, profile);
      const token = await this.issueToken({ sub: result.user.id, email: result.user.email, role: result.user.role });
      const redirect = new URL(`${webUrl}/oauth-callback`);
      redirect.searchParams.set("token", token);
      redirect.searchParams.set("displayName", result.user.displayName);
      redirect.searchParams.set("platform", platform);
      return redirect.toString();
    } catch (error) {
      const message = error instanceof Error ? error.message : "第三方登录失败，请稍后重试";
      return `${webUrl}/oauth-callback?error=${encodeURIComponent(message)}`;
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
    const data = (await response.json()) as { id?: string; global_name?: string | null; username?: string; avatar?: string | null };
    if (!data.id) {
      throw new BadRequestException("Discord 用户信息无效");
    }
    return {
      externalUserId: data.id,
      displayName: sanitizeOAuthDisplayName(data.global_name || data.username || `Discord-${data.id.slice(-6)}`),
      avatarUrl: data.avatar ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png?size=256` : undefined
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
    const body = (await response.json()) as {
      data?: { id?: string; username?: string; nickname?: string; avatar?: string; avatarUrl?: string; avatar_url?: string };
      id?: string;
      username?: string;
      nickname?: string;
      avatar?: string;
      avatarUrl?: string;
      avatar_url?: string;
    };
    const data = body.data ?? body;
    if (!data.id) {
      throw new BadRequestException("KOOK 用户信息无效");
    }
    return {
      externalUserId: data.id,
      displayName: sanitizeOAuthDisplayName(data.nickname || data.username || `KOOK-${data.id.slice(-6)}`),
      avatarUrl: data.avatarUrl || data.avatar_url || data.avatar
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

  private async findOrCreateOAuthUser(platform: OAuthPlatform, portal: OAuthPortal, profile: OAuthProfile) {
    const botPlatform = oauthPlatformToBotPlatform(platform);
    const role = portal === "companion" ? UserRole.COMPANION : UserRole.CUSTOMER;
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
      if (existingAccount.user.role !== role) {
        throw new UnauthorizedException("这个第三方账号已绑定到其他入口");
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

    if (portal === "companion") {
      throw new UnauthorizedException("陪玩注册需要先联系客服考核，通过后由管理员开通登录方式");
    }

    const displayName = await this.getAvailableDisplayName(role, profile.displayName);
    const displayNameKey = normalizeDisplayNameKey(displayName);
    const email = buildOAuthEmail(platform, role, profile.externalUserId);
    const passwordHash = await createPasswordHash(randomBytes(32).toString("hex"));

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            passwordHash,
            role,
            displayName,
            displayNameKey,
            referralCode: await generateUniqueReferralCode(tx, "C")
          },
          select: { id: true, email: true, role: true, displayName: true, referralCode: true }
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
      if (isPrismaErrorCode(error, "P2002")) {
        throw new BadRequestException("第三方账号已经注册，请直接登录");
      }
      throw error;
    }
  }

  private async getAvailableDisplayName(role: UserRole, displayName: string) {
    const baseName = sanitizeOAuthDisplayName(displayName);
    for (let index = 0; index < 50; index += 1) {
      const candidate = index === 0 ? baseName : `${baseName}-${index + 1}`;
      const displayNameKey = normalizeDisplayNameKey(candidate);
      const existing = await this.prisma.user.findFirst({
        where: { role, displayNameKey },
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
        referralCode: true,
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
            avatarUrl: true,
            game: true,
            onlineStatus: true,
            status: true,
            pricePerHour: true,
            payoutMethod: true,
            payoutAccountName: true,
            payoutAccountNo: true,
            payoutQrCodeUrl: true
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
        },
        externalAccounts: {
          orderBy: { createdAt: "asc" },
          select: {
            platform: true,
            externalUserId: true,
            displayName: true,
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
        displayName: user.displayName,
        referralCode: user.referralCode
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
          avatarUrl: user.companionProfile.avatarUrl,
          game: user.companionProfile.game,
          onlineStatus: user.companionProfile.onlineStatus,
          status: user.companionProfile.status,
          pricePerHour: user.companionProfile.pricePerHour.toString(),
          payoutMethod: user.companionProfile.payoutMethod,
          payoutAccountName: user.companionProfile.payoutAccountName,
          payoutAccountNo: user.companionProfile.payoutAccountNo,
          payoutQrCodeUrl: user.companionProfile.payoutQrCodeUrl
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
      })),
      externalAccounts: user.externalAccounts.map((account) => ({
        platform: account.platform,
        externalUserId: account.externalUserId,
        displayName: account.displayName,
        createdAt: account.createdAt
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

  private async sendVerificationEmail(email: string, code: string, _actionLabel = "注册") {
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

async function generateUniqueReferralCode(tx: Prisma.TransactionClient, prefix: string) {
  for (let index = 0; index < 20; index += 1) {
    const code = `${prefix}${randomInt(100000, 999999)}`;
    const existing = await tx.user.findUnique({
      where: { referralCode: code },
      select: { id: true }
    });
    if (!existing) return code;
  }
  return `${prefix}${randomBytes(4).toString("hex").toUpperCase()}`;
}

function signOAuthState(platform: OAuthPlatform, portal: OAuthPortal) {
  const payload = `${platform}:${portal}:${Date.now()}:${randomBytes(12).toString("hex")}`;
  return `${Buffer.from(payload).toString("base64url")}.${signValue(payload)}`;
}

function parseOAuthState(state: string) {
  const [payloadBase64, signature] = state.split(".");
  if (!payloadBase64 || !signature) return null;
  const payload = Buffer.from(payloadBase64, "base64url").toString("utf8");
  if (signValue(payload) !== signature) return null;
  const [platform, portal, timestamp] = payload.split(":");
  if (!isOAuthPlatform(platform) || !isOAuthPortal(portal)) return null;
  return { platform, portal, timestamp: Number(timestamp) };
}

function verifyOAuthState(state: string, platform: OAuthPlatform, portal: OAuthPortal) {
  const parsed = parseOAuthState(state);
  if (!parsed) return false;
  if (parsed.platform !== platform || parsed.portal !== portal) return false;
  const createdAt = parsed.timestamp;
  return Number.isFinite(createdAt) && Date.now() - createdAt < 10 * 60 * 1000;
}

function isOAuthPlatform(value: string): value is OAuthPlatform {
  return value === "discord" || value === "kook";
}

function isOAuthPortal(value: string): value is OAuthPortal {
  return value === "customer" || value === "companion";
}

function getPortalWebUrl(portal: OAuthPortal) {
  if (portal === "companion") {
    return (process.env.COMPANION_WEB_URL || "http://localhost:3001/companion").replace(/\/$/, "");
  }
  return (process.env.CUSTOMER_WEB_URL || "http://localhost:3000/customer").replace(/\/$/, "");
}

function signValue(value: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new InternalServerErrorException("JWT_SECRET is not configured");
  }
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function oauthPlatformToBotPlatform(platform: OAuthPlatform) {
  return platform === "discord" ? BotPlatform.DISCORD : BotPlatform.KOOK;
}

function buildOAuthEmail(platform: OAuthPlatform, role: UserRole, externalUserId: string) {
  return `${role.toLowerCase()}-${platform}-${externalUserId}@oauth.maycatplay.local`.toLowerCase();
}

function sanitizeOAuthDisplayName(displayName: string) {
  const normalized = displayName.normalize("NFKC").trim().replace(/\s+/g, " ");
  return normalized.slice(0, 32) || `玩家-${randomInt(1000, 9999)}`;
}

function mapRegistrationError(error: unknown) {
  if (error instanceof BadRequestException || error instanceof UnauthorizedException || error instanceof InternalServerErrorException) {
    return error;
  }
  if (isPrismaErrorCode(error, "P2002")) {
    return new BadRequestException(isDisplayNameUniqueError(error) ? "Display name is already taken" : "Email is already registered");
  }
  if (isPrismaErrorCode(error, "P2021") || isPrismaErrorCode(error, "P2022")) {
    return new InternalServerErrorException("Database migration is not applied");
  }
  return error;
}

function isPrismaErrorCode(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === code;
}

function isDisplayNameUniqueError(error: unknown) {
  if (typeof error !== "object" || error === null || !("meta" in error)) return false;
  const meta = (error as { meta?: { target?: unknown } }).meta;
  const target = meta?.target;
  return Array.isArray(target) && target.includes("displayNameKey");
}
