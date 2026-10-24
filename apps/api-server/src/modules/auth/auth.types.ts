import { UserRole } from "@prisma/client";

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  /** User.sessionVersion at issue time; tokens minted before it existed carry none and count as 0. */
  sv?: number;
}
