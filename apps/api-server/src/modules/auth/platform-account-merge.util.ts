import { BadRequestException } from "@nestjs/common";
import { BotPlatform, Prisma, UserRole, UserStatus } from "@prisma/client";
import { normalizeDisplayNameKey } from "./display-name.util";

type MigrationArgs = {
  tx: Prisma.TransactionClient;
  platform: BotPlatform;
  externalUserId: string;
  targetUserId: string;
  displayName?: string | null;
};

type MigratedExternalAccount = {
  id: string;
  platform: BotPlatform;
  externalUserId: string;
  displayName: string | null;
};

export async function migrateSafePlatformPlaceholderAccount(args: MigrationArgs): Promise<{
  migrated: boolean;
  account?: MigratedExternalAccount;
  previousUserId?: string;
}> {
  const existingExternal = await args.tx.userExternalAccount.findUnique({
    where: {
      platform_externalUserId: {
        platform: args.platform,
        externalUserId: args.externalUserId
      }
    },
    select: { userId: true }
  });

  if (!existingExternal || existingExternal.userId === args.targetUserId) {
    return { migrated: false };
  }

  const blockers = await getPlatformPlaceholderMergeBlockers(args.tx, {
    sourceUserId: existingExternal.userId,
    platform: args.platform,
    externalUserId: args.externalUserId
  });
  if (blockers.length) {
    throw new BadRequestException(`平台账号已绑定到另一个有数据的账号，不能自动合并：${blockers.join("、")}`);
  }

  const targetPlatformAccount = await args.tx.userExternalAccount.findUnique({
    where: {
      userId_platform: {
        userId: args.targetUserId,
        platform: args.platform
      }
    },
    select: { externalUserId: true }
  });
  if (targetPlatformAccount && targetPlatformAccount.externalUserId !== args.externalUserId) {
    await args.tx.userExternalAccount.delete({
      where: {
        userId_platform: {
          userId: args.targetUserId,
          platform: args.platform
        }
      }
    });
  }

  await args.tx.aiSupportConversation.updateMany({
    where: { userId: existingExternal.userId },
    data: { userId: args.targetUserId }
  });
  await args.tx.botEvent.updateMany({
    where: { actorId: existingExternal.userId },
    data: { actorId: args.targetUserId }
  });
  await args.tx.orderDraftEvent.updateMany({
    where: { actorUserId: existingExternal.userId },
    data: { actorUserId: args.targetUserId }
  });

  const account = await args.tx.userExternalAccount.update({
    where: {
      platform_externalUserId: {
        platform: args.platform,
        externalUserId: args.externalUserId
      }
    },
    data: {
      userId: args.targetUserId,
      displayName: sanitizePlatformDisplayName(args.displayName)
    },
    select: { id: true, platform: true, externalUserId: true, displayName: true }
  });

  await args.tx.platformBindingCode.updateMany({
    where: { userId: existingExternal.userId, platform: args.platform, consumedAt: null },
    data: { consumedAt: new Date() }
  });

  const mergedDisplayName = `Merged platform placeholder ${args.platform}-${args.externalUserId}`;
  await args.tx.user.update({
    where: { id: existingExternal.userId },
    data: {
      status: UserStatus.BANNED,
      displayName: mergedDisplayName,
      displayNameKey: normalizeDisplayNameKey(`merged-platform-placeholder-${existingExternal.userId}`)
    }
  });

  return { migrated: true, account, previousUserId: existingExternal.userId };
}

