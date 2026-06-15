import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthenticatedUser } from "./auth.types";
import { CurrentUser } from "./current-user.decorator";
import { JwtAuthGuard } from "./jwt-auth.guard";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("email-verification-code")
  requestCustomerEmailVerification(@Body() body: { email: string }) {
    return this.auth.requestCustomerEmailVerification(body);
  }

  @Post("password-reset-code")
  requestCustomerPasswordResetCode(@Body() body: { email: string }) {
    return this.auth.requestCustomerPasswordResetCode(body);
  }

  @Post("password-reset")
  resetCustomerPassword(@Body() body: { email: string; emailCode: string; password: string }) {
    return this.auth.resetCustomerPassword(body);
  }

  @Post("register/customer")
  registerCustomer(@Body() body: { email: string; password: string; displayName: string; emailCode: string; referralCode?: string }) {
    return this.auth.registerCustomer(body);
  }

  @Post("login")
  login(@Body() body: { email: string; password: string; portal: "customer" | "companion" | "admin" }) {
    return this.auth.login(body);
  }

  @Get("public-config")
  publicConfig() {
    return this.auth.getPublicConfig();
  }

  @Post("platform-binding-code")
  @UseGuards(JwtAuthGuard)
  createPlatformBindingCode(@CurrentUser() user: AuthenticatedUser, @Body() body: { platform: "DISCORD" | "KOOK" }) {
    return this.auth.createPlatformBindingCode(user.id, body);
  }

  @Get("oauth/:platform/start")
  startOAuth(
    @Param("platform") platform: "discord" | "kook",
    @Query("portal") portal: "customer" | "companion" | undefined,
    @Res() response: { redirect: (url: string) => void }
  ) {
    response.redirect(this.auth.getOAuthStartUrl(platform, portal === "companion" ? "companion" : "customer"));
  }

  @Get("oauth/:platform/callback")
  async completeCustomerOAuth(
    @Param("platform") platform: "discord" | "kook",
    @Query("code") code: string,
    @Query("state") state: string,
    @Query("error") error: string | undefined,
    @Res() response: { redirect: (url: string) => void }
  ) {
    response.redirect(await this.auth.completeOAuth(platform, { code, state, error }));
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.getMe(user.id);
  }

  @Patch("me/companion-media")
  @UseGuards(JwtAuthGuard)
  updateMyCompanionMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { avatarUrl?: string | null; photoUrls?: string[]; voiceIntroUrl?: string | null }
  ) {
    return this.auth.updateMyCompanionMedia(user.id, body);
  }
}
