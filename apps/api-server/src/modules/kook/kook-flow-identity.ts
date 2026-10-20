import { BadRequestException } from "@nestjs/common";
import { BotPlatform, Prisma, UserRole, UserStatus } from "@prisma/client";

export async function requireKookActor(tx: Prisma.TransactionClient, platformUserId: string, userId?: string, role?: UserRole, expiresAt?: number, lockForAcceptance = false) {
  // Re-check inside the mutation transaction. A moved/deleted binding cannot act
  // on a previous account's card, wallet or order. Lock until commit.
  await tx.$queryRaw`SELECT "id" FROM "user_external_accounts" WHERE "platform" = 'KOOK' AND "externalUserId" = ${platformUserId} FOR SHARE`;
  if (role === UserRole.COMPANION && lockForAcceptance) {
    // Only acceptance needs the exclusive companion lock, after the order lock.
    // Other actions retain SHARE, compatible with wallet-ledger FK checks, so
    // two claims cannot both hold SHARE and deadlock while upgrading it later.
    await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" IN (SELECT "userId" FROM "user_external_accounts" WHERE "platform" = 'KOOK' AND "externalUserId" = ${platformUserId}) FOR UPDATE`;
  } else {
    await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" IN (SELECT "userId" FROM "user_external_accounts" WHERE "platform" = 'KOOK' AND "externalUserId" = ${platformUserId}) FOR SHARE`;
  }
  const account = await tx.userExternalAccount.findUnique({ where: { platform_externalUserId: { platform: BotPlatform.KOOK, externalUserId: platformUserId } }, include: { user: true } });
  if (!account || account.user.status !== UserStatus.ACTIVE || (userId && account.userId !== userId) || (role && account.user.role !== role)) {
    throw new BadRequestException("账号绑定或权限已变化，请重新打开本人工作台。未绑定账号请先完成绑定引导。");
  }
  if (expiresAt !== undefined && Date.now() >= expiresAt) throw new BadRequestException("按钮已过期，请刷新本人订单后再操作。");
  return account.user;
}
