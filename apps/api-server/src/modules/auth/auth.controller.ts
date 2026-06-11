import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthenticatedUser } from "./auth.types";
import { CurrentUser } from "./current-user.decorator";
import { JwtAuthGuard } from "./jwt-auth.guard";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register/customer")
  registerCustomer(@Body() body: { email: string; password: string; displayName: string }) {
    return this.auth.registerCustomer(body);
  }

  @Post("login")
  login(@Body() body: { email: string; password: string; portal: "customer" | "companion" | "admin" }) {
    return this.auth.login(body);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.getMe(user.id);
  }
}
