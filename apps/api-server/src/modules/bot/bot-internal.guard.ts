import { timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";

@Injectable()
export class BotInternalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expectedToken = process.env.BOT_INTERNAL_TOKEN;
    if (!expectedToken) {
      throw new UnauthorizedException("BOT_INTERNAL_TOKEN is not configured");
    }

    const request = context.switchToHttp().getRequest<{ header(name: string): string | undefined }>();
    const receivedToken = request.header("x-bot-token");
    const actual = Buffer.from(receivedToken ?? "");
    const expected = Buffer.from(expectedToken);

    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new UnauthorizedException("Invalid bot token");
    }

    return true;
  }
}
