import { PrismaClient, Prisma, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

// Demo-only accounts with a shared simple password. Never run against a production database with real users.
// Idempotent: reruns reset the demo passwords and only top up balances that were never seeded.
const prisma = new PrismaClient();
const PASSWORD = process.env.DEMO_PASSWORD ?? "demo1234";
const DOMAIN = process.env.DEMO_EMAIL_DOMAIN ?? "xxdz.site";

type Demo = {
  email: string;
  name: string;
  role: UserRole;
  balance?: string;
  companion?: { rank: "GOLD" | "DIAMOND" | "TOP"; price: string; voice: "REQUIRED" | "OPTIONAL"; bio: string; modes: string[] };
};

const accounts: Demo[] = [
  { email: `kehu@${DOMAIN}`, name: "演示客户", role: UserRole.CUSTOMER, balance: "2000" },
  { email: `kehu2@${DOMAIN}`, name: "演示客户2", role: UserRole.CUSTOMER, balance: "500" },
  { email: `peiwan@${DOMAIN}`, name: "演示陪玩·小猫", role: UserRole.COMPANION,
    companion: { rank: "DIAMOND", price: "98", voice: "OPTIONAL", bio: "三角洲烽火钻石，稳健报点，擅长带新人摸金。", modes: ["烽火地带", "保底护航"] } },
  { email: `peiwan2@${DOMAIN}`, name: "演示陪玩·夜枭", role: UserRole.COMPANION,
    companion: { rank: "TOP", price: "128", voice: "REQUIRED", bio: "全面战场高分段，语音指挥，节奏快。", modes: ["全面战场", "烽火地带"] } },
  { email: `guanli@${DOMAIN}`, name: "演示管理员", role: UserRole.ADMIN }
];

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  for (const a of accounts) {
    const key = a.name.toLowerCase();
    const user = await prisma.user.upsert({
      where: { email: a.email },
      update: { passwordHash, status: "ACTIVE" },
      create: { email: a.email, passwordHash, role: a.role, displayName: a.name, displayNameKey: key, wallet: { create: {} } }
    });
    if (a.companion) {
      const c = a.companion;
      await prisma.companionProfile.upsert({
        where: { userId: user.id },
        update: { status: "LISTED", onlineStatus: "ONLINE" },
        create: { userId: user.id, nickname: a.name.replace("演示陪玩·", ""), games: ["DELTA_FORCE"], deltaForceRank: c.rank,
          skillModes: c.modes, pricePerHour: c.price, commissionRate: "0.2", voicePreference: c.voice, bio: c.bio,
          status: "LISTED", onlineStatus: "ONLINE" }
      });
    }
    if (a.balance) await seedBalance(user.id, a.balance);
    console.log(`demo account ready: ${a.email} (${a.role})`);
  }
}

// Balance enters through an approved recharge with its ledger entry, so demo wallets reconcile like real ones.
async function seedBalance(userId: string, amount: string) {
  const businessKey = `demo-seed-recharge:${userId}`;
  if (await prisma.walletTransaction.findUnique({ where: { businessKey } })) return;
  await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.update({ where: { userId }, data: { availableBalance: { increment: new Prisma.Decimal(amount) } } });
    const request = await tx.rechargeRequest.create({ data: { customerId: userId, amount, screenshotUrl: "", note: "演示账户初始余额",
      status: "APPROVED", reviewedAt: new Date(), reviewNote: "演示数据" } });
    await tx.walletTransaction.create({ data: { businessKey, walletId: wallet.id, userId, type: "RECHARGE_APPROVED", direction: "CREDIT",
      amount, balanceAfter: wallet.availableBalance, referenceType: "RECHARGE_REQUEST", referenceId: request.id, note: "演示账户初始余额" } });
  });
}

main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
