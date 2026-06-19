#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const KOOK_API_BASE_URL = "https://www.kookapp.cn";
const SITE_URL = "https://maycatplay.com/customer/";

const discordPermissions = {
  view: 1n << 10n,
  send: 1n << 11n,
  readHistory: 1n << 16n,
  connect: 1n << 20n,
  speak: 1n << 21n
};

const kookPermissions = {
  view: 1 << 10,
  send: 1 << 11,
  readHistory: 1 << 16,
  connect: 1 << 20,
  speak: 1 << 21
};

const legacyChannelNames = [
  "欢迎大厅",
  "新人接待",
  "入会申请",
  "通知",
  "公告信息",
  "公告",
  "交流区",
  "游戏资讯",
  "闲聊专区",
  "随便聊聊",
  "游戏开黑",
  "游戏文字区",
  "游戏频道1",
  "游戏频道2",
  "活动中心",
  "活动大厅",
  "活动语音"
];

const discordCategories = [
  { key: "welcome", name: "✦ 欢迎来到 May猫饼 ✦" },
  { key: "service", name: "☎ 客服接待大厅 ☎" },
  { key: "chat", name: "✍ 文字聊天区" },
  { key: "assessment", name: "🧾 考核专区" },
  { key: "vip", name: "👑 专属会员区" },
  { key: "xp", name: "⚡ XP 接单区" }
];

const textGuides = {
  pricing: {
    title: "May猫饼服务价目",
    lines: [
      "价格以网站后台配置为准，客户不用自己选价格。",
      "不同游戏、模式、陪玩等级、平台来源可以配置不同单价。",
      "充值、下单、退款、提现都以后台记录为准，频道消息只做沟通辅助。"
    ]
  },
  nav: {
    title: "店内导航",
    lines: [
      `网站入口：${SITE_URL}`,
      "想找陪玩：去客服接待，说清游戏、模式、时长、是否试音。",
      "想当陪玩：先联系人工客服考核，通过后后台开通陪玩身份。",
      "订单争议：带订单号、聊天截图、录屏或充值截图找客服。"
    ]
  },
  support: {
    title: "客服接待",
    lines: [
      "直接说需求即可，不用套模板。",
      "找陪玩建议包含：游戏、模式、时长、预算范围、是否试音、语音偏好。",
      "充值不到账、退款、投诉、账号绑定问题会转人工处理。"
    ]
  },
  dispatch: {
    title: "人工派单",
    lines: [
      "这里由客服或 AI 发布派单信息，陪玩报名，客户最终确认人选。",
      "陪玩报名请写：段位/水平、擅长模式、性格风格、可服务时间、是否可试音。",
      "报名不等于接单，后台确认后才进入正式订单。"
    ]
  },
  aiDispatch: {
    title: "AI 派单",
    lines: [
      "AI 会把客户需求整理成派单草稿，并提醒对应游戏标签的陪玩。",
      "长时间无人报名、客户失联或需求取消，后台可以标记流单。",
      "AI 只负责整理和提醒，金额、结算、退款必须走后台。"
    ]
  },
  exam: {
    title: "陪玩入职考核",
    lines: [
      "陪玩不能自行上架，需要联系客服考核。",
      "考核重点：游戏水平、沟通能力、语音状态、稳定性、是否遵守平台流程。",
      "通过后管理员会给账号开通陪玩身份，并设置可接游戏、价格档和平台抽成。"
    ]
  }
};

