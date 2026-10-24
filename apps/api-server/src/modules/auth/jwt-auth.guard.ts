import { isolatedTestConfig, isolatedClaimsMatch } from "../../isolated-test-runtime";
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UserStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser, JwtPayload } from "./auth.types";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      header(name: string): string | undefined;
      user?: AuthenticatedUser;
    }>();

    const authHeader = request.header("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;

    if (!token) {
      throw new UnauthorizedException("Missing bearer token");
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new UnauthorizedException("JWT_SECRET is not configured");
    }

    const isolated = isolatedTestConfig();
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, { secret,
        ...(isolated ? { algorithms: ["HS256" as const], issuer: isolated.issuer, audience: isolated.audience } : {}) });
      if (isolated && !isolatedClaimsMatch(payload, isolated)) throw new Error("Test identity mismatch");
    } catch {
      throw new UnauthorizedException("Invalid token");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, status: true, sessionVersion: true }
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException("User is not active");
    }
    // A password change or ban bumps the version, so every token issued before it stops working at once.
    if ((payload.sv ?? 0) !== user.sessionVersion) {
      throw new UnauthorizedException("Session expired");
    }

    if (isolated && (user.id !== isolated.subject || user.role !== "CUSTOMER" || !user.email.endsWith("@synthetic.invalid"))) {
      throw new UnauthorizedException("Isolated test customer required");
    }

    request.user = { id: user.id, email: user.email, role: user.role };
    return true;
  }
}
