#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, randomInt } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { BotPlatform, PrismaClient, UserRole, UserStatus } = require("@prisma/client");

const KOOK_API_BASE_URL = "https://www.kookapp.cn";
const prisma = new PrismaClient();

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

async function main() {
  const env = { ...loadEnv(path.resolve(process.cwd(), ".env")), ...process.env };
  const token = env.KOOK_TOKEN;
  const guildId = env.KOOK_GUILD_ID || process.argv[2];
  const shouldDeactivateInvalid = process.argv.includes("--deactivate-invalid-placeholders");

  if (!token) throw new Error("KOOK_TOKEN is missing in .env");
  if (!guildId) throw new Error("KOOK_GUILD_ID is missing in .env. You can also pass it as the first argument.");

  const members = await listGuildMembers(token, guildId);
  const realMembers = members.filter((member) => isRealKookUserId(member.id) && !member.bot);

  console.log(`KOOK guild: ${guildId}`);
  console.log(`Fetched members: ${members.length}, syncable users: ${realMembers.length}`);

  let created = 0;
  let updated = 0;
  for (const member of realMembers) {
    const result = await upsertKookCustomer(member);
    if (result === "created") created += 1;
    if (result === "updated") updated += 1;
  }

  console.log(`Synced KOOK customers. created=${created}, updated=${updated}`);

  if (shouldDeactivateInvalid) {
    const deactivated = await deactivateInvalidKookPlaceholders();
    console.log(`Deactivated invalid KOOK placeholders: ${deactivated}`);
  } else {
    const invalidCount = await countInvalidKookPlaceholders();
    if (invalidCount > 0) {
      console.log(`Invalid old KOOK placeholders still active: ${invalidCount}`);
      console.log("Run again with --deactivate-invalid-placeholders to ban empty legacy rows such as externalUserId=1.");
    }
  }
}

async function upsertKookCustomer(member) {
  const externalUserId = member.id;
  const displayName = formatKookDisplayName(member);
  const existing = await prisma.userExternalAccount.findUnique({
    where: {
      platform_externalUserId: {
        platform: BotPlatform.KOOK,
        externalUserId
      }
    },
    include: { user: true }
  });

  if (existing) {
    const data = {};
    if (displayName && existing.displayName !== displayName) data.displayName = displayName;

    const shouldRenameUser = isSyntheticKookCustomer(existing.user) && displayName && existing.user.displayName !== displayName;
    if (Object.keys(data).length > 0) {
      await prisma.userExternalAccount.update({
        where: {
          platform_externalUserId: {
            platform: BotPlatform.KOOK,
            externalUserId
          }
        },
        data
      });
    }

    if (shouldRenameUser) {
      await renameUserSafely(existing.user.id, displayName);
    }

    return Object.keys(data).length > 0 || shouldRenameUser ? "updated" : "unchanged";
  }

  const displayNameForUser = await getAvailableDisplayName(displayName || `KOOK客户${randomInt(1000, 9999)}`);
  const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: buildPlatformCustomerEmail(externalUserId),
        passwordHash,
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
        displayName: displayNameForUser,
        displayNameKey: normalizeDisplayNameKey(displayNameForUser),
        referralCode: await generateUniqueReferralCode(tx, "C")
      }
    });

    await tx.wallet.create({ data: { userId: user.id } });
    await tx.userExternalAccount.create({
      data: {
        userId: user.id,
        platform: BotPlatform.KOOK,
        externalUserId,
        displayName
      }
    });
  });

  return "created";
}

async function renameUserSafely(userId, desiredName) {
  const displayName = await getAvailableDisplayName(desiredName, userId);
  await prisma.user.update({
    where: { id: userId },
    data: {
      displayName,
      displayNameKey: normalizeDisplayNameKey(displayName)
    }
  });
}

async function listGuildMembers(token, guildId) {
  const all = [];
  for (let page = 1; page <= 100; page += 1) {
    const data = await kookApi(token, `/api/v3/guild/user-list?guild_id=${encodeURIComponent(guildId)}&page=${page}&page_size=100`);
    const items = Array.isArray(data.items) ? data.items : [];
    all.push(...items);
    const pageTotal = Number(data.meta?.page_total ?? 1);
    if (page >= pageTotal || items.length === 0) break;
  }
  return all;
}