const discordTextChannels = [
  { key: "pricing", name: "📌｜服务价目", category: "welcome", guide: "pricing" },
  { key: "nav", name: "🧭｜店内导航", category: "welcome", guide: "nav" },
  { key: "announcement", name: "📢｜通知公告", category: "welcome" },
  { key: "activity", name: "🎉｜最新活动", category: "welcome" },
  { key: "benefits", name: "💎｜预存福利", category: "welcome" },
  { key: "penalty", name: "⚠｜处罚通知", category: "welcome" },
  { key: "support", env: "DISCORD_SUPPORT_CHANNEL_ID", name: "💬｜客服接待 1 厅", category: "service", guide: "support" },
  { key: "support2", name: "💬｜客服接待 2 厅", category: "service" },
  { key: "vipSupport", name: "💡｜VIP 接待厅", category: "service" },
  { key: "afterSales", name: "▶｜售后专区", category: "service" },
  { key: "feedback", name: "📮｜店长反馈", category: "service" },
  { key: "aiDispatch", env: "DISCORD_AI_DISPATCH_CHANNEL_ID", name: "🤖｜AI 派单", category: "xp", guide: "aiDispatch" },
  { key: "dispatch", env: "DISCORD_DISPATCH_CHANNEL_ID", name: "📣｜人工派单", category: "xp", guide: "dispatch" },
  { key: "gameChat", name: "🎮｜游戏ID&闲聊区", category: "chat" },
  { key: "tag", name: "🏷｜陪玩TAG登记", category: "chat" },
  { key: "gift", name: "🎁｜礼物图鉴", category: "chat" },
  { key: "rechargeCode", name: "💳｜充值报码", category: "chat" },
  { key: "ranking", name: "👑｜冠名播报", category: "chat" },
  { key: "reviews", name: "🖼｜好评展示", category: "chat" },
  { key: "examNotice", name: "📕｜考核入职须知", category: "assessment", guide: "exam" },
  { key: "examTag", name: "✏｜Tag 登记", category: "assessment" },
  { key: "recharge", env: "DISCORD_RECHARGE_CHANNEL_ID", name: "💳｜充值审核", category: "welcome" },
  { key: "withdrawal", env: "DISCORD_WITHDRAWAL_CHANNEL_ID", name: "💸｜提现审核", category: "welcome" },
  { key: "complaint", env: "DISCORD_COMPLAINT_CHANNEL_ID", name: "🧯｜投诉处理", category: "service" },
  { key: "admin", env: "DISCORD_ADMIN_CHANNEL_ID", name: "🛎｜管理提醒", category: "welcome" }
];

const discordVoiceChannels = [
  { key: "voiceWaiting", env: "DISCORD_VOICE_WAITING_CHANNEL_ID", name: "🎙｜试音大厅", category: "service", limit: 10 },
  ...Array.from({ length: 6 }, (_, index) => ({
    key: `assessment${index + 1}`,
    name: `🎧｜考核${toChineseNumber(index + 1)}厅 非请勿入`,
    category: "assessment",
    limit: 6
  })),
  ...Array.from({ length: 3 }, (_, index) => ({
    key: `vip${index + 1}`,
    name: `👑｜专员 ${index + 1} 区`,
    category: "vip",
    limit: 8
  })),
  ...Array.from({ length: 10 }, (_, index) => ({
    key: `xp${index + 1}`,
    name: `⚡｜XP · 接单 ${String(index + 1).padStart(2, "0")} 厅`,
    category: "xp",
    limit: 6
  })),
  ...Array.from({ length: 3 }, (_, index) => ({
    key: `xpGlobal${index + 1}`,
    name: `🌐｜XP · 国际 ${String(index + 1).padStart(2, "0")} 厅`,
    category: "xp",
    limit: 6
  }))
];

