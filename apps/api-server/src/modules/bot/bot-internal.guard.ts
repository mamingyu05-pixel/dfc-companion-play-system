import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";

@Injectable()
export class BotInternalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.BOT_INTERNAL_TOKEN;
    if (!expected) {
      throw new UnauthorizedException("BOT_INTERNAL_TOKEN is not configured");
    }

    const request = context.switchToHttp().getRequest<{ header(name: string): string | undefined }>();
    const actual = request.header("x-bot-token");

    if (!actual || actual !== expected) {
      throw new UnauthorizedException("Invalid bot token");
    }

    return true;
  }
}