async function kookApi(token, pathName) {
  const response = await fetch(`${KOOK_API_BASE_URL}${pathName}`, {
    headers: { Authorization: `Bot ${token}` }
  });
  if (!response.ok) throw new Error(`KOOK API HTTP ${response.status}`);
  const result = await response.json();
  if (result.code !== 0) throw new Error(`KOOK API error ${result.code}: ${result.message}`);
  return result.data;
}

async function getAvailableDisplayName(baseName, currentUserId) {
  const sanitized = sanitizeDisplayName(baseName) || `KOOK客户${randomInt(1000, 9999)}`;
  for (let index = 0; index < 50; index += 1) {
    const candidate = index === 0 ? sanitized : `${sanitized}-${index + 1}`;
    const displayNameKey = normalizeDisplayNameKey(candidate);
    const existing = await prisma.user.findFirst({
      where: {
        role: UserRole.CUSTOMER,
        displayNameKey,
        ...(currentUserId ? { id: { not: currentUserId } } : {})
      },
      select: { id: true }
    });
    if (!existing) return candidate;
  }
  return `${sanitized}-${randomBytes(2).toString("hex").toUpperCase()}`;
}

function formatKookDisplayName(member) {
  const name = sanitizeDisplayName(member.nickname || member.username);
  const identifyNum = sanitizeDisplayName(member.identify_num);
  if (name && identifyNum) return `${name}#${identifyNum}`;
  return name;
}

function sanitizeDisplayName(value) {
  const normalized = value?.normalize("NFKC").trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, 32) : undefined;
}

function normalizeDisplayNameKey(value) {
  return value.normalize("NFKC").trim().toLowerCase();
}

function buildPlatformCustomerEmail(externalUserId) {
  return `customer-kook-${externalUserId}@platform.maycatplay.local`.toLowerCase();
}

function isSyntheticKookCustomer(user) {
  return user.role === UserRole.CUSTOMER && /^customer-kook-.+@platform\.maycatplay\.local$/i.test(user.email);
}

function isRealKookUserId(value) {
  return /^\d{6,}$/.test(String(value ?? ""));
}

async function countInvalidKookPlaceholders() {
  const rows = await prisma.userExternalAccount.findMany({
    where: {
      platform: BotPlatform.KOOK,
      user: {
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
        email: { endsWith: "@platform.maycatplay.local" }
      }
    },
    select: { externalUserId: true }
  });
  return rows.filter((row) => !isRealKookUserId(row.externalUserId)).length;
}

async function deactivateInvalidKookPlaceholders() {
  const rows = await prisma.userExternalAccount.findMany({
    where: {
      platform: BotPlatform.KOOK,
      user: {
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
        email: { endsWith: "@platform.maycatplay.local" }
      }
    },
    include: {
      user: {
        include: {
          wallet: true,
          customerOrders: { select: { id: true }, take: 1 },
          customerOrderDrafts: { select: { id: true }, take: 1 },
          walletTransactions: { select: { id: true }, take: 1 }
        }
      }
    }
  });

  let count = 0;
  for (const row of rows) {
    if (isRealKookUserId(row.externalUserId)) continue;
    const wallet = row.user.wallet;
    const hasMoney =
      wallet &&
      (wallet.availableBalance.toNumber() !== 0 ||
        wallet.frozenBalance.toNumber() !== 0 ||
        wallet.availableIncome.toNumber() !== 0 ||
        wallet.pendingIncome.toNumber() !== 0);
    const hasBusinessData =
      hasMoney || row.user.customerOrders.length > 0 || row.user.customerOrderDrafts.length > 0 || row.user.walletTransactions.length > 0;
    if (hasBusinessData) continue;

    await prisma.user.update({
      where: { id: row.userId },
      data: { status: UserStatus.BANNED }
    });
    count += 1;
  }

  return count;
}

async function generateUniqueReferralCode(tx, prefix) {
  for (let index = 0; index < 20; index += 1) {
    const code = `${prefix}${randomInt(100000, 999999)}`;
    const existing = await tx.user.findUnique({ where: { referralCode: code }, select: { id: true } });
    if (!existing) return code;
  }
  return `${prefix}${randomBytes(4).toString("hex").toUpperCase()}`;
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((env, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return env;
      const index = trimmed.indexOf("=");
      if (index === -1) return env;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      env[key] = value;
      return env;
    }, {});
}