const kookChannels = [
  { key: "pricing", name: "📌｜服务价目", type: 1, guide: "pricing" },
  { key: "nav", name: "🧭｜店内导航", type: 1, guide: "nav" },
  { key: "announcement", name: "📢｜通知公告", type: 1 },
  { key: "activity", name: "🎉｜最新活动", type: 1 },
  { key: "benefits", name: "💎｜预存福利", type: 1 },
  { key: "support", env: "KOOK_SUPPORT_CHANNEL_ID", name: "💬｜客服接待 1 厅", type: 1, guide: "support" },
  { key: "aiDispatch", env: "KOOK_AI_DISPATCH_CHANNEL_ID", name: "🤖｜AI 派单", type: 1, guide: "aiDispatch" },
  { key: "dispatch", env: "KOOK_DISPATCH_CHANNEL_ID", name: "📣｜人工派单", type: 1, guide: "dispatch" },
  { key: "tag", name: "🏷｜陪玩TAG登记", type: 1 },
  { key: "gift", name: "🎁｜礼物图鉴", type: 1 },
  { key: "reviews", name: "🖼｜好评展示", type: 1 },
  { key: "examNotice", name: "📕｜考核入职须知", type: 1, guide: "exam" },
  { key: "recharge", env: "KOOK_RECHARGE_CHANNEL_ID", name: "💳｜充值审核", type: 1 },
  { key: "withdrawal", env: "KOOK_WITHDRAWAL_CHANNEL_ID", name: "💸｜提现审核", type: 1 },
  { key: "complaint", env: "KOOK_COMPLAINT_CHANNEL_ID", name: "🧯｜投诉处理", type: 1 },
  { key: "admin", env: "KOOK_ADMIN_CHANNEL_ID", name: "🛎｜管理提醒", type: 1 },
  { key: "voiceWaiting", env: "KOOK_VOICE_WAITING_CHANNEL_ID", name: "🎙｜试音大厅", type: 2, limit: 10 },
  ...Array.from({ length: 6 }, (_, index) => ({ key: `kookAssessment${index + 1}`, name: `🎧｜考核${toChineseNumber(index + 1)}厅 非请勿入`, type: 2, limit: 6 })),
  ...Array.from({ length: 3 }, (_, index) => ({ key: `kookVip${index + 1}`, name: `👑｜专员 ${index + 1} 区`, type: 2, limit: 8 })),
  ...Array.from({ length: 10 }, (_, index) => ({ key: `kookXp${index + 1}`, name: `⚡｜XP · 接单 ${String(index + 1).padStart(2, "0")} 厅`, type: 2, limit: 6 }))
];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = { ...loadEnv(path.resolve(process.cwd(), ".env")), ...process.env };
  const platforms = args.platform === "both" ? ["discord", "kook"] : [args.platform];

  for (const platform of platforms) {
    if (platform === "discord") {
      await decorateDiscord(env, args);
    } else if (platform === "kook") {
      await decorateKook(env, args);
    }
  }
}

async function decorateDiscord(env, args) {
  const token = env.DISCORD_TOKEN;
  const guildId = args.discordGuildId || env.DISCORD_GUILD_ID;
  if (!token) throw new Error("DISCORD_TOKEN is missing in .env");
  if (!guildId) throw new Error("DISCORD_GUILD_ID is missing in .env");

  console.log(`\nDiscord guild: ${guildId}`);
  const channels = await discordRequest(token, `/guilds/${guildId}/channels`, { method: "GET" });
  const categories = {};

  if (args.cleanupOld) {
    await cleanupLegacyDiscordChannels(token, env, channels, args);
  }

  for (const category of discordCategories) {
    const existing = findChannel(channels, category.name, 4);
    const categoryBody = {
      name: category.name,
      type: 4,
      permission_overwrites: buildDiscordPermissionOverwrites(env, guildId, category)
    };
    const result = existing || (args.dryRun ? previewChannel(category.name, 4) : await discordCreateChannel(token, guildId, categoryBody));
    categories[category.key] = result.id;
    pushIfCreated(channels, existing, result);
    if (existing && !args.dryRun) await discordPatchChannel(token, result.id, categoryBody);
    console.log(`${existing ? "reuse" : args.dryRun ? "would create" : "create"} category ${category.name} -> ${result.id}`);
  }

  const envOutput = {};
  for (const item of [...discordTextChannels, ...discordVoiceChannels]) {
    const existing = findChannelByEnvOrName(channels, env, item, item.env, item.name, item.type ?? 0);
    const body = {
      name: item.name,
      type: item.type ?? 0,
      parent_id: categories[item.category],
      topic: item.type === 2 ? undefined : buildTopic(item),
      permission_overwrites: buildDiscordPermissionOverwrites(env, guildId, item)
    };
    const channel = existing || (args.dryRun ? previewChannel(item.name, body.type) : await discordCreateChannel(token, guildId, body));
    pushIfCreated(channels, existing, channel);
    if (existing && !args.dryRun) await discordPatchChannel(token, channel.id, body);
    if (item.env) envOutput[item.env] = channel.id;
    console.log(`${existing ? "update" : args.dryRun ? "would create" : "create"} ${item.name} -> ${channel.id}`);
    if (args.postGuides && item.guide && !args.dryRun) {
      await discordPostMessage(token, channel.id, buildGuideMessage(textGuides[item.guide]));
    }
  }

  printEnvOutput("Discord", envOutput);
}

