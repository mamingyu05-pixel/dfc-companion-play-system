import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@dfc.local";
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    throw new Error("ADMIN_PASSWORD is required");
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: UserRole.SUPER_ADMIN, displayName: "DFC Super Admin" },
    create: {
      email,
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      displayName: "DFC Super Admin",
      wallet: { create: {} }
    }
  });

  console.log(`Admin initialized: ${email}`);
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
