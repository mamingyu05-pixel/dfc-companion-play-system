import { BadRequestException, Body, Controller, Get, Header, Param, Post, Query, UseGuards } from "@nestjs/common";
import { BotPlatform, CompanionProfileStatus, Prisma, ReviewStatus, UserRole, UserStatus } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { fixedDecimal } from "../financial-values";
import { PrismaService } from "../prisma/prisma.service";
import { WalletService } from "../wallet/wallet.service";
import { toCsv } from "./csv";

const MAX_BATCH = 200;
const MAX_RECHARGE_BATCH = 100;
const EXPORT_LIMIT = 20000;
const COMPANION_STATUSES = new Set<string>(["LISTED", "UNLISTED", "PENDING_REVIEW", "BANNED"]);

function ids(value: unknown, max: number) {
  if (!Array.isArray(value) || !value.length) throw new BadRequestException("请至少选择一项");
  const list = [...new Set(value.map(String))];
  if (list.length > max) throw new BadRequestException(`一次最多处理 ${max} 项`);
  if (!list.every(id => /^[A-Za-z0-9_-]{1,64}$/.test(id))) throw new BadRequestException("选择的记录无效");
  return list;
}

function money(value: unknown, field: string) {
  try { return fixedDecimal(String(value ?? ""), field); }
  catch { throw new BadRequestException(`${field} 金额格式不对`); }
}

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminBatchController {
  constructor(private readonly prisma: PrismaService, private readonly wallet: WalletService) {}

  // Customers pay support directly, so staff find the customer by name or KOOK/Discord identity.
  @Get("customers/search")
  async searchCustomers(@Query("q") q?: string) {
    const term = (q ?? "").trim().slice(0, 64);
    if (!term) return [];
    const users = await this.prisma.user.findMany({
      where: { role: UserRole.CUSTOMER, status: UserStatus.ACTIVE, OR: [
        { displayName: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } },
        { externalAccounts: { some: { OR: [{ externalUserId: term }, { displayName: { contains: term, mode: "insensitive" } }] } } }
      ] },
      take: 20, orderBy: { createdAt: "desc" },
      select: { id: true, displayName: true, wallet: { select: { availableBalance: true } }, externalAccounts: { select: { platform: true, displayName: true } } }
    });
    return users.map(u => ({
      id: u.id, displayName: u.displayName, balance: u.wallet?.availableBalance.toString() ?? "0.00",
      platforms: u.externalAccounts.map(a => `${a.platform === BotPlatform.KOOK ? "KOOK" : "Discord"}${a.displayName ? `:${a.displayName}` : ""}`)
    }));
  }

  @Post("recharges/staff-record")
  recordStaffRecharge(@CurrentUser() user: AuthenticatedUser, @Body() body: { customerId?: unknown; amount?: unknown; method?: unknown; screenshotUrl?: unknown; note?: unknown; requestId?: unknown }) {
    if (typeof body?.customerId !== "string" || !body.customerId) throw new BadRequestException("请先选择客户");
    return this.wallet.recordStaffRecharge(body.customerId, user.id, body);
  }

  // The client sends the total it showed the admin; if any selected request changed meanwhile the
  // totals differ and nothing is reviewed, so a stale screen can never approve money it did not show.
  @Post("batch/recharges/review")
  async reviewRecharges(@CurrentUser() user: AuthenticatedUser, @Body() body: { ids?: unknown; status?: unknown; note?: unknown; expectedTotal?: unknown }) {
    const list = ids(body?.ids, MAX_RECHARGE_BATCH);
    if (body.status !== "APPROVED" && body.status !== "REJECTED") throw new BadRequestException("status 必须是 APPROVED 或 REJECTED");
    const pending = await this.prisma.rechargeRequest.findMany({ where: { id: { in: list }, status: ReviewStatus.PENDING }, select: { id: true, amount: true } });
    if (pending.length !== list.length) throw new BadRequestException("有充值申请已被处理或不存在，请刷新后重新选择");
    const total = pending.reduce((sum, r) => sum.add(r.amount), new Prisma.Decimal(0));
    if (!total.eq(money(body.expectedTotal, "expectedTotal"))) throw new BadRequestException("合计金额已变化，请刷新后重新确认");
    const note = typeof body.note === "string" ? body.note.slice(0, 200) : undefined;
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of list) {
      try { await this.wallet.reviewRecharge(id, user.id, { status: body.status, note }); results.push({ id, ok: true }); }
      catch (error) { results.push({ id, ok: false, error: error instanceof Error ? error.message : "处理失败" }); }
    }
    return { done: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok) };
  }

  @Post("batch/companions")
  async updateCompanions(@CurrentUser() user: AuthenticatedUser,
    @Body() body: { userIds?: unknown; status?: unknown; commissionRate?: unknown; pricePerHour?: unknown }) {
    const list = ids(body?.userIds, MAX_BATCH);
    const data: Prisma.CompanionProfileUpdateManyMutationInput = {};
    if (body.status !== undefined) {
      if (!COMPANION_STATUSES.has(String(body.status))) throw new BadRequestException("陪玩状态无效");
      data.status = body.status as CompanionProfileStatus;
    }
    if (body.commissionRate !== undefined) {
      const rate = money(body.commissionRate, "commissionRate");
      if (rate.lt(0) || rate.gt(1)) throw new BadRequestException("抽成比例需在 0 到 1 之间");
      data.commissionRate = rate;
    }
    if (body.pricePerHour !== undefined) {
      const price = money(body.pricePerHour, "pricePerHour");
      if (price.lte(0)) throw new BadRequestException("时薪必须大于 0");
      data.pricePerHour = price;
    }
    if (!Object.keys(data).length) throw new BadRequestException("没有需要修改的内容");
    return this.prisma.$transaction(async tx => {
      const profiles = await tx.companionProfile.findMany({ where: { userId: { in: list } }, select: { id: true, userId: true } });
      await tx.companionProfile.updateMany({ where: { userId: { in: profiles.map(p => p.userId) } }, data });
      const detail = { status: data.status ?? null, commissionRate: data.commissionRate?.toString() ?? null, pricePerHour: data.pricePerHour?.toString() ?? null, batch: true };
      await tx.adminLog.createMany({ data: profiles.map(p => ({
        actorId: user.id, targetUserId: p.userId, action: "BATCH_UPDATE_COMPANION", entityType: "COMPANION_PROFILE", entityId: p.id, detail
      })) });
      return { updated: profiles.length, missing: list.length - profiles.length };
    });
  }

  // Only customers and companions: banning staff accounts in bulk is too easy to get wrong.
  @Post("batch/users/status")
  async updateUserStatus(@CurrentUser() user: AuthenticatedUser, @Body() body: { ids?: unknown; status?: unknown }) {
    const list = ids(body?.ids, MAX_BATCH).filter(id => id !== user.id);
    if (body.status !== "ACTIVE" && body.status !== "BANNED") throw new BadRequestException("status 必须是 ACTIVE 或 BANNED");
    const status = body.status === "ACTIVE" ? UserStatus.ACTIVE : UserStatus.BANNED;
    return this.prisma.$transaction(async tx => {
      const targets = await tx.user.findMany({ where: { id: { in: list }, role: { in: [UserRole.CUSTOMER, UserRole.COMPANION] } }, select: { id: true } });
      await tx.user.updateMany({ where: { id: { in: targets.map(t => t.id) } }, data: { status } });
      await tx.adminLog.createMany({ data: targets.map(t => ({
        actorId: user.id, targetUserId: t.id, action: status === UserStatus.ACTIVE ? "ACTIVATE_USER" : "BAN_USER",
        entityType: "USER", entityId: t.id, detail: { batch: true }
      })) });
      return { updated: targets.length, skipped: list.length - targets.length };
    });
  }

  @Get("export/:kind")
  @Header("Content-Type", "text/csv; charset=utf-8")
  async exportCsv(@CurrentUser() user: AuthenticatedUser, @Param("kind") kind: string) {
    const csv = kind === "users" ? await this.usersCsv() : kind === "orders" ? await this.ordersCsv() : kind === "recharges" ? await this.rechargesCsv() : null;
    if (!csv) throw new BadRequestException("可导出：users、orders、recharges");
    await this.prisma.adminLog.create({ data: { actorId: user.id, action: "EXPORT_CSV", entityType: "EXPORT", entityId: kind, detail: { kind } } });
    return csv;
  }

  private async usersCsv() {
    const rows = await this.prisma.user.findMany({ take: EXPORT_LIMIT, orderBy: { createdAt: "desc" }, select: {
      id: true, displayName: true, role: true, status: true, createdAt: true,
      wallet: { select: { availableBalance: true, frozenBalance: true, availableIncome: true } },
      externalAccounts: { select: { platform: true, externalUserId: true, displayName: true } },
      companionProfile: { select: { status: true, pricePerHour: true, commissionRate: true } },
      rechargeRequests: { where: { status: ReviewStatus.APPROVED }, select: { amount: true } }
    } });
    const platform = (u: (typeof rows)[number], p: BotPlatform) => u.externalAccounts.find(a => a.platform === p);
    return toCsv(
      ["用户ID", "昵称", "角色", "状态", "可用余额", "冻结余额", "陪玩可提现收入", "累计充值", "KOOK ID", "KOOK 昵称", "Discord ID", "陪玩状态", "陪玩时薪", "抽成", "注册时间"],
      rows.map(u => [u.id, u.displayName, u.role, u.status, u.wallet?.availableBalance.toString(), u.wallet?.frozenBalance.toString(), u.wallet?.availableIncome.toString(),
        u.rechargeRequests.reduce((s, r) => s.add(r.amount), new Prisma.Decimal(0)).toFixed(2),
        platform(u, BotPlatform.KOOK)?.externalUserId, platform(u, BotPlatform.KOOK)?.displayName, platform(u, BotPlatform.DISCORD)?.externalUserId,
        u.companionProfile?.status, u.companionProfile?.pricePerHour.toString(), u.companionProfile?.commissionRate.toString(), u.createdAt.toISOString()]));
  }

  private async ordersCsv() {
    const rows = await this.prisma.order.findMany({ take: EXPORT_LIMIT, orderBy: { createdAt: "desc" }, select: {
      orderNo: true, status: true, mode: true, hours: true, totalAmount: true, refundAmount: true, serviceKind: true, isTest: true, createdAt: true,
      customer: { select: { displayName: true } }, companion: { select: { displayName: true } }
    } });
    return toCsv(["订单号", "状态", "类型", "模式", "时长", "金额", "退款", "客户", "陪玩", "测试单", "下单时间"],
      rows.map(o => [o.orderNo, o.status, o.serviceKind, o.mode, o.hours.toString(), o.totalAmount.toString(), o.refundAmount.toString(),
        o.customer.displayName, o.companion?.displayName, o.isTest ? "是" : "", o.createdAt.toISOString()]));
  }

  private async rechargesCsv() {
    const rows = await this.prisma.rechargeRequest.findMany({ take: EXPORT_LIMIT, orderBy: { createdAt: "desc" }, select: {
      id: true, amount: true, promotionBonus: true, status: true, note: true, reviewNote: true, createdAt: true, reviewedAt: true,
      customer: { select: { displayName: true } }, reviewedBy: { select: { displayName: true } }
    } });
    return toCsv(["充值ID", "客户", "金额", "赠送", "状态", "客户备注", "审核备注", "审核人", "提交时间", "审核时间"],
      rows.map(r => [r.id, r.customer.displayName, r.amount.toString(), r.promotionBonus.toString(), r.status, r.note, r.reviewNote,
        r.reviewedBy?.displayName, r.createdAt.toISOString(), r.reviewedAt?.toISOString()]));
  }
}
