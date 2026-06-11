import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { CompanionProfileStatus, Prisma, UserRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtPayload } from "./auth.types";
import { isValidEmail, normalizeEmail } from "./email.util";
import { createPasswordHash, verifyPassword } from "./password.util";

type Portal = "customer" | "companion" | "admin";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService
  ) {}

  async registerCustomer(body: { email: string; password: string; displayName: string }) {
    if (!body.email || !body.password || !body.displayName) {
      throw new BadRequestException("email, password and displayName are required");
    }

    const email = normalizeEmail(body.email);
    const displayName = body.displayName.trim();

    if (!email || !displayName) {
      throw new BadRequestException("email, password and displayName are required");
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

    const passwordHash = await createPasswordHash(body.password);

    const user = await this.createCustomerUser({
      email,
      passwordHash,
      displayName
    });

    return {
      user,
      accessToken: await this.issueToken({ sub: user.id, email: user.email, role: user.role })
    };
  }

  private async createCustomerUser(body: { email: string; passwordHash: string; displayName: string }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
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
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("Email is already registered");
      }
      throw error;
    }
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
}

class ForbiddenPortalException extends UnauthorizedException {
  constructor() {
    super("User role cannot access this portal");
  }
}
