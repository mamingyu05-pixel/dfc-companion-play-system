import { randomUUID } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { BotPlatform, Prisma } from "@prisma/client";
import { AuthService } from "../src/modules/auth/auth.service";
import { PrismaService } from "../src/modules/prisma/prisma.service";

const prisma = new PrismaService();
const auth = new AuthService(prisma, {} as JwtService);

type Hooks = {
  afterRead?: (tx: Prisma.TransactionClient, row: any) => Promise<void>;
  beforeClaim?: (tx: Prisma.TransactionClient, args: any) => Promise<void>;
  beforeAccountWrite?: (tx: Prisma.TransactionClient, args: any) => Promise<void>;
};

// Hooks schedule real database calls; no query, result, lock, or transaction is mocked.
function instrumentedAuth(hooks: Hooks) {
  const client = new Proxy(prisma, {
    get(target, property, receiver) {
      if (property === "$transaction") {
        return (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          target.$transaction(async (tx) => {
            const transaction = new Proxy(tx, {
              get(transactionTarget, member) {
                if (member === "platformBindingCode") {
                  return new Proxy(tx.platformBindingCode, {
                    get(delegate, method) {
                      if (method === "findUnique") return async (args: any) => {
                        const row = await delegate.findUnique(args);
                        await hooks.afterRead?.(tx, row);
                        return row;
                      };
                      if (method === "updateMany") return async (args: any) => {
                        await hooks.beforeClaim?.(tx, args);
                        return delegate.updateMany(args);
                      };
                      const value = Reflect.get(delegate, method);
                      return typeof value === "function" ? value.bind(delegate) : value;
                    },
                  });
                }
                if (member === "userExternalAccount") {
                  return new Proxy(tx.userExternalAccount, {
                    get(delegate, method) {
                      if (method === "upsert") return async (args: any) => {
                        await hooks.beforeAccountWrite?.(tx, args);
                        return delegate.upsert(args);
                      };
                      const value = Reflect.get(delegate, method);
                      return typeof value === "function" ? value.bind(delegate) : value;
                    },
                  });
                }
                const value = Reflect.get(transactionTarget, member);
                return typeof value === "function" ? value.bind(transactionTarget) : value;
              },
            });
            return work(transaction);
          }, { maxWait: 10000, timeout: 15000 });
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new AuthService(client, {} as JwtService);
}

function twoReaders() {
  let count = 0;
  let release!: () => void;
  let reject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, fail) => { release = resolve; reject = fail; });
  const timeout = setTimeout(() => reject(new Error("Both PostgreSQL readers did not arrive")), 5000);
  return {
    wait: async () => {
      if (++count === 2) { clearTimeout(timeout); release(); }
      await ready;
    },
    dispose: () => clearTimeout(timeout),
    count: () => count,
  };
}

async function customer() {
  const id = randomUUID();
  return prisma.user.create({
    data: { email: id + "@synthetic.invalid", displayName: id, displayNameKey: id, passwordHash: "synthetic", role: "CUSTOMER" },
  });
}

async function bindingFixture(withExistingIdentity = false) {
  const user = await customer();
  const generated = await auth.createPlatformBindingCode(user.id, { platform: BotPlatform.KOOK });
  const row = await prisma.platformBindingCode.findFirstOrThrow({ where: { userId: user.id, platform: BotPlatform.KOOK } });
  const previousIdentity = "synthetic-old-" + randomUUID();
  if (withExistingIdentity) await prisma.userExternalAccount.create({
    data: { userId: user.id, platform: BotPlatform.KOOK, externalUserId: previousIdentity, displayName: "synthetic old" },
  });
  return { user, code: generated.code, row, previousIdentity };
}

async function identity(userId: string) {
  return prisma.userExternalAccount.findUnique({ where: { userId_platform: { userId, platform: BotPlatform.KOOK } } });
}

function evidence(name: string, facts: Record<string, unknown>) {
  console.info("BINDING_PG_EVIDENCE " + JSON.stringify({ name, ...facts }));
}

beforeAll(async () => {
  expect(process.env.DFC_TEST_MODE).toBe("1");
  expect(process.env.DFC_BACKGROUND_JOBS_ENABLED).toBe("false");
  await prisma.$connect();
});
afterAll(async () => { await prisma.$disconnect(); });

test("binding PG: normal binding persists one identity and consumes the code", async () => {
  const f = await bindingFixture();
  const externalUserId = "synthetic-normal-" + randomUUID();
  const result = await auth.consumePlatformBindingCode(BotPlatform.KOOK, { code: f.code, externalUserId });
  expect(result.externalAccount.externalUserId).toBe(externalUserId);
  expect((await identity(f.user.id))?.externalUserId).toBe(externalUserId);
  expect(await prisma.userExternalAccount.count({ where: { userId: f.user.id } })).toBe(1);
  expect((await prisma.platformBindingCode.findUniqueOrThrow({ where: { id: f.row.id } })).consumedAt).not.toBeNull();
  evidence("normal", { identities: 1, consumed: true });
});

test("binding PG: consumed-code replay cannot replace the successful identity", async () => {
  const f = await bindingFixture();
  const first = "synthetic-first-" + randomUUID();
  const second = "synthetic-replay-" + randomUUID();
  await auth.consumePlatformBindingCode(BotPlatform.KOOK, { code: f.code, externalUserId: first });
  const consumed = await prisma.platformBindingCode.findUniqueOrThrow({ where: { id: f.row.id } });
  await expect(auth.consumePlatformBindingCode(BotPlatform.KOOK, { code: f.code, externalUserId: second })).rejects.toBeInstanceOf(BadRequestException);
  expect((await identity(f.user.id))?.externalUserId).toBe(first);
  expect(await prisma.userExternalAccount.count({ where: { platform: BotPlatform.KOOK, externalUserId: second } })).toBe(0);
  expect((await prisma.platformBindingCode.findUniqueOrThrow({ where: { id: f.row.id } })).consumedAt).toEqual(consumed.consumedAt);
  evidence("replay", { rejected: true, identityUnchanged: true, rejectedIdentityRows: 0 });
});

test("binding PG: two real transactions reading the same unused code yield one winner and no loser identity", async () => {
  const f = await bindingFixture(true);
  const gate = twoReaders();
  const backends = new Set<number>();
  const contenderIds = ["synthetic-race-a-" + randomUUID(), "synthetic-race-b-" + randomUUID()];
  const concurrent = instrumentedAuth({
    afterRead: async (tx, row) => {
      expect(row.id).toBe(f.row.id);
      expect(row.consumedAt).toBeNull();
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      backends.add(backend.pid);
      await gate.wait();
    },
  });
  let outcomes: PromiseSettledResult<any>[];
  try {
    outcomes = await Promise.allSettled(contenderIds.map(externalUserId =>
      concurrent.consumePlatformBindingCode(BotPlatform.KOOK, { code: f.code, externalUserId })));
  } finally { gate.dispose(); }
  expect(gate.count()).toBe(2);
  expect(backends.size).toBe(2);
  expect(outcomes.filter(x => x.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter(x => x.status === "rejected")).toHaveLength(1);
  const winner = outcomes.findIndex(x => x.status === "fulfilled");
  const loser = 1 - winner;
  const rejected = outcomes[loser] as PromiseRejectedResult;
  expect(rejected.reason).toBeInstanceOf(BadRequestException);
  expect((await identity(f.user.id))?.externalUserId).toBe(contenderIds[winner]);
  expect(await prisma.userExternalAccount.count({ where: { userId: f.user.id } })).toBe(1);
  expect(await prisma.userExternalAccount.count({ where: { platform: BotPlatform.KOOK, externalUserId: contenderIds[loser] } })).toBe(0);
  expect((await prisma.platformBindingCode.findUniqueOrThrow({ where: { id: f.row.id } })).consumedAt).not.toBeNull();
  evidence("concurrent", { postgresBackends: backends.size, unusedReadsBeforeClaim: gate.count(), succeeded: 1, rejected: 1, identities: 1, loserIdentityRows: 0 });
});

test("binding PG: a code expiring in real time after the SELECT cannot change identity", async () => {
  const f = await bindingFixture(true);
  await prisma.platformBindingCode.update({ where: { id: f.row.id }, data: { expiresAt: new Date(Date.now() + 1000) } });
  let readWhileValid = false;
  const delayed = instrumentedAuth({
    afterRead: async (_tx, row) => {
      readWhileValid = row.expiresAt.getTime() > Date.now();
      expect(readWhileValid).toBe(true);
      await new Promise(resolve => setTimeout(resolve, Math.max(0, row.expiresAt.getTime() - Date.now()) + 50));
    },
  });
  await expect(delayed.consumePlatformBindingCode(BotPlatform.KOOK, { code: f.code, externalUserId: "synthetic-late-" + randomUUID() })).rejects.toBeInstanceOf(BadRequestException);
  expect((await identity(f.user.id))?.externalUserId).toBe(f.previousIdentity);
  expect((await prisma.platformBindingCode.findUniqueOrThrow({ where: { id: f.row.id } })).consumedAt).toBeNull();
  evidence("expires-after-read", { readWhileValid, expiredAtContinuation: true, rejected: true, consumed: false, identityUnchanged: true });
});

test("binding PG: expiry shortened by a committed transaction after validation is rechecked when claiming", async () => {
  const f = await bindingFixture(true);
  let changedAfterRead = false;
  const changed = instrumentedAuth({
    beforeClaim: async () => {
      await prisma.platformBindingCode.update({ where: { id: f.row.id }, data: { expiresAt: new Date(0) } });
      changedAfterRead = true;
    },
  });
  await expect(changed.consumePlatformBindingCode(BotPlatform.KOOK, { code: f.code, externalUserId: "synthetic-expired-" + randomUUID() })).rejects.toBeInstanceOf(BadRequestException);
  expect(changedAfterRead).toBe(true);
  expect((await identity(f.user.id))?.externalUserId).toBe(f.previousIdentity);
  expect((await prisma.platformBindingCode.findUniqueOrThrow({ where: { id: f.row.id } })).consumedAt).toBeNull();
  evidence("expiry-at-claim", { changedAfterRead, rejected: true, consumed: false, identityUnchanged: true });
});

test("binding PG: a real identity unique-constraint error rolls back consumption and allows a clean retry", async () => {
  const f = await bindingFixture(true);
  const competitor = await customer();
  const externalUserId = "synthetic-constraint-" + randomUUID();
  let claimedInsideTransaction = false;
  let competingAccountId: string | undefined;
  const failing = instrumentedAuth({
    beforeAccountWrite: async tx => {
      const claimed = await tx.platformBindingCode.findUniqueOrThrow({ where: { id: f.row.id } });
      claimedInsideTransaction = claimed.consumedAt !== null;
      expect(claimedInsideTransaction).toBe(true);
      const competing = await prisma.userExternalAccount.create({
        data: { userId: competitor.id, platform: BotPlatform.KOOK, externalUserId },
      });
      competingAccountId = competing.id;
    },
  });
  await expect(failing.consumePlatformBindingCode(BotPlatform.KOOK, { code: f.code, externalUserId })).rejects.toMatchObject({ code: "P2002" });
  expect(claimedInsideTransaction).toBe(true);
  expect((await prisma.platformBindingCode.findUniqueOrThrow({ where: { id: f.row.id } })).consumedAt).toBeNull();
  expect((await identity(f.user.id))?.externalUserId).toBe(f.previousIdentity);
  expect(competingAccountId).toBeDefined();
  await prisma.userExternalAccount.delete({ where: { id: competingAccountId! } });
  await auth.consumePlatformBindingCode(BotPlatform.KOOK, { code: f.code, externalUserId });
  expect((await identity(f.user.id))?.externalUserId).toBe(externalUserId);
  expect((await prisma.platformBindingCode.findUniqueOrThrow({ where: { id: f.row.id } })).consumedAt).not.toBeNull();
  evidence("rollback", { claimedBeforeWrite: true, actualDatabaseError: "P2002", consumptionRolledBack: true, priorIdentityPreserved: true, cleanRetrySucceeded: true });
});