async function decorateKook(env, args) {
  const token = env.KOOK_TOKEN;
  const guildId = args.kookGuildId || env.KOOK_GUILD_ID;
  if (!token) throw new Error("KOOK_TOKEN is missing in .env");
  if (!guildId) throw new Error("KOOK_GUILD_ID is missing in .env");

  console.log(`\nKOOK guild: ${guildId}`);
  const channels = await kookListChannels(token, guildId);
  const envOutput = {};

  if (args.cleanupOld) {
    await cleanupLegacyKookChannels(token, env, channels, args);
  }

  for (const item of kookChannels) {
    const existing = findChannelByEnvOrName(channels, env, item, item.env, item.name, item.type);
    const channel = existing || (args.dryRun ? previewChannel(item.name, item.type) : await kookCreateChannel(token, guildId, item));
    pushIfCreated(channels, existing, channel);
    if (existing && !args.dryRun) await kookPatchChannel(token, channel.id, item);
    if (!args.dryRun) await applyKookChannelPermissions(token, env, channel.id, item);
    if (item.env) envOutput[item.env] = channel.id;
    console.log(`${existing ? "update" : args.dryRun ? "would create" : "create"} ${item.name} -> ${channel.id}`);
    if (args.postGuides && item.guide && !args.dryRun) {
      await kookPostMessage(token, channel.id, buildGuideMessage(textGuides[item.guide]));
    }
  }

  printEnvOutput("KOOK", envOutput);
}

function parseArgs(argv) {
  const flags = new Map();
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, value = "true"] = arg.slice(2).split("=");
    flags.set(key, value);
  }
  return {
    platform: flags.get("platform") || "both",
    discordGuildId: flags.get("discord-guild"),
    kookGuildId: flags.get("kook-guild"),
    cleanupOld: flags.has("cleanup-old"),
    postGuides: flags.has("post-guides"),
    dryRun: flags.has("dry-run")
  };
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return env;
}

function findChannelByEnvOrName(channels, env, item, envName, name, type) {
  if (envName && env[envName]) {
    const configured = channels.find((channel) => String(channel.id) === String(env[envName]));
    if (configured) return configured;
  }
  return findChannel(channels, name, type);
}

function findChannel(channels, name, type) {
  return channels.find((channel) => Number(channel.type) === Number(type) && normalizeName(channel.name) === normalizeName(name));
}

function normalizeName(value) {
  return String(value)
    .replace(/\s+/g, "")
    .replace(/[|｜_\-—–·.。:：()[\]【】<>《》]/g, "")
    .toLowerCase();
}

function buildTopic(item) {
  const guide = item.guide ? textGuides[item.guide] : undefined;
  return guide ? `${guide.title}｜${guide.lines[0]}` : `May猫饼电竞｜${item.name}｜网站 ${SITE_URL}`;
}

function buildGuideMessage(guide) {
  return [`## ${guide.title}`, "", ...guide.lines.map((line) => `- ${line}`), "", `网站入口：${SITE_URL}`].join("\n");
}

function previewChannel(name, type) {
  return { id: `preview-${normalizeName(name)}`, name, type };
}

function pushIfCreated(channels, existing, channel) {
  if (!existing && !String(channel.id).startsWith("preview-")) channels.push(channel);
}

function printEnvOutput(platform, output) {
  console.log(`\n${platform} env lines:`);
  for (const [key, value] of Object.entries(output)) {
    console.log(`${key}=${value}`);
  }
}

