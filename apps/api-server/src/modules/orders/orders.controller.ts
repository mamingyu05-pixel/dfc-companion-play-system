import { Body, Controller, Param, Patch, Post } from "@nestjs/common";

@Controller("orders")
export class OrdersController {
  @Post()
  createOrder(@Body() body: { mode: string; hours: string; companionId?: string; notes?: string }) {
    return {
      accepted: true,
      next: "Calculate amount server-side, debit customer wallet, create PAID order and order_status_logs",
      mode: body.mode,
      hours: body.hours
    };
  }

  @Patch(":id/start")
  startOrder(@Param("id") id: string) {
    return {
      accepted: true,
      next: "Only accepted companion/admin can move ACCEPTED order to IN_PROGRESS",
      id
    };
  }

  @Patch(":id/complete")
  completeOrder(@Param("id") id: string) {
    return {
      accepted: true,
      next: "Settle platform fee and companion pending_income using idempotent transaction",
      id
    };
  }
}
