import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { ImportRequest, KookMemberImportService } from "./kook-member-import.service";

@Controller("admin/kook-members")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class KookMemberImportController {
  constructor(private readonly imports: KookMemberImportService) {}

  // POST so the role selection travels in the body; this only reads KOOK and the database.
  @Post("preview")
  preview(@Body() body: { companionRoleIds?: unknown; staffRoleIds?: unknown; refresh?: unknown }) {
    return this.imports.preview(body ?? {}, body?.refresh === true);
  }

  @Post("import")
  import(@CurrentUser() user: AuthenticatedUser, @Body() body: ImportRequest) {
    return this.imports.importBatch(user.id, body ?? {});
  }
}
