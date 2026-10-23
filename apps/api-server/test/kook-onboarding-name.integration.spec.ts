import { randomInt, randomUUID } from "node:crypto";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { createConfirmedKookCustomer } from "../src/modules/kook/kook-customer-onboarding";

const prisma = new PrismaService();
beforeAll(() => prisma.$connect());
afterAll(() => prisma.$disconnect());
const kookId = () => String(randomInt(10 ** 9, 2 ** 47));
const create = (id: string, nickname?: string) => prisma.$transaction(tx => createConfirmedKookCustomer(tx, id, Date.now() + 60_000, nickname));
const nameOf = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).displayName;

test("首次使用 names the profile after the KOOK nickname, adds the ID tail on a clash, and falls back when unknown", async () => {
  const nick = `阿强${randomUUID().slice(0, 6)}`;
  const first = await create(kookId(), `  ${nick}\n`);
  expect(await nameOf(first.userId)).toBe(nick);

  const secondId = kookId();
  const second = await create(secondId, nick);
  expect(await nameOf(second.userId)).toBe(`${nick}#${secondId.slice(-4)}`);

  const anonymous = await create(kookId());
  expect(await nameOf(anonymous.userId)).toMatch(/^KOOK客户-[0-9a-f]{20}$/);
});
