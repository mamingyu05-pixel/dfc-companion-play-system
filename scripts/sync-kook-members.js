#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, randomInt } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { BotPlatform, PrismaClient, UserRole, UserStatus } = require("./script-prisma-client");

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
  const args = process.argv.slice(2);
  const token = env.KOOK_TOKEN;
  const guildId = env.KOOK_GUILD_ID || firstPositionalArg(args);
  const targetUserId = readArg(args, "--user-id");
  const manualDisplayName = readArg(args, "--display-name");
  const shouldDeactivateInvalid = args.includes("--deactivate-invalid-placeholders");

  if (!token) throw new Error("KOOK_TOKEN is missing in .env");
  if (!guildId) throw new Error("KOOK_GUILD_ID is missing in .env. You can also pass it as the first argument.");

  if (targetUserId) {
    await inspectAndSyncSingleKookUser(token, guildId, targetUserId, manualDisplayName);
    return;
  }

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

  const repairedByUserView = await syncExistingAccountsByUserView(token, guildId, new Set(realMembers.map((member) => member.id)));

  console.log(`Synced KOOK customers. created=${created}, updated=${updated}, repairedByUserView=${repairedByUserView}`);

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

async function inspectAndSyncSingleKookUser(token, guildId, userId, manualDisplayName) {
  console.log(`Inspect KOOK user: ${userId}`);
  const account = await prisma.userExternalAccount.findUnique({
    where: {
      platform_externalUserId: {
        platform: BotPlatform.KOOK,
        externalUserId: userId
      }
    },
    include: { user: true }
  });

  if (!account) {
    console.log("DB account: not found");
  } else {
    console.log(`DB account: ${account.user.displayName} | ${account.displayName || "(no external displayName)"} | ${account.user.email}`);
  }

  if (manualDisplayName) {
    if (!account) throw new Error(`Cannot manually rename KOOK ${userId}: DB account not found`);
    await updateExistingKookAccountName(account, manualDisplayName);
    console.log(`Manual displayName applied: ${manualDisplayName}`);
    return;
  }

  const fromView = await getKookUserView(token, guildId, userId);
  if (fromView) {
    console.log(
      `KOOK user/view: id=${fromView.id || userId}, username=${fromView.username || ""}, nickname=${fromView.nickname || ""}, identify_num=${fromView.identify_num || ""}`
    );
    const result = await upsertKookCustomer({ ...fromView, id: fromView.id || userId });
    console.log(`Sync result from user/view: ${result}`);
    return;
  }

  const fromList = await findKookMemberInGuildList(token, guildId, userId);
  if (fromList) {
    console.log(
      `KOOK guild/user-list: id=${fromList.id || userId}, username=${fromList.username || ""}, nickname=${fromList.nickname || ""}, identify_num=${fromList.identify_num || ""}`
    );
    const result = await upsertKookCustomer({ ...fromList, id: fromList.id || userId });
    console.log(`Sync result from guild/user-list: ${result}`);
    return;
  }

  console.log("KOOK API returned no nickname for this user. If you can see the real nickname in KOOK, run with --display-name \"nickname#0000\".");
}

async function updateExistingKookAccountName(account, desiredName) {
  const displayName = sanitizeDisplayName(desiredName);
  if (!displayName) throw new Error("displayName is empty after sanitizing");

  const userDisplayName = isSyntheticKookCustomer(account.user)
    ? await getAvailableDisplayName(displayName, account.userId)
    : undefined;

  await prisma.$transaction(async (tx) => {
    await tx.userExternalAccount.update({
      where: {
        platform_externalUserId: {
          platform: BotPlatform.KOOK,
          externalUserId: account.externalUserId
        }
      },
      data: { displayName }
    });

    if (userDisplayName) {
      await tx.user.update({
        where: { id: account.userId },
        data: {
          displayName: userDisplayName,
          displayNameKey: normalizeDisplayNameKey(userDisplayName)
        }
      });
    }
  });
}

async function syncExistingAccountsByUserView(token, guildId, listedMemberIds) {
  const rows = await prisma.userExternalAccount.findMany({
    where: {
      platform: BotPlatform.KOOK,
      user: {
        role: UserRole.CUSTOMER,
        email: { endsWith: "@platform.maycatplay.local" }
      }
    },
    include: { user: true }
  });

  let count = 0;
  for (const row of rows) {
    if (!isRealKookUserId(row.externalUserId)) continue;
    if (listedMemberIds.has(row.externalUserId) && row.displayName && !isSyntheticKookDisplayName(row.user.displayName)) continue;

    const member = await getKookUserView(token, guildId, row.externalUserId);
    if (!member) {
      console.log(`nickname lookup skipped: KOOK user ${row.externalUserId} not returned by user/view`);
      continue;
    }

    const result = await upsertKookCustomer(member);
    if (result === "updated") count += 1;
  }

  return count;
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

async function findKookMemberInGuildList(token, guildId, userId) {
  for (let page = 1; page <= 100; page += 1) {
    const data = await kookApi(token, `/api/v3/guild/user-list?guild_id=${encodeURIComponent(guildId)}&page=${page}&page_size=100`);
    const items = Array.isArray(data.items) ? data.items : [];
    const found = items.find((item) => item.id === userId);
    if (found) return found;
    const pageTotal = Number(data.meta?.page_total ?? 1);
    if (page >= pageTotal || items.length === 0) break;
  }
  return null;
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

async function getKookUserView(token, guildId, userId) {
  const query = new URLSearchParams({ user_id: userId });
  if (guildId) query.set("guild_id", guildId);
  try {
    const data = await kookApi(token, `/api/v3/user/view?${query.toString()}`);
    return data?.id ? data : { ...data, id: userId };
  } catch (error) {
    console.log(`nickname lookup failed for KOOK user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
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

function isSyntheticKookDisplayName(value) {
  return /^KOOK客户\d+$/i.test(String(value ?? "")) || String(value ?? "").includes("未同步");
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

function readArg(args, name) {
  const equalsArg = args.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function firstPositionalArg(args) {
  return args.find((arg) => !arg.startsWith("--"));
}
