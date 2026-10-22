import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma, UserRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  ANALYTICS_FORMULAS,
  AnalyticsPeriod,
  AnalyticsQuery,
  EXCLUDED_ORDER_STATUSES,
  buildCompanionBoard,
  buildCustomerBoard,
  parseAnalyticsQuery,
} from "./business-analytics";

const ORDER_LIMIT = 10000;

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  customers(query: AnalyticsQuery) {
    const { period, orderScope } = parseAnalyticsQuery(query);
    const window = { gte: period.from, lt: period.to };
    return this.read(period, query, async (tx) => {
      const [orders, newCustomers, approvedRecharges, wallets, withBalance] =
        await Promise.all([
          this.orders(tx, orderScope, window),
          tx.user.findMany({
            where: { role: UserRole.CUSTOMER, createdAt: window },
            select: { id: true, createdAt: true },
          }),
          tx.rechargeRequest.findMany({
            where: { status: "APPROVED", reviewedAt: window },
            select: {
              customerId: true,
              amount: true,
              promotionBonus: true,
              reviewedAt: true,
            },
          }),
          tx.wallet.aggregate({
            where: { user: { role: UserRole.CUSTOMER } },
            _sum: { availableBalance: true, frozenBalance: true },
          }),
          tx.wallet.count({
            where: {
              user: { role: UserRole.CUSTOMER },
              OR: [
                { availableBalance: { gt: 0 } },
                { frozenBalance: { gt: 0 } },
              ],
            },
          }),
        ]);
      const newIds = newCustomers.map((c) => c.id);
      const payerIds = [...new Set(orders.map((o) => o.customerId))];
      const [recharged, returning] = await Promise.all([
        newIds.length
          ? tx.rechargeRequest.groupBy({
              by: ["customerId"],
              where: {
                customerId: { in: newIds },
                status: "APPROVED",
                reviewedAt: { lt: period.to },
              },
            })
          : [],
        payerIds.length
          ? tx.order.groupBy({
              by: ["customerId"],
              where: {
                customerId: { in: payerIds },
                isTest: false,
                status: { notIn: EXCLUDED_ORDER_STATUSES as never },
                createdAt: { lt: period.from },
              },
            })
          : [],
      ]);
      return buildCustomerBoard({
        period,
        orders,
        newCustomers,
        newCustomerRechargedIds: recharged.map((r) => r.customerId),
        returningCustomerIds: returning.map((r) => r.customerId),
        approvedRecharges,
        customerWallets: wallets._sum,
        customersWithBalance: withBalance,
      });
    });
  }

  companions(query: AnalyticsQuery) {
    const { period, orderScope } = parseAnalyticsQuery(query);
    const window = { gte: period.from, lt: period.to };
    return this.read(period, query, async (tx) => {
      const [orders, profiles, withdrawals] = await Promise.all([
        this.orders(tx, orderScope, window),
        tx.companionProfile.findMany({
          select: {
            userId: true,
            status: true,
            onlineStatus: true,
            createdAt: true,
          },
        }),
        tx.withdrawalRequest.findMany({
          where: {
            OR: [
              { createdAt: window },
              { paidAt: window },
              { status: { in: ["PENDING", "APPROVED"] } },
            ],
          },
          select: { status: true, amount: true, createdAt: true, paidAt: true },
        }),
      ]);
      return buildCompanionBoard({ period, orders, profiles, withdrawals });
    });
  }

  private async orders(
    tx: Prisma.TransactionClient,
    scope: Prisma.OrderWhereInput,
    window: Prisma.DateTimeFilter,
  ) {
    const rows = await tx.order.findMany({
      where: { ...scope, createdAt: window },
      select: {
        id: true,
        customerId: true,
        companionId: true,
        status: true,
        mode: true,
        priceTier: true,
        hours: true,
        totalAmount: true,
        refundAmount: true,
        platformFee: true,
        companionIncome: true,
        createdAt: true,
        acceptedAt: true,
        customer: { select: { displayName: true } },
        companion: { select: { displayName: true } },
        complaints: { select: { status: true } },
        review: { select: { stars: true, hidden: true } },
      },
      take: ORDER_LIMIT + 1,
    });
    if (rows.length > ORDER_LIMIT)
      throw new BadRequestException(
        "Report exceeds 10,000 orders; narrow the reporting window",
      );
    return rows;
  }

  private read<T>(
    period: AnalyticsPeriod,
    query: AnalyticsQuery,
    build: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.prisma.$transaction(
      async (tx) => ({
        period: {
          from: period.from.toISOString(),
          to: period.to.toISOString(),
          timezone: "UTC",
          endExclusive: true,
        },
        asOf: new Date().toISOString(),
        filters: query,
        formulas: ANALYTICS_FORMULAS,
        ...(await build(tx)),
      }),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 20000,
      },
    );
  }
}
