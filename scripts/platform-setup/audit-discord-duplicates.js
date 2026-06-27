const {
  discordGet,
  discordPut,
  loadProjectEnv,
  normalizeName,
  requireAny
} = require("./utils");

const DUPLICATE_GROUPS = [
  {
    key: "STORE_NAV",
    title: "店内导航 / 频道简介",
    canonicalName: "频道简介",
    env: ["DISCORD_WELCOME_CHANNEL_ID", "DISCORD_STORE_NAV_CHANNEL_ID"],
    aliases: ["频道简介", "店内导航", "频道导航", "welcome"],
    note: "这些通常都在做新用户入口说明，建议只保留一个主入口。"
  },
  {
    key: "ANNOUNCEMENT",
    title: "公告 / 通知 / 最新活动",
    canonicalName: "公告",
    env: ["DISCORD_ANNOUNCE_CHANNEL_ID"],
    aliases: ["公告", "通知公告", "最新活动", "活动公告"],
    note: "如果活动更新很少，可以合并到公告；如果活动运营频繁，可以保留最新活动。"
  },
  {
    key: "SERVICE_PRICE",
    title: "服务价目",
    canonicalName: "服务价目",
    env: ["DISCORD_SERVICE_CHANNEL_ID"],
    aliases: ["服务价目", "服务份目", "服务项目", "价目"],
    note: "服务价格说明建议只保留一个频道，避免客户看到旧价格。"
  },
  {
    key: "SUPPORT_TEXT",
    title: "客服文字接待",
    canonicalName: "客服-文字",
    env: ["DISCORD_SUPPORT_CHANNEL_ID"],
    aliases: ["客服-文字", "客服", "客服接待", "客服接待1", "客服接待1厅", "客服接待-1厅"],
    note: "客服大厅和具体接待房可能有不同用途；隐藏前先确认没有正在使用。"
  },
  {
    key: "COMPLAINT_RULES",
    title: "投诉 / 处罚 / 违规",
    canonicalName: "违规处理",
    env: ["DISCORD_COMPLAINT_CHANNEL_ID", "DISCORD_VIOLATION_CHANNEL_ID"],
    aliases: ["违规处理", "投诉处理", "处罚通知", "处刑通知"],
    note: "规则说明和投诉入口可分开；如果内容重复，建议规则留在违规处理，投诉留在投诉处理。"
  },
  {
    key: "EXAM",
    title: "考核 / 入职",
    canonicalName: "考核标准",
    env: ["DISCORD_EXAM_CHANNEL_ID"],
    aliases: ["考核标准", "考核入职须知", "考核须知"],
    note: "考核标准和入职申请可以拆分；如果只有规则说明，建议保留考核标准。"
  }
];

async function runDiscordDuplicateAudit(options = {}) {
  const env = loadProjectEnv();
  const token = requireAny(env, ["DISCORD_BOT_TOKEN", "DISCORD_TOKEN"], "Discord bot token");
  const guildId = requireAny(env, ["DISCORD_GUILD_ID"], "DISCORD_GUILD_ID");
  const hideDuplicates = Boolean(options.hideDuplicates);

  console.log(`Discord guild: ${guildId}`);
  console.log(hideDuplicates ? "模式：隐藏重复候选，不删除频道" : "模式：只审计，不修改频道");

  const channels = await getGuildChannels(token, guildId);
  const categories = Object.fromEntries(
    channels.filter((channel) => Number(channel.type) === 4).map((channel) => [channel.id, channel.name])
  );
  const everyoneId = guildId;
  const plans = buildDuplicatePlans(env, channels, categories);

  if (!plans.length) {
    console.log("✓ 未发现明显重复频道组");
    return [];
  }

  for (const plan of plans) {
    printPlan(plan);
    if (hideDuplicates) {
      await hideDuplicateChannels(token, everyoneId, plan.duplicates);
    }
  }

  if (!hideDuplicates) {
    console.log("\n如需只隐藏重复候选频道，可在确认计划后运行：");
    console.log("node scripts/platform-setup/audit-discord-duplicates.js --hide-duplicates");
    console.log("注意：该命令不会删除频道，也不会迁移历史消息。");
  }

  return plans;
}

async function getGuildChannels(token, guildId) {
  const channels = await discordGet(token, `/guilds/${guildId}/channels`);
  return Array.isArray(channels) ? channels : [];
}

function buildDuplicatePlans(env, channels, categories) {
  return DUPLICATE_GROUPS.map((group) => {
    const matches = matchGroupChannels(group, channels, categories);
    if (matches.length <= 1) return null;
    const canonical = chooseCanonical(env, group, matches);
    const duplicates = matches.filter((match) => match.id !== canonical.id);
    return { group, canonical, duplicates };
  }).filter(Boolean);
}

function matchGroupChannels(group, channels, categories) {
  return channels
    .filter((channel) => Number(channel.type) === 0)
    .filter((channel) => matchesAnyAlias(channel.name, group.aliases))
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      parentId: channel.parent_id,
      category: categories[channel.parent_id] || "无分类",
      position: Number(channel.position || 0)
    }))
    .sort((a, b) => a.position - b.position);
}

function matchesAnyAlias(name, aliases) {
  const normalizedName = normalizeName(name);
  return aliases.some((alias) => {
    const normalizedAlias = normalizeName(alias);
    return normalizedName === normalizedAlias || normalizedName.includes(normalizedAlias);
  });
}

function chooseCanonical(env, group, matches) {
  const envId = group.env.map((name) => env[name]).find(Boolean);
  if (envId) {
    const envMatch = matches.find((match) => match.id === envId);
    if (envMatch) return envMatch;
  }

  const exactCanonical = matches.find((match) => normalizeName(match.name) === normalizeName(group.canonicalName));
  if (exactCanonical) return exactCanonical;

  return matches[0];
}

function printPlan(plan) {
  console.log(`\n[${plan.group.title}]`);
  console.log(`保留建议：#${plan.canonical.name} (${plan.canonical.id}) / ${plan.canonical.category}`);
  console.log(`说明：${plan.group.note}`);
  console.log("重复候选：");
  for (const duplicate of plan.duplicates) {
    console.log(`  - #${duplicate.name} (${duplicate.id}) / ${duplicate.category}`);
  }
}

async function hideDuplicateChannels(token, everyoneId, duplicates) {
  for (const channel of duplicates) {
    await discordPut(token, `/channels/${channel.id}/permissions/${everyoneId}`, {
      allow: "0",
      deny: "1024",
      type: 0
    });
    console.log(`✓ 已隐藏重复候选：#${channel.name}`);
  }
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  runDiscordDuplicateAudit({ hideDuplicates: args.has("--hide-duplicates") }).catch((error) => {
    console.error("❌ 错误：", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  runDiscordDuplicateAudit
};
