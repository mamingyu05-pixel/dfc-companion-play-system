import { BadRequestException, Body, Controller, Post, UseGuards } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { DEFAULT_SUPPORT_SUGGESTIONS, PlatformSupportService } from "./platform-support.service";

@Controller("support")
export class SupportController {
  constructor(private readonly platformSupport: PlatformSupportService) {}

  @Post("auto-reply")
  @UseGuards(JwtAuthGuard)
  async autoReply(@CurrentUser() user: AuthenticatedUser, @Body() body: { message?: string }) {
    const message = (body.message || "").trim();
    if (!message) throw new BadRequestException("message is required");

    const result = await this.platformSupport.autoReplyForWeb(user.id, message);
    return {
      ...result,
      suggestions: result.suggestions ?? DEFAULT_SUPPORT_SUGGESTIONS
    };
  }
}