async function cleanupLegacyDiscordChannels(token, env, channels, args) {
  const currentNames = new Set([...discordCategories, ...discordTextChannels, ...discordVoiceChannels].map((item) => normalizeName(item.name)));
  const envChannelIds = getConfiguredChannelIds(env, "DISCORD_");
  const legacyNames = new Set(legacyChannelNames.map(normalizeName));
  for (const channel of [...channels]) {
    const normalized = normalizeName(channel.name);
    if (!legacyNames.has(normalized)) continue;
    if (currentNames.has(normalized)) continue;
    if (envChannelIds.has(String(channel.id))) continue;
    console.log(`${args.dryRun ? "would delete" : "delete"} legacy Discord channel ${channel.name} -> ${channel.id}`);
    if (!args.dryRun) {
      await discordDeleteChannel(token, channel.id);
      const index = channels.findIndex((item) => String(item.id) === String(channel.id));
      if (index !== -1) channels.splice(index, 1);
    }
  }
}

async function cleanupLegacyKookChannels(token, env, channels, args) {
  const currentNames = new Set(kookChannels.map((item) => normalizeName(item.name)));
  const envChannelIds = getConfiguredChannelIds(env, "KOOK_");
  const legacyNames = new Set(legacyChannelNames.map(normalizeName));
  for (const channel of [...channels]) {
    const normalized = normalizeName(channel.name);
    if (!legacyNames.has(normalized)) continue;
    if (currentNames.has(normalized)) continue;
    if (envChannelIds.has(String(channel.id))) continue;
    console.log(`${args.dryRun ? "would delete" : "delete"} legacy KOOK channel ${channel.name} -> ${channel.id}`);
    if (!args.dryRun) {
      await kookDeleteChannel(token, channel.id);
      const index = channels.findIndex((item) => String(item.id) === String(channel.id));
      if (index !== -1) channels.splice(index, 1);
    }
  }
}

function getConfiguredChannelIds(env, prefix) {
  return new Set(
    Object.entries(env)
      .filter(([key, value]) => key.startsWith(prefix) && key.endsWith("_CHANNEL_ID") && value)
      .map(([, value]) => String(value))
  );
}

function getAccessPolicy(item) {
  const key = item.key || "";
  const category = item.category || "";
  if (["recharge", "withdrawal", "admin"].includes(key)) return "staff";
  if (["examNotice", "examTag"].includes(key) || category === "assessment") return "assessment";
  if (["dispatch", "aiDispatch"].includes(key) || category === "xp") return "companion";
  if (category === "vip" || key === "vipSupport") return "vip";
  if (["support", "support2", "complaint", "voiceWaiting", "afterSales", "feedback"].includes(key)) return "support";
  if (["gameChat", "tag", "rechargeCode"].includes(key)) return "public-chat";
  if (["gift", "reviews", "pricing", "nav", "announcement", "activity", "benefits", "penalty", "ranking"].includes(key)) return "public-readonly";
  return "public-readonly";
}

function buildDiscordPermissionOverwrites(env, guildId, item) {
  const access = getAccessPolicy(item);
  const isVoice = Number(item.type) === 2 || isVoiceLikeKey(item.key);
  const roleGroups = getDiscordRoleGroups(env);
  const everyoneId = String(guildId);
  const read = discordPermissions.view | discordPermissions.readHistory;
  const write = read | discordPermissions.send;
  const voice = write | discordPermissions.connect | discordPermissions.speak;
  const full = isVoice ? voice : write;
  const overwrites = new Map();

  const setRole = (id, allow, deny = 0n) => {
    if (!id) return;
    overwrites.set(String(id), { id: String(id), type: 0, allow: String(allow), deny: String(deny) });
  };
  const denyEveryone = () => setRole(everyoneId, 0n, discordPermissions.view | discordPermissions.connect | discordPermissions.speak);
  const allowRoles = (ids, allow = full) => ids.forEach((id) => setRole(id, allow));

  if (access === "public-readonly") {
    setRole(everyoneId, read, discordPermissions.send);
  } else if (access === "public-chat" || access === "support") {
    setRole(everyoneId, isVoice ? voice : write);
    allowRoles(roleGroups.staff);
  } else if (access === "staff") {
    denyEveryone();
    allowRoles(roleGroups.staff);
  } else if (access === "assessment") {
    denyEveryone();
    allowRoles([...roleGroups.staff, ...roleGroups.assessment]);
  } else if (access === "companion") {
    denyEveryone();
    allowRoles([...roleGroups.staff, ...roleGroups.companion]);
  } else if (access === "vip") {
    denyEveryone();
    allowRoles([...roleGroups.staff, ...roleGroups.vip]);
  }

  return Array.from(overwrites.values());
}

