import { BadRequestException, Injectable } from "@nestjs/common";
import { BotPlatform, UserStatus } from "@prisma/client";
import { migrateSafePlatformPlaceholderAccount } from "../auth/platform-account-merge.util";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class CompanionExternalAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async bindCompanionAccount(
    companionId: string,
    platform: BotPlatform,
    externalUserId: string,
    displayName?: string,
    actorId?: string
  ) {
    const companion = await this.prisma.user.findFirst({
      where: { id: companionId, status: UserStatus.ACTIVE, companionProfile: { isNot: null } }
    });

    if (!companion) throw new BadRequestException("Companion does not exist");

    const account = await this.prisma.$transaction(async (tx) => {
      const migrated = await migrateSafePlatformPlaceholderAccount({
        tx,
        platform,
        externalUserId,
        targetUserId: companionId,
        displayName
      });

      const saved = migrated.account ?? (await tx.userExternalAccount.upsert({
        where: {
          userId_platform: {
            userId: companionId,
            platform
          }
        },
        update: { externalUserId, displayName },
        create: {
          userId: companionId,
          platform,
          externalUserId,
          displayName
        }
      }));

      if (actorId) {
        await tx.adminLog.create({
          data: {
            actorId,
            targetUserId: companionId,
            action: migrated.migrated ? "MERGE_PLATFORM_PLACEHOLDER_AND_BIND_COMPANION" : "BIND_COMPANION_EXTERNAL_ACCOUNT",
            entityType: "USER_EXTERNAL_ACCOUNT",
            entityId: saved.id,
            detail: { platform, externalUserId, displayName, mergedPlaceholderUserId: migrated.previousUserId }
          }
        });
      }

      return saved;
    });

    return account;
  }
}
