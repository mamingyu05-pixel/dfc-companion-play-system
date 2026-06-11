import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { CompanionProfileStatus, UserRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtPayload } from "./auth.types";
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

    const passwordHash = await createPasswordHash(body.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: body.email.toLowerCase(),
          passwordHash,
          role: UserRole.CUSTOMER,
          displayName: body.displayName
        },
        select: { id: true, email: true, role: true, displayName: true }
      });

      await tx.wallet.create({ data: { userId: created.id } });
      return created;
    });

    return {
      user,
      accessToken: await this.issueToken({ sub: user.id, email: user.email, role: user.role })
    };
  }

  async login(body: { email: string; password: string; portal: Portal }) {
    if (!body.email || !body.password) {
      throw new BadRequestException("email and password are required");
    }

    if (!["customer", "companion", "admin"].includes(body.portal)) {
      throw new BadRequestException("Invalid portal");
    }

    const user = await this.prisma.user.findUnique({
      where: { email: body.email.toLowerCase() },
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
