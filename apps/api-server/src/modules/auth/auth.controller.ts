import { Body, Controller, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";

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
}
