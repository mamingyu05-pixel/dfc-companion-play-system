import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { PrismaService } from "../prisma/prisma.service";
import { PlatformSupportService } from "./platform-support.service";

type KnowledgeBody = { title?: unknown; content?: unknown; keywords?: unknown; isActive?: unknown };

function parseKnowledge(body: KnowledgeBody, partial: boolean) {
  if (!body || typeof body !== "object") throw new BadRequestException("内容无效");
  const data: { title?: string; content?: string; keywords?: string[]; isActive?: boolean } = {};
  if (body.title !== undefined || !partial) {
    if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 80) throw new BadRequestException("标题必填，最多80字");
    data.title = body.title.trim();
  }
  if (body.content !== undefined || !partial) {
    if (typeof body.content !== "string" || !body.content.trim() || body.content.trim().length > 1200) throw new BadRequestException("内容必填，最多1200字");
    data.content = body.content.trim();
  }
  if (body.keywords !== undefined) {
    if (!Array.isArray(body.keywords) || body.keywords.length > 30 || !body.keywords.every(k => typeof k === "string" && k.trim().length <= 20))
      throw new BadRequestException("关键词最多30个，每个最多20字");
    data.keywords = [...new Set((body.keywords as string[]).map(k => k.trim()).filter(Boolean))];
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") throw new BadRequestException("isActive must be boolean");
    data.isActive = body.isActive;
  }
  if (partial && !Object.keys(data).length) throw new BadRequestException("没有需要修改的内容");
  return data;
}

@Controller("admin/support-knowledge")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class SupportKnowledgeController {
  constructor(private readonly prisma: PrismaService, private readonly support: PlatformSupportService) {}

  @Get()
  list() {
    return this.prisma.supportKnowledge.findMany({ orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }], take: 500 });
  }

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() body: KnowledgeBody) {
    const data = parseKnowledge(body, false);
    const created = await this.prisma.$transaction(async tx => {
      const row = await tx.supportKnowledge.create({ data: { title: data.title!, content: data.content!, keywords: data.keywords ?? [], isActive: data.isActive ?? true } });
      await tx.adminLog.create({ data: { actorId: user.id, action: "CREATE_SUPPORT_KNOWLEDGE", entityType: "SUPPORT_KNOWLEDGE", entityId: row.id, detail: { title: row.title } } });
      return row;
    });
    this.support.invalidateKnowledgeCache();
    return created;
  }

  @Patch(":id")
  async update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: KnowledgeBody) {
    const data = parseKnowledge(body, true);
    const updated = await this.prisma.$transaction(async tx => {
      if (!(await tx.supportKnowledge.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException("知识条目不存在");
      const row = await tx.supportKnowledge.update({ where: { id }, data });
      await tx.adminLog.create({ data: { actorId: user.id, action: "UPDATE_SUPPORT_KNOWLEDGE", entityType: "SUPPORT_KNOWLEDGE", entityId: id, detail: { fields: Object.keys(data) } } });
      return row;
    });
    this.support.invalidateKnowledgeCache();
    return updated;
  }
}
