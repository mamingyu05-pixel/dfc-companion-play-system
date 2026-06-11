import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
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

  @Post("register/customer")
  registerCustomer(@Body() body: { email: string; password: string; displayName: string; emailCode: string }) {
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

  @Get("oauth/:platform/start")
  startCustomerOAuth(@Param("platform") platform: "discord" | "kook", @Res() response: { redirect: (url: string) => void }) {
    response.redirect(this.auth.getCustomerOAuthStartUrl(platform));
  }

  @Get("oauth/:platform/callback")
  async completeCustomerOAuth(
    @Param("platform") platform: "discord" | "kook",
    @Query("code") code: string,
    @Query("state") state: string,
    @Query("error") error: string | undefined,
    @Res() response: { redirect: (url: string) => void }
  ) {
    response.redirect(await this.auth.completeCustomerOAuth(platform, { code, state, error }));
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.getMe(user.id);
  }
}
