import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "@prisma/client";
import { ROLES_KEY } from "./roles.decorator";
import { AuthenticatedUser } from "./auth.types";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowedRoles =
      this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [context.getHandler(), context.getClass()]) ?? [];

    if (allowedRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    const hasRole =
      user &&
      (allowedRoles.includes(user.role) ||
        (user.role === UserRole.SUPER_ADMIN && allowedRoles.includes(UserRole.ADMIN)));

    if (!hasRole) {
      throw new ForbiddenException("Insufficient role");
    }

    return true;
  }
}
