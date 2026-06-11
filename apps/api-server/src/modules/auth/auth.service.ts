import { BadRequestException, Injectable, InternalServerErrorException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { CompanionProfileStatus, Prisma, UserRole } from "@prisma/client";
import { createHash, randomInt } from "node:crypto";
import nodemailer from "nodemailer";
import { PrismaService } from "../prisma/prisma.service";
import { JwtPayload } from "./auth.types";
import { isValidEmail, normalizeEmail } from "./email.util";
import { createPasswordHash, verifyPassword } from "./password.util";

type Portal = "customer" | "companion" | "admin";

const CUSTOMER_REGISTER_EMAIL_PURPOSE = "CUSTOMER_REGISTER";
const EMAIL_CODE_TTL_MINUTES = 10;
const EMAIL_CODE_RESEND_SECONDS = 60;
const MAX_EMAIL_CODE_ATTEMPTS = 5;

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
    const emailCode = body.emailCode.trim();

    if (!email || !displayName || !emailCode) {
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

    const verificationId = await this.assertCustomerEmailVerification(email, emailCode);
    const passwordHash = await createPasswordHash(body.password);

    const user = await this.createCustomerUser({
      email,
      passwordHash,
      displayName,
      verificationId
    });

    return {
      user,
      accessToken: await this.issueToken({ sub: user.id, email: user.email, role: user.role })
    };
  }

  private async createCustomerUser(body: { email: string; passwordHash: string; displayName: string; verificationId: string }) {
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
            displayName: body.displayName
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
        throw new BadRequestException("Email is already registered");
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