function getDiscordRoleGroups(env) {
  const customerLevelRoles = Array.from({ length: 15 }, (_, index) => env[`DISCORD_CUSTOMER_LEVEL_${index + 1}_ROLE_ID`]).filter(Boolean);
  return {
    staff: uniqueValues([env.DISCORD_SUPER_ADMIN_ROLE_ID, env.DISCORD_ADMIN_ROLE_ID, env.DISCORD_SUPPORT_ROLE_ID]),
    companion: uniqueValues([env.DISCORD_COMPANION_ROLE_ID, env.DISCORD_CERTIFIED_COMPANION_ROLE_ID]),
    assessment: uniqueValues([env.DISCORD_COMPANION_APPLICANT_ROLE_ID, env.DISCORD_APPLICANT_ROLE_ID, env.DISCORD_COMPANION_ROLE_ID]),
    vip: uniqueValues([
      env.DISCORD_CUSTOMER_SPECIAL_NEON_ROLE_ID,
      env.DISCORD_CUSTOMER_SPECIAL_HALL_ROLE_ID,
      env.DISCORD_CUSTOMER_LEVEL_12_ROLE_ID,
      env.DISCORD_CUSTOMER_LEVEL_13_ROLE_ID,
      env.DISCORD_CUSTOMER_LEVEL_14_ROLE_ID,
      env.DISCORD_CUSTOMER_LEVEL_15_ROLE_ID,
      ...customerLevelRoles.slice(11)
    ])
  };
}

async function applyKookChannelPermissions(token, env, channelId, item) {
  const access = getAccessPolicy(item);
  if (access === "public-readonly" || access === "public-chat" || access === "support") return;

  const roleGroups = getKookRoleGroups(env);
  const isVoice = Number(item.type) === 2 || isVoiceLikeKey(item.key);
  const read = kookPermissions.view | kookPermissions.readHistory;
  const write = read | kookPermissions.send;
  const voice = write | kookPermissions.connect | kookPermissions.speak;
  const allow = isVoice ? voice : write;
  const deny = kookPermissions.view | kookPermissions.connect | kookPermissions.speak;
  const everyoneRoleId = env.KOOK_EVERYONE_ROLE_ID || "0";
  const allowRoleIds =
    access === "staff"
      ? roleGroups.staff
      : access === "assessment"
        ? [...roleGroups.staff, ...roleGroups.assessment]
        : access === "companion"
          ? [...roleGroups.staff, ...roleGroups.companion]
          : [...roleGroups.staff, ...roleGroups.vip];

  await kookUpsertChannelRolePermission(token, channelId, everyoneRoleId, 0, deny);
  for (const roleId of uniqueValues(allowRoleIds)) {
    await kookUpsertChannelRolePermission(token, channelId, roleId, allow, 0);
  }
}

function getKookRoleGroups(env) {
  return {
    staff: uniqueValues([env.KOOK_SUPER_ADMIN_ROLE_ID, env.KOOK_ADMIN_ROLE_ID, env.KOOK_SUPPORT_ROLE_ID]),
    companion: uniqueValues([env.KOOK_COMPANION_ROLE_ID, env.KOOK_CERTIFIED_COMPANION_ROLE_ID]),
    assessment: uniqueValues([env.KOOK_COMPANION_APPLICANT_ROLE_ID, env.KOOK_APPLICANT_ROLE_ID, env.KOOK_COMPANION_ROLE_ID]),
    vip: uniqueValues([
      env.KOOK_CUSTOMER_SPECIAL_NEON_ROLE_ID,
      env.KOOK_CUSTOMER_SPECIAL_HALL_ROLE_ID,
      env.KOOK_CUSTOMER_LEVEL_12_ROLE_ID,
      env.KOOK_CUSTOMER_LEVEL_13_ROLE_ID,
      env.KOOK_CUSTOMER_LEVEL_14_ROLE_ID,
      env.KOOK_CUSTOMER_LEVEL_15_ROLE_ID
    ])
  };
}

