import { BadRequestException, Injectable } from "@nestjs/common";
import { BotPlatform, UserStatus } from "@prisma/client";
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

    const account = await this.prisma.userExternalAccount.upsert({
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
    });

    if (actorId) {
      await this.prisma.adminLog.create({
        data: {
          actorId,
          targetUserId: companionId,
          action: "BIND_COMPANION_EXTERNAL_ACCOUNT",
          entityType: "USER_EXTERNAL_ACCOUNT",
          entityId: account.id,
          detail: { platform, externalUserId, displayName }
        }
      });
    }

    return account;
  }
}
