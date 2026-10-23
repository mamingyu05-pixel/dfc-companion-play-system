import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { GameCode, Prisma, UserRole } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { fixedDecimal, money } from "../financial-values";
import { OrdersService } from "../orders/orders.service";
import { PrismaService } from "../prisma/prisma.service";

type PackageBody = { category?: unknown; name?: unknown; description?: unknown; price?: unknown; sortOrder?: unknown; isActive?: unknown; game?: unknown };

const text = (value: unknown, field: string, max: number, required: boolean) => {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || (required && !value.trim()) || value.trim().length > max) throw new BadRequestException(`${field}${required ? "必填，" : ""}最多 ${max} 个字`);
  return value.trim();
};

/** Validates a create (all required fields) or an edit (any subset); orders snapshot name and price, so edits never touch them. */
function packageData(body: PackageBody, creating: boolean) {
  const data: Prisma.ServicePackageUncheckedCreateInput = {} as Prisma.ServicePackageUncheckedCreateInput;
  const category = text(body.category, "分类", 32, creating);
  const name = text(body.name, "名称", 40, creating);
  if (category !== undefined) data.category = category;
  if (name !== undefined) data.name = name;
  if (body.description !== undefined) data.description = body.description === null || body.description === "" ? null : text(body.description, "说明", 200, false);
  if (body.price !== undefined || creating) {
    if (typeof body.price !== "string" && typeof body.price !== "number") throw new BadRequestException("请填写价格");
    data.price = money(fixedDecimal(String(body.price), "price", { max: "99999" }), true);
  }
  if (body.sortOrder !== undefined) {
    if (!Number.isSafeInteger(body.sortOrder)) throw new BadRequestException("排序须为整数");
    data.sortOrder = body.sortOrder as number;
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") throw new BadRequestException("上架状态不正确");
    data.isActive = body.isActive;
  }
  if (body.game !== undefined) {
    if (typeof body.game !== "string" || !(Object.values(GameCode) as string[]).includes(body.game)) throw new BadRequestException("不支持的游戏");
    data.game = body.game as GameCode;
  }
  return data;
}

@Controller("admin/service-packages")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class ServicePackagesController {
  constructor(private readonly prisma: PrismaService, private readonly orders: OrdersService) {}

  @Get()
  list() {
    return this.orders.listServicePackages(true);
  }

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() body: PackageBody) {
    const data = packageData(body ?? {}, true);
    return this.prisma.$transaction(async tx => {
      const row = await tx.servicePackage.create({ data });
      await tx.adminLog.create({ data: { actorId: user.id, action: "CREATE_SERVICE_PACKAGE", entityType: "SERVICE_PACKAGE", entityId: row.id,
        detail: { category: row.category, name: row.name, price: row.price.toFixed(2), isActive: row.isActive } } });
      return { id: row.id };
    });
  }

  @Patch(":id")
  async update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: PackageBody) {
    const data = packageData(body ?? {}, false);
    if (!Object.keys(data).length) throw new BadRequestException("没有需要修改的内容");
    return this.prisma.$transaction(async tx => {
      const before = await tx.servicePackage.findUnique({ where: { id } });
      if (!before) throw new NotFoundException("套餐不存在");
      const row = await tx.servicePackage.update({ where: { id }, data });
      await tx.adminLog.create({ data: { actorId: user.id, action: "UPDATE_SERVICE_PACKAGE", entityType: "SERVICE_PACKAGE", entityId: id,
        detail: { before: { name: before.name, price: before.price.toFixed(2), isActive: before.isActive },
          after: { name: row.name, price: row.price.toFixed(2), isActive: row.isActive } } } });
      return { id: row.id };
    });
  }
}
