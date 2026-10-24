import { randomBytes } from "node:crypto";
import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { AuthRateLimitGuard } from "./auth-rate-limit.guard";
import { AuthService } from "./auth.service";
import { AuthenticatedUser } from "./auth.types";
import { CurrentUser } from "./current-user.decorator";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { WechatAuthService } from "./wechat-auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly wechat: WechatAuthService) {}

  @Get("wechat/config")
  wechatConfig() {
    return this.wechat.publicConfig();
  }

  @Post("wechat/login")
  @UseGuards(AuthRateLimitGuard)
  wechatLogin(@Body() body: unknown) {
    return this.wechat.login(body);
  }

  @Post("email-verification-code")
  @UseGuards(AuthRateLimitGuard)
  requestCustomerEmailVerification(@Body() body: { email: string }) {
    return this.auth.requestCustomerEmailVerification(body);
  }

  @Post("password-reset-code")
  @UseGuards(AuthRateLimitGuard)
  requestCustomerPasswordResetCode(@Body() body: { email: string }) {
    return this.auth.requestCustomerPasswordResetCode(body);
  }

  @Post("password-reset")
  @UseGuards(AuthRateLimitGuard)
  resetCustomerPassword(@Body() body: { email: string; emailCode: string; password: string }) {
    return this.auth.resetCustomerPassword(body);
  }

  @Post("register/customer")
  @UseGuards(AuthRateLimitGuard)
  registerCustomer(@Body() body: { email: string; password: string; displayName: string; emailCode: string; referralCode?: string }) {
    return this.auth.registerCustomer(body);
  }

  @Post("register/companion")
  @UseGuards(AuthRateLimitGuard)
  registerCompanion(@Body() body: { email: string; password: string; displayName: string; emailCode: string }) {
    return this.auth.registerCompanion(body);
  }

  @Post("login")
  @UseGuards(AuthRateLimitGuard)
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

  // Opened from a private KOOK card; never requires a password.
  @Get("web-link")
  async redeemWebLink(@Query("t") token: string | undefined, @Req() request: CookieRequest, @Res() response: RedirectResponse) {
    response.redirect(await this.auth.redeemWebLoginLink(token, issueBrowserNonce(request, response)));
  }

  @Get("oauth/:platform/start")
  startOAuth(
    @Param("platform") platform: "discord" | "kook",
    @Query("portal") portal: "customer" | "companion" | "admin" | undefined,
    @Req() request: CookieRequest,
    @Res() response: RedirectResponse
  ) {
    const resolvedPortal = portal === "companion" || portal === "admin" ? portal : "customer";
    response.redirect(this.auth.getOAuthStartUrl(platform, resolvedPortal, issueBrowserNonce(request, response)));
  }

  @Get("oauth/:platform/callback")
  async completeCustomerOAuth(
    @Param("platform") platform: "discord" | "kook",
    @Query("code") code: string,
    @Query("state") state: string,
    @Query("error") error: string | undefined,
    @Req() request: CookieRequest,
    @Res() response: RedirectResponse
  ) {
    response.redirect(await this.auth.completeOAuth(platform, { code, state, error }, readBrowserNonce(request)));
  }

  // The callback page trades its one-time receipt for a session; the nonce cookie proves it is the same browser.
  @Post("login-receipt")
  @UseGuards(AuthRateLimitGuard)
  exchangeLoginReceipt(@Body() body: { receipt?: unknown }, @Req() request: CookieRequest) {
    return this.auth.exchangeLoginReceipt(body?.receipt, readBrowserNonce(request));
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

  @Patch("me/companion-online-status")
  @UseGuards(JwtAuthGuard)
  updateMyCompanionOnlineStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { onlineStatus?: "ONLINE" | "BUSY" | "OFFLINE" }
  ) {
    return this.auth.updateMyCompanionOnlineStatus(user.id, body);
  }

  @Patch("me/companion-games")
  @UseGuards(JwtAuthGuard)
  updateMyCompanionGames(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { games?: string[] }
  ) {
    return this.auth.updateMyCompanionGames(user.id, body);
  }

}

type CookieRequest = { headers: { cookie?: string; "x-forwarded-proto"?: string | string[] }; secure?: boolean };
type RedirectResponse = {
  redirect: (url: string) => void;
  cookie: (name: string, value: string, options: Record<string, unknown>) => void;
};

const LOGIN_NONCE_COOKIE = "dfc_login_nonce";

function readBrowserNonce(request: CookieRequest) {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === LOGIN_NONCE_COOKIE) {
      const value = rest.join("=");
      return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
    }
  }
  return undefined;
}

// A fresh random nonce per login attempt, readable only by the API; Lax so it rides the provider's redirect back.
function issueBrowserNonce(request: CookieRequest, response: RedirectResponse) {
  const nonce = randomBytes(32).toString("base64url");
  const proto = request.headers["x-forwarded-proto"];
  const secure = Boolean(request.secure) || (Array.isArray(proto) ? proto[0] : proto)?.split(",")[0].trim() === "https";
  response.cookie(LOGIN_NONCE_COOKIE, nonce, { httpOnly: true, sameSite: "lax", secure, path: "/api/auth", maxAge: 15 * 60 * 1000 });
  return nonce;
}
