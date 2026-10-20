import { BadRequestException } from "@nestjs/common";
import { BotPlatform, Prisma, UserRole } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import { createPasswordHash } from "../auth/password.util";
import { normalizeDisplayNameKey } from "../auth/display-name.util";
import { flowCard } from "./kook-flow-card";
import { requireKookActor } from "./kook-flow-identity";

export function kookOnboardingCard() {
  const expires = Math.floor(Date.now() / 1000) + 900;
  const nonce = randomUUID();
  return flowCard("DFC 首次使用引导", [
    "已有网页账号：选择绑定原账号，保留原来的余额和订单。",
    "第一次使用：由你确认建立客户档案，昵称自动生成；以后可直接在 KOOK 下单。",
    "建档只关联当前 KOOK 身份，初始余额为零，不会充值、下单或获得陪玩/管理员权限。"
  ], [
    { label: "已有账号，查看绑定步骤", value: `dfc.onboard.bind.${expires}.${nonce}` },
    { label: "首次使用，确认建立客户档案", value: `dfc.onboard.create.${expires}.${nonce}`, primary: true }
  ]);
}

export function parseKookOnboardingAction(value: string) {
  const match = /^dfc\.onboard\.(create|bind)\.(\d{10})\.([a-f0-9-]{36})$/.exec(value);
  return match ? { action: match[1], expiresAt: Number(match[2]) * 1000 } : null;
}

// Called only after checking the exact private card, recipient and button value.
// No transport, role grants, account merging, orders or balance transactions here.
export async function createConfirmedKookCustomer(tx: Prisma.TransactionClient, platformUserId: string, expiresAt: number) {
  if (!/^\d{6,32}$/.test(platformUserId)) throw new BadRequestException("KOOK 身份无效，请重新打开本人私聊。");
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) throw new BadRequestException("建档确认已过期，请重新发送“首次使用”。");
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`kook-customer-onboarding:${platformUserId}`}, 0))::text`;
  const existing = await tx.userExternalAccount.findUnique({
    where: { platform_externalUserId: { platform: BotPlatform.KOOK, externalUserId: platformUserId } }
  });
  if (existing) {
    const user = await requireKookActor(tx, platformUserId, existing.userId, UserRole.CUSTOMER, expiresAt);
    return { userId: user.id, created: false };
  }
  // Reuse the existing platform-placeholder convention, including its later
  // binding safeguards. An orphaned/reserved address must not be reattached.
  const email = `customer-kook-${platformUserId}@platform.maycatplay.local`;
  if (await tx.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new BadRequestException("已有客户档案需要管理员核对，不能重复建档或自动合并。");
  }
  const displayName = `KOOK客户-${randomBytes(10).toString("hex")}`;
  const passwordHash = await createPasswordHash(randomBytes(32).toString("hex"));
  if (Date.now() >= expiresAt) throw new BadRequestException("建档确认已过期，请重新发送“首次使用”。");
  const user = await tx.user.create({ data: {
    email, passwordHash, role: UserRole.CUSTOMER, displayName,
    displayNameKey: normalizeDisplayNameKey(displayName), referralCode: `C${randomBytes(12).toString("hex").toUpperCase()}`
  } });
  await tx.wallet.create({ data: { userId: user.id } });
  await tx.userExternalAccount.create({ data: {
    userId: user.id, platform: BotPlatform.KOOK, externalUserId: platformUserId
  } });
  return { userId: user.id, created: true };
}
