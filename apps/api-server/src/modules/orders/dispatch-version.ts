import { BadRequestException } from "@nestjs/common";
import { DISPATCH_REFRESH_MESSAGE } from "@dfc/shared";

export class DispatchVersionException extends BadRequestException {
  constructor() { super(DISPATCH_REFRESH_MESSAGE); }
}

export function requireDispatchVersion(version: unknown): asserts version is number {
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) throw new DispatchVersionException();
}

export function assertDispatchVersion(current: number, requested: unknown) {
  requireDispatchVersion(requested);
  if (current !== requested) throw new DispatchVersionException();
}
