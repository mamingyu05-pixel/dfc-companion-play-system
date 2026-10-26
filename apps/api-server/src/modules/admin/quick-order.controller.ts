import { BadRequestException, Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { GameCode, OrderSourcePlatform, Prisma, ServicePriceTier, UserRole, UserStatus } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { fixedDecimal } from "../financial-values";
import { OrdersService } from "../orders/orders.service";
import { PrismaService } from "../prisma/prisma.service";
import { WalletService } from "../wallet/wallet.service";

type OrderInput = {
  customerId?: unknown; kind?: unknown; game?: unknown; mode?: unknown; hours?: unknown; companionId?: unknown;
  customUnitPrice?: unknown; packageId?: unknown; notes?: unknown;
};
type QuickOrderBody = OrderInput & {
  requestId?: unknown; expectedTotalAmount?: unknown;
  topUp?: { amount?: unknown; method?: unknown; screenshotUrl?: unknown; note?: unknown } | null;
};
type RechargeReceipt = { id: string; amount: string; requestId: string; replayed: boolean };

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

// One screen for the usual KOOK case: a customer messages support, staff place the order for them
// (topping up their balance first if they just paid), and send it to a companion or the dispatch channel.
@Controller("admin/quick-order")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class QuickOrderController {
  constructor(private readonly prisma: PrismaService, private readonly orders: OrdersService, private readonly wallet: WalletService) {}

  @Post("preview")
  async preview(@Body() body: OrderInput) {
    const customer = await this.customer(body.customerId);
    // Priced as a KOOK order, exactly as create() will place it.
    const quote = await this.orders.quoteOrder({ ...this.orderFields(body), sourcePlatform: OrderSourcePlatform.KOOK }, customer.id);
    const balance = customer.wallet?.availableBalance ?? new Prisma.Decimal(0);
    const shortfall = Prisma.Decimal.max(new Prisma.Decimal(quote.totalAmount).sub(balance), 0);
    return { ...quote, balance: balance.toFixed(2), shortfall: shortfall.toFixed(2) };
  }

  @Post()
  @HttpCode(200)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() body: QuickOrderBody) {
    const requestId = str(body.requestId);
    // The top-up reuses this id with a suffix, which must still fit the 64-char staff recharge id.
    if (!/^[A-Za-z0-9_-]{16,56}$/.test(requestId)) throw new BadRequestException("requestId 无效");
    const customer = await this.customer(body.customerId);
    const expectedTotalAmount = str(body.expectedTotalAmount);
    try { fixedDecimal(expectedTotalAmount, "expectedTotalAmount"); } catch { throw new BadRequestException("请先核对订单金额"); }
    const fields = this.orderFields(body);

    let toppedUp = false;
    let recharge: RechargeReceipt | null = null;
    if (body.topUp) {
      const topUp = await this.wallet.recordStaffRecharge(customer.id, user.id, { ...body.topUp, requestId: `${requestId}-topup` });
      toppedUp = !topUp.replayed;
      recharge = { id: topUp.recharge.id, amount: topUp.recharge.amount.toFixed(2), requestId: `${requestId}-topup`, replayed: topUp.replayed };
    }
    let order: Awaited<ReturnType<OrdersService["createOrder"]>>;
    try {
      order = await this.orders.createOrder(customer.id, {
        ...fields, mode: fields.mode ?? "GUARANTEE", hours: fields.hours ?? "1",
        requestId, expectedTotalAmount, notes: str(body.notes) || undefined, sourcePlatform: OrderSourcePlatform.KOOK
      });
    } catch (error) {
      const response = error instanceof BadRequestException ? error.getResponse() : null;
      // Only an explicit rollback proves that no order exists. Unknown commit outcomes keep the original request retryable.
      if (!recharge || !response || typeof response !== "object" || !("requestOutcome" in response) || response.requestOutcome !== "NOT_COMMITTED") throw error;
      return { outcome: "RECHARGE_COMMITTED_ORDER_NOT_CREATED" as const, requestId, recharge, order: null,
        toppedUp, dispatched: false, dispatchMode: fields.companionId ? "DIRECT" as const : "OPEN" as const,
        error: { message: (error as BadRequestException).message, orderOutcome: "NOT_COMMITTED" as const } };
    }

    // A retried request returns the same order; only send it out while it is still waiting.
    const companionId = fields.companionId;
    let dispatched = false;
    let dispatchError: string | undefined;
    if (order.status === "PAID") {
      try {
        await this.orders.dispatchOrder(order.id, user.id, companionId
          ? { mode: "DIRECT", companionId, reason: "QUICK_ORDER_DIRECT", dispatchVersion: order.dispatchVersion }
          : { mode: "OPEN", reason: "QUICK_ORDER_OPEN", dispatchVersion: order.dispatchVersion });
        dispatched = true;
      } catch (error) {
        // The order and payment are committed; staff can still dispatch it from the dispatch page.
        dispatchError = error instanceof Error ? error.message : "派单失败";
      }
    }
    return { outcome: "ORDER_CREATED" as const, requestId, recharge,
      order: { id: order.id, orderNo: order.orderNo, totalAmount: order.totalAmount.toFixed(2), status: order.status },
      toppedUp, dispatched, dispatchMode: companionId ? "DIRECT" : "OPEN", dispatchError };
  }

  private async customer(value: unknown) {
    const id = str(value);
    const customer = id ? await this.prisma.user.findFirst({ where: { id, role: UserRole.CUSTOMER, status: UserStatus.ACTIVE }, include: { wallet: true } }) : null;
    if (!customer) throw new BadRequestException("请先选择有效的客户");
    return customer;
  }

  private orderFields(body: OrderInput) {
    const companionId = str(body.companionId) || undefined;
    if (body.kind === "GUARANTEE") {
      const packageId = str(body.packageId);
      if (!packageId) throw new BadRequestException("请选择保底档位");
      return { guaranteePackageId: packageId, companionId, mode: undefined as string | undefined, hours: undefined as string | undefined };
    }
    if (body.kind === "PACKAGE") {
      const packageId = str(body.packageId);
      if (!packageId) throw new BadRequestException("请选择套餐");
      return { servicePackageId: packageId, companionId, mode: undefined as string | undefined, hours: undefined as string | undefined };
    }
    if (body.kind !== "HOURLY") throw new BadRequestException("请选择小时陪玩、保底护航或套餐");
    const game = str(body.game) || GameCode.DELTA_FORCE;
    if (!(Object.values(GameCode) as string[]).includes(game)) throw new BadRequestException("不支持的游戏");
    const customUnitPrice = str(body.customUnitPrice) || undefined;
    return {
      game: game as GameCode, mode: str(body.mode), hours: str(body.hours), companionId,
      // A negotiated price overrides the tier price; otherwise the server prices it as usual.
      ...(customUnitPrice ? { priceTier: ServicePriceTier.CUSTOM, customUnitPrice } : {})
    };
  }
}
