import { Body, Controller, Post } from "@nestjs/common";

@Controller("auth")
export class AuthController {
  @Post("register/customer")
  registerCustomer(@Body() body: { email: string; password: string; displayName: string }) {
    return {
      accepted: true,
      next: "Create CUSTOMER user with wallet in one transaction",
      email: body.email
    };
  }

  @Post("login")
  login(@Body() body: { email: string; password: string; portal: "customer" | "companion" | "admin" }) {
    return {
      accepted: true,
      next: "Verify password, role and portal permission, then issue JWT",
      email: body.email,
      portal: body.portal
    };
  }
}
