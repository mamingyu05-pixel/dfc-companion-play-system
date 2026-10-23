import { BadRequestException, Injectable } from "@nestjs/common";
import {
  GameCode,
  OrderStatus,
  Prisma,
  ServicePriceTier,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type OperationsQuery = {
  from?: string;
  to?: string;
  store?: string;
  game?: string;
  tier?: string;
};
const total = (values: Prisma.Decimal[]) =>
  values.reduce((sum, value) => sum.add(value), new Prisma.Decimal(0));
const unresolved = ["OPEN", "IN_REVIEW"];

@Injectable()
export class OperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(query: OperationsQuery) {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - 30 * 86_400_000);
    if (
      !Number.isFinite(from.getTime()) ||
      !Number.isFinite(to.getTime()) ||
      from >= to ||
      to.getTime() - from.getTime() > 366 * 86_400_000
    )
      throw new BadRequestException(
        "Use a valid date range of at most 366 days; end is exclusive",
      );
    if (query.game && !Object.values(GameCode).includes(query.game as GameCode))
      throw new BadRequestException("Invalid game");
    if (
      query.tier &&
      !Object.values(ServicePriceTier).includes(query.tier as ServicePriceTier)
    )
      throw new BadRequestException("Invalid price tier");
    const scope: Prisma.OrderWhereInput = {
      isTest: false,
      ...(query.store ? { storeKey: query.store } : {}),
      ...(query.game ? { game: query.game as GameCode } : {}),
      ...(query.tier ? { priceTier: query.tier as ServicePriceTier } : {}),
    };
    const period = { gte: from, lt: to };
    return this.prisma.$transaction(
      async (tx) => {
        const [
          orders,
          wallets,
          recharges,
          refunds,
          pending,
          pendingCount,
          failedJobs,
          drafts,
        ] = await Promise.all([
          tx.order.findMany({
            where: {
              ...scope,
              OR: [{ createdAt: period }, { verifiedAt: period }],
            },
            include: {
              complaints: { select: { id: true, status: true } },
              companion: { select: { id: true, displayName: true } },
              assignedBy: { select: { id: true, displayName: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 10001,
          }),
          tx.wallet.aggregate({
            _sum: {
              availableBalance: true,
              frozenBalance: true,
              pendingIncome: true,
              availableIncome: true,
              frozenIncome: true,
            },
          }),
          tx.rechargeRequest.aggregate({
            where: { status: "APPROVED", reviewedAt: period },
            _sum: { amount: true },
          }),
          tx.walletTransaction.aggregate({
            where: { type: "ORDER_REFUND", createdAt: period },
            _sum: { amount: true },
          }),
          tx.order.findMany({
            where: {
              ...scope,
              status: {
                in: ["PAID", "ASSIGNED", "AWAITING_ACCEPTANCE", "DISPUTED"],
              },
            },
            orderBy: { updatedAt: "asc" },
            take: 100,
            include: {
              assignedBy: { select: { id: true, displayName: true } },
              complaints: {
                where: { status: { in: ["OPEN", "IN_REVIEW"] } },
                select: { id: true },
              },
            },
          }),
          tx.order.count({
            where: {
              ...scope,
              status: {
                in: ["PAID", "ASSIGNED", "AWAITING_ACCEPTANCE", "DISPUTED"],
              },
            },
          }),
          tx.integrationJob.findMany({
            where: {
              OR: [
                { status: { in: ["FAILED", "UNKNOWN"] } },
                { status: "PROCESSING", leaseUntil: { lt: new Date() } },
                {
                  status: "PENDING",
                  createdAt: { lt: new Date(Date.now() - 5 * 60_000) },
                },
              ],
            },
            orderBy: { createdAt: "asc" },
            take: 50,
            select: {
              id: true,
              key: true,
              kind: true,
              status: true,
              attempts: true,
              lastError: true,
              createdAt: true,
            },
          }),
          tx.orderDraft.findMany({
            where: { createdAt: period, status: { not: "CANCELLED" } },
            include: {
              serviceAdmin: { select: { id: true, displayName: true } },
              convertedOrder: { include: { complaints: true } },
              convertedOrderGroup: {
                include: { orders: { include: { complaints: true } } },
              },
            },
            take: 10001,
          }),
        ]);
        if (orders.length > 10000 || drafts.length > 10000)
          throw new BadRequestException(
            "Report exceeds 10,000 records; narrow the reporting window",
          );
        const inWindow = (date: Date | null) =>
          date !== null && date >= from && date < to;
        const hasOpenComplaint = (order: (typeof orders)[number]) =>
          order.complaints.some((c) => unresolved.includes(c.status));
        const recognized = orders.filter(
          (order) => order.status === "COMPLETED" && inWindow(order.verifiedAt),
        );
        const recognizedUnderReview = recognized.filter(hasOpenComplaint);
        const recognizedIds = recognized.map((o) => o.id);
        const costs = recognizedIds.length
          ? await tx.walletTransaction.aggregate({
              where: {
                type: "REFERRAL_REWARD",
                referenceType: "ORDER_REFERRAL_COMMISSION",
                referenceId: { in: recognizedIds },
              },
              _sum: { amount: true },
            })
          : { _sum: { amount: null } };
        const revenue = total(
          recognized.map((o) => o.totalAmount.sub(o.refundAmount)),
        );
        const platformFee = total(recognized.map((o) => o.platformFee));
        const companionIncome = total(recognized.map((o) => o.companionIncome));
        const referralCost = costs._sum.amount ?? new Prisma.Decimal(0);
        const expectedFrozen = await tx.order.aggregate({
          where: {
            status: {
              in: [
                "PAID",
                "ASSIGNED",
                "ACCEPTED",
                "IN_PROGRESS",
                "AWAITING_ACCEPTANCE",
                "DISPUTED",
              ],
            },
          },
          _sum: { totalAmount: true },
        });
        const frozenDifference = (
          wallets._sum.frozenBalance ?? new Prisma.Decimal(0)
        ).sub(expectedFrozen._sum.totalAmount ?? 0);
        const byCohort = new Map<string, typeof recognized>();
        for (const order of recognized) {
          const duration = order.hours.lte(1)
            ? "≤1h"
            : order.hours.lte(3)
              ? "1–3h"
              : ">3h";
          const key = [
            order.storeKey,
            order.game,
            order.priceTier,
            order.unitPrice.toFixed(2),
            duration,
          ].join(" / ");
          byCohort.set(key, [...(byCohort.get(key) ?? []), order]);
        }
        const cohorts = [...byCohort].map(([key, rows]) => ({
          key,
          sample: rows.length,
          hours: total(rows.map((o) => o.hours)).toString(),
          serviceRevenue: total(
            rows.map((o) => o.totalAmount.sub(o.refundAmount)),
          ).toFixed(2),
          grossCommission: total(rows.map((o) => o.platformFee)).toFixed(2),
          orderIds: rows.map((o) => o.id),
        }));
        const eligible = orders.filter(
          (o) =>
            inWindow(o.createdAt) &&
            !["CANCELLED", "REFUNDED", "PENDING_PAYMENT", "DISPUTED"].includes(
              o.status,
            ) &&
            !hasOpenComplaint(o),
        );
        // Blown runs on this window's guarantee orders, for the quality columns below.
        const guaranteeIds = orders.filter((o) => o.serviceKind === "GUARANTEE").map((o) => o.id);
        const blownByOrder = new Map(
          (guaranteeIds.length
            ? await tx.orderEvidence.groupBy({ by: ["orderId"], where: { kind: "BLOWN_RUN", orderId: { in: guaranteeIds } }, _count: { _all: true } })
            : []
          ).map((row) => [row.orderId, row._count._all]),
        );
        const minutes = (o: (typeof orders)[number]) =>
          o.startedAt && o.reportedCompletedAt ? (o.reportedCompletedAt.getTime() - o.startedAt.getTime()) / 60_000 : null;
        const average = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);
        const companionMetrics = [
          ...new Set(
            eligible
              .map((o) => o.companionId)
              .filter((id): id is string => Boolean(id)),
          ),
        ].map((id) => {
          const rows = eligible.filter((o) => o.companionId === id);
          const done = rows.filter(
            (o) => o.status === "COMPLETED" && o.verifiedAt,
          );
          // Complaints count across every order this window, including disputed ones the sample above leaves out.
          const all = orders.filter((o) => o.companionId === id && inWindow(o.createdAt));
          const complained = all.filter((o) => o.complaints.length > 0).length;
          const guaranteeDone = done.filter((o) => o.serviceKind === "GUARANTEE");
          const avgGuaranteeMinutes = average(guaranteeDone.map(minutes).filter((m): m is number => m !== null));
          const blownRuns = guaranteeDone.reduce((sum, o) => sum + (blownByOrder.get(o.id) ?? 0), 0);
          const complaintRate = all.length ? complained / all.length : 0;
          const qualityFlags = [
            // Escort shops judge cheating partly by finish time: a guarantee cleared far faster than usual is worth a look.
            avgGuaranteeMinutes !== null && guaranteeDone.length >= 3 && avgGuaranteeMinutes < 20 ? "保底结单异常快，抽查录屏" : null,
            all.length >= 5 && complaintRate >= 0.2 ? "投诉率偏高" : null,
            guaranteeDone.length >= 3 && blownRuns / guaranteeDone.length >= 1 ? "炸单频繁" : null
          ].filter((flag): flag is string => Boolean(flag));
          const clientCounts = new Map<string, number>();
          for (const o of done)
            clientCounts.set(
              o.customerId,
              (clientCounts.get(o.customerId) ?? 0) + 1,
            );
          return {
            id,
            name: rows[0].companion?.displayName ?? id,
            sample: rows.length,
            completed: done.length,
            completionDenominator: rows.length,
            serviceHours: total(done.map((o) => o.hours)).toString(),
            repeatCustomers: [...clientCounts.values()].filter((n) => n > 1)
              .length,
            uniqueCustomers: clientCounts.size,
            verifiedComplaintOrders: rows.filter((o) =>
              o.complaints.some((c) => c.status === "RESOLVED"),
            ).length,
            avgServiceMinutes: average(done.map(minutes).filter((m): m is number => m !== null)),
            avgGuaranteeMinutes,
            guaranteeCompleted: guaranteeDone.length,
            blownRuns,
            complaintRate: Number(complaintRate.toFixed(3)),
            qualityFlags,
            sampleWarning: rows.length < 10 ? "样本不足，仅供逐单复核" : null,
            orderIds: rows.map((o) => o.id),
          };
        });
        const serviceMetrics = [
          ...new Set(
            drafts
              .map((d) => d.serviceAdminId)
              .filter((id): id is string => Boolean(id)),
          ),
        ].map((id) => {
          const rows = drafts.filter((d) => d.serviceAdminId === id);
          const converted = rows.filter((d) =>
            [d.convertedOrder, ...(d.convertedOrderGroup?.orders ?? [])].some(
              (o) =>
                o &&
                !o.isTest &&
                !o.complaints.some((c) => unresolved.includes(c.status)) &&
                [
                  "PAID",
                  "ASSIGNED",
                  "ACCEPTED",
                  "IN_PROGRESS",
                  "AWAITING_ACCEPTANCE",
                  "COMPLETED",
                ].includes(o.status),
            ),
          );
          return {
            id,
            name: rows[0].serviceAdmin?.displayName ?? id,
            demands: rows.length,
            paidDemands: converted.length,
            firstResponseMs: null,
            pendingDemands: rows.filter((d) =>
              ["OPEN", "TRIALING", "SELECTED", "CUSTOMER_CONFIRMED"].includes(
                d.status,
              ),
            ).length,
            sampleWarning:
              rows.length < 10
                ? "样本不足；响应时长尚未采集"
                : "响应时长尚未采集",
            draftIds: rows.map((d) => d.id),
          };
        });
        const serializeMoney = (value: Prisma.Decimal | null) =>
          (value ?? new Prisma.Decimal(0)).toFixed(2);
        return {
          period: {
            from: from.toISOString(),
            to: to.toISOString(),
            timezone: "UTC",
            endExclusive: true,
          },
          asOf: new Date().toISOString(),
          filters: query,
          formulas: {
            serviceRevenue:
              "观察窗内验收且当前已完成订单的实付减订单退款；排除测试订单，历史无验收记录单列。验收后申诉金额单列待复核，未裁决前不冲销已确认收入。",
            contributionMargin:
              "平台毛佣金减这批订单的推荐佣金；未纳入人工、税费、支付费用、营销补贴等，不能称净利润。",
            companion:
              "同创建窗内非测试、非取消/退款/争议、无未决投诉的已支付订单；完成率分子为已验收完成，分母与原单均可见。",
            service:
              "全店非取消需求中已有有效付费订单的比例；归属为草稿负责人，尚未记录转接工时与首次响应，不能据此排名。",
            walletScope:
              "钱包、充值与退款流水是全平台快照/期间值，尚无资金门店归属；门店/游戏/价档过滤仅应用于订单和陪玩指标。",
            management:
              "不生成综合排名、自动扣薪或任用决定；未核实投诉不扣分，支持从原单进入投诉/申诉并人工复核。",
          },
          financial: {
            rechargePrincipal: serializeMoney(recharges._sum.amount),
            refundToPlatformBalance: serializeMoney(refunds._sum.amount),
            serviceRevenue: revenue.toFixed(2),
            grossCommission: platformFee.toFixed(2),
            companionIncome: companionIncome.toFixed(2),
            referralCost: referralCost.toFixed(2),
            knownCostContribution: platformFee.sub(referralCost).toFixed(2),
            recognizedOrderCount: recognized.length,
            recognizedRevenueUnderReview: total(
              recognizedUnderReview.map((o) =>
                o.totalAmount.sub(o.refundAmount),
              ),
            ).toFixed(2),
            customerAvailable: serializeMoney(wallets._sum.availableBalance),
            customerFrozen: serializeMoney(wallets._sum.frozenBalance),
            companionPending: serializeMoney(wallets._sum.pendingIncome),
            companionAvailableBeforeDisputeReserve: serializeMoney(
              wallets._sum.availableIncome,
            ),
            companionWithdrawalFrozen: serializeMoney(
              wallets._sum.frozenIncome,
            ),
            frozenReconciliationDifference: frozenDifference.toFixed(2),
            historicalUnverifiedCount: orders.filter(
              (o) => o.status === "COMPLETED" && !o.verifiedAt,
            ).length,
          },
          cohorts,
          companionMetrics,
          serviceMetrics,
          draftEvidence: drafts.map((d) => ({
            id: d.id,
            draftNo: d.draftNo,
            status: d.status,
            owner: d.serviceAdmin?.displayName ?? "待认领",
            createdAt: d.createdAt,
            orderIds: [
              ...new Set(
                [
                  d.convertedOrder?.id,
                  ...(d.convertedOrderGroup?.orders.map((o) => o.id) ?? []),
                ].filter((id): id is string => Boolean(id)),
              ),
            ],
          })),
          exceptions: {
            totalOrders: pendingCount,
            orderListLimit: 100,
            orders: pending.map((o) => ({
              id: o.id,
              orderNo: o.orderNo,
              status: o.status,
              amount: o.totalAmount.toFixed(2),
              owner: o.assignedBy?.displayName ?? "待认领",
              updatedAt: o.updatedAt,
              complaintIds: o.complaints.map((c) => c.id),
              nextAction:
                o.status === "AWAITING_ACCEPTANCE"
                  ? "客户确认或管理员记录验收依据"
                  : o.status === "DISPUTED"
                    ? "核对证据并明确退款金额，人工裁决"
                    : "检查指定陪玩绑定与通知记录",
            })),
            integrationJobs: failedJobs,
          },
          orderEvidence: orders.map((o) => ({
            id: o.id,
            orderNo: o.orderNo,
            store: o.storeKey,
            game: o.game,
            tier: o.priceTier,
            hours: o.hours.toString(),
            paid: o.totalAmount.toFixed(2),
            refund: o.refundAmount.toFixed(2),
            platformFee: o.platformFee.toFixed(2),
            companionIncome: o.companionIncome.toFixed(2),
            status: o.status,
            verifiedAt: o.verifiedAt,
            includedInRevenue: recognizedIds.includes(o.id),
            complaintIds: o.complaints.map((c) => c.id),
          })),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 20000,
      },
    );
  }
}