async function getPlatformPlaceholderMergeBlockers(
  tx: Prisma.TransactionClient,
  input: { sourceUserId: string; platform: BotPlatform; externalUserId: string }
) {
  const blockers: string[] = [];
  const source = await tx.user.findUnique({
    where: { id: input.sourceUserId },
    include: {
      wallet: true,
      companionProfile: true,
      externalAccounts: true
    }
  });

  if (!source) return ["原账号不存在"];
  if (source.role !== UserRole.CUSTOMER) blockers.push("原账号不是普通客户");
  if (!isAutoPlatformPlaceholderEmail(source.email, input.platform, input.externalUserId)) blockers.push("原账号不是系统占位号");
  if (source.companionProfile) blockers.push("原账号已有陪玩资料");
  if (source.externalAccounts.some((account) => account.platform !== input.platform)) blockers.push("原账号绑定了其他平台");
  if (source.wallet && !isZeroWallet(source.wallet)) blockers.push("原账号钱包不为空");

  const [
    orderCount,
    draftCount,
    draftCandidateCount,
    rechargeCount,
    withdrawalCount,
    walletTransactionCount,
    complaintCount,
    referralCount,
    adminLogCount,
    promotionCount,
    platformSettingCount
  ] = await Promise.all([
    tx.order.count({
      where: {
        OR: [{ customerId: input.sourceUserId }, { companionId: input.sourceUserId }, { assignedById: input.sourceUserId }]
      }
    }),
    tx.orderDraft.count({
      where: {
        OR: [
          { customerId: input.sourceUserId },
          { serviceAdminId: input.sourceUserId },
          { selectedCompanionId: input.sourceUserId },
          { convertedById: input.sourceUserId }
        ]
      }
    }),
    tx.orderDraftCandidate.count({
      where: {
        OR: [{ companionId: input.sourceUserId }, { recommendedById: input.sourceUserId }]
      }
    }),
    tx.rechargeRequest.count({
      where: {
        OR: [{ customerId: input.sourceUserId }, { reviewedById: input.sourceUserId }]
      }
    }),
    tx.withdrawalRequest.count({
      where: {
        OR: [{ companionId: input.sourceUserId }, { reviewedById: input.sourceUserId }]
      }
    }),
    tx.walletTransaction.count({
      where: {
        OR: [{ userId: input.sourceUserId }, { operatorId: input.sourceUserId }]
      }
    }),
    tx.complaint.count({
      where: {
        OR: [{ reporterId: input.sourceUserId }, { resolvedById: input.sourceUserId }]
      }
    }),
    tx.userReferral.count({
      where: {
        OR: [{ referrerId: input.sourceUserId }, { referredUserId: input.sourceUserId }]
      }
    }),
    tx.adminLog.count({
      where: {
        OR: [{ actorId: input.sourceUserId }, { targetUserId: input.sourceUserId }]
      }
    }),
    tx.promotionCode.count({ where: { createdById: input.sourceUserId } }),
    tx.platformSetting.count({ where: { updatedById: input.sourceUserId } })
  ]);

  if (orderCount) blockers.push("原账号已有订单");
  if (draftCount || draftCandidateCount) blockers.push("原账号已有派单草稿");
  if (rechargeCount) blockers.push("原账号已有充值记录");
  if (withdrawalCount) blockers.push("原账号已有提现记录");
  if (walletTransactionCount) blockers.push("原账号已有钱包流水");
  if (complaintCount) blockers.push("原账号已有投诉记录");
  if (referralCount) blockers.push("原账号已有邀请关系");
  if (adminLogCount) blockers.push("原账号已有后台操作记录");
  if (promotionCount || platformSettingCount) blockers.push("原账号已有运营配置记录");

  return blockers;
}

function isAutoPlatformPlaceholderEmail(email: string, platform: BotPlatform, externalUserId: string) {
  return email.toLowerCase() === `customer-${platform.toLowerCase()}-${externalUserId}@platform.maycatplay.local`;
}

function isZeroWallet(wallet: {
  availableBalance: Prisma.Decimal;
  frozenBalance: Prisma.Decimal;
  availableIncome: Prisma.Decimal;
  pendingIncome: Prisma.Decimal;
  frozenIncome: Prisma.Decimal;
}) {
  return [wallet.availableBalance, wallet.frozenBalance, wallet.availableIncome, wallet.pendingIncome, wallet.frozenIncome].every((value) => value.eq(0));
}

function sanitizePlatformDisplayName(displayName?: string | null) {
  const normalized = displayName?.normalize("NFKC").trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, 64) : undefined;
}