function isVoiceLikeKey(key) {
  return String(key || "").includes("voice") || String(key || "").includes("assessment") || String(key || "").includes("vip") || String(key || "").includes("xp");
}

function uniqueValues(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function toChineseNumber(value) {
  return ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"][value] || String(value);
}

async function discordCreateChannel(token, guildId, body) {
  return discordRequest(token, `/guilds/${guildId}/channels`, { method: "POST", body: JSON.stringify(body) });
}

async function discordPatchChannel(token, channelId, body) {
  return discordRequest(token, `/channels/${channelId}`, { method: "PATCH", body: JSON.stringify(body) });
}

async function discordDeleteChannel(token, channelId) {
  return discordRequest(token, `/channels/${channelId}`, { method: "DELETE" });
}

async function discordPostMessage(token, channelId, content) {
  return discordRequest(token, `/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify({ content }) });
}

async function discordRequest(token, apiPath, init) {
  const response = await fetch(`${DISCORD_API_BASE_URL}${apiPath}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Discord API HTTP ${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function kookListChannels(token, guildId) {
  const data = await kookRequest(token, `/api/v3/channel/list?guild_id=${encodeURIComponent(guildId)}`, { method: "GET" });
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  return items.map((item) => ({ id: String(item.id), name: String(item.name), type: Number(item.type) }));
}

async function kookCreateChannel(token, guildId, item) {
  const body = { guild_id: guildId, name: item.name, type: item.type };
  if (item.type === 2) {
    body.limit_amount = item.limit || 10;
    body.voice_quality = "2";
  }
  const data = await kookRequest(token, "/api/v3/channel/create", { method: "POST", body: JSON.stringify(body) });
  return { id: String(data.id), name: String(data.name), type: Number(data.type) };
}

async function kookPatchChannel(token, channelId, item) {
  try {
    await kookRequest(token, "/api/v3/channel/update", {
      method: "POST",
      body: JSON.stringify({ channel_id: channelId, name: item.name, topic: buildTopic(item) })
    });
  } catch (error) {
    console.warn(`warn update KOOK channel ${item.name}: ${error instanceof Error ? error.message : error}`);
  }
}

async function kookDeleteChannel(token, channelId) {
  return kookRequest(token, "/api/v3/channel/delete", {
    method: "POST",
    body: JSON.stringify({ channel_id: channelId })
  });
}

async function kookUpsertChannelRolePermission(token, channelId, roleId, allow, deny) {
  if (!roleId) return;
  const body = { channel_id: channelId, type: "role_id", value: roleId, allow, deny };
  try {
    await kookRequest(token, "/api/v3/channel-role/create", {
      method: "POST",
      body: JSON.stringify(body)
    });
  } catch (createError) {
    try {
      await kookRequest(token, "/api/v3/channel-role/update", {
        method: "POST",
        body: JSON.stringify(body)
      });
    } catch (updateError) {
      console.warn(
        `warn KOOK permission channel=${channelId} role=${roleId}: ${
          updateError instanceof Error ? updateError.message : updateError
        }`
      );
    }
  }
}

async function kookPostMessage(token, channelId, content) {
  return kookRequest(token, "/api/v3/message/create", {
    method: "POST",
    body: JSON.stringify({ target_id: channelId, type: 9, content })
  });
}

async function kookRequest(token, apiPath, init) {
  const response = await fetch(`${KOOK_API_BASE_URL}${apiPath}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`KOOK API HTTP ${response.status}: ${text}`);
  const result = JSON.parse(text);
  if (result.code !== 0) throw new Error(`KOOK API error ${result.code}: ${result.message || text}`);
  return result.data;
}
