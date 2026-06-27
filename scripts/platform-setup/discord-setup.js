const { CONTENT, renderTemplate } = require("./content");
const {
  discordGet,
  discordPatch,
  discordPost,
  discordPut,
  findChannel,
  loadProjectEnv,
  postIfNotExists,
  requireAny
} = require("./utils");

const CHANNEL_PLACEHOLDERS = {
  ANNOUNCE_CHANNEL: {
    env: ["DISCORD_ANNOUNCE_CHANNEL_ID"],
    patterns: ["最新活动", "公告通知", "公告", "通知"],
    type: 0
  },
  SERVICE_CHANNEL: {
    env: ["DISCORD_SERVICE_CHANNEL_ID"],
    patterns: ["服务价目", "价目", "服务项目"],
    type: 0
  },
  RECHARGE_CHANNEL: {
    env: ["DISCORD_RECHARGE_CHANNEL_ID"],
    patterns: ["充值报码", "充值方式", "充值审核", "充值"],
    type: 0
  },
  COMPANION_CHANNEL: {
    env: ["DISCORD_COMPANION_CHANNEL_ID"],
    patterns: ["陪玩预览", "查看陪玩", "陪玩大厅", "陪玩"],
    type: 0
  },
  REVIEW_CHANNEL: {
    env: ["DISCORD_REVIEW_CHANNEL_ID"],
    patterns: ["好评展示", "好评"],
    type: 0
  },
  CHAT_CHANNEL: {
    env: ["DISCORD_CHAT_CHANNEL_ID"],
    patterns: ["文字聊天区", "聊天大厅", "游戏id", "闲聊"],
    type: 0
  },
  SUPPORT1_CHANNEL: {
    env: ["DISCORD_SUPPORT_CHANNEL_ID"],
    patterns: ["客服接待1", "客服接待-1", "客服接待 1", "客服接待"],
    type: 0
  },
  SUPPORT2_CHANNEL: {
    env: ["DISCORD_SUPPORT2_CHANNEL_ID"],
    patterns: ["客服接待2", "客服接待-2", "客服接待 2"],
    type: 0
  },
  SUPPORT_CHANNEL: {
    env: ["DISCORD_SUPPORT_CHANNEL_ID"],
    patterns: ["客服接待1", "客服接待-1", "客服接待 1", "客服接待"],
    type: 0
  },
  ORDER_CHANNEL: {
    env: ["DISCORD_ORDER_CHANNEL_ID"],
    patterns: ["点单", "自助下单"],
    type: 0
  },
  EXAM_CHANNEL: {
    env: ["DISCORD_EXAM_CHANNEL_ID"],
    patterns: ["考核入职须知", "考核"],
    type: 0
  },
  TAG_CHANNEL: {
    env: ["DISCORD_TAG_CHANNEL_ID"],
    patterns: ["tag登记", "tag-登记", "技能登记"],
    type: 0
  }
};

const POST_TARGETS = {
  welcome: {
    env: ["DISCORD_WELCOME_CHANNEL_ID"],
    patterns: ["频道简介", "welcome", "店内导航", "频道导航", "欢迎"],
    type: 0
  },
  service: CHANNEL_PLACEHOLDERS.SERVICE_CHANNEL,
  order: CHANNEL_PLACEHOLDERS.ORDER_CHANNEL,
  dispatch: {
    env: ["DISCORD_DISPATCH_CHANNEL_ID", "DISCORD_AI_DISPATCH_CHANNEL_ID"],
    patterns: ["人工派单"],
    type: 0
  }
};

async function runDiscordSetup() {
  const env = loadProjectEnv();
  const token = requireAny(env, ["DISCORD_BOT_TOKEN", "DISCORD_TOKEN"], "Discord bot token");
  const guildId = requireAny(env, ["DISCORD_GUILD_ID"], "DISCORD_GUILD_ID");

  console.log(`Discord guild: ${guildId}`);
  const channels = await getGuildChannels(token, guildId);
  const guild = await discordGet(token, `/guilds/${guildId}`);
  const everyoneRoleId = guild?.id || guildId;

  await hideInternalTestChannels(token, guildId, channels, everyoneRoleId);
  await ensureServiceChannel(token, guildId, channels);

  const refreshedChannels = await getGuildChannels(token, guildId);
  const channelIds = buildChannelIds(env, refreshedChannels);
  logChannelIds("Discord channel map", channelIds);

  const targets = {
    welcome: resolveTarget(env, refreshedChannels, POST_TARGETS.welcome),
    service: channelIds.SERVICE_CHANNEL,
    order: channelIds.ORDER_CHANNEL,
    dispatch: resolveTarget(env, refreshedChannels, POST_TARGETS.dispatch)
  };

  if (targets.order) {
    await discordPatch(token, `/channels/${targets.order}`, { rate_limit_per_user: 5 });
    console.log(`set Discord slow mode 5s: ${targets.order}`);
  }

  await postIfNotExists(token, targets.welcome, renderTemplate(CONTENT.INTRO_CUSTOMER.discord, "discord", channelIds), CONTENT.INTRO_CUSTOMER.marker);
  await postIfNotExists(token, targets.welcome, renderTemplate(CONTENT.INTRO_COMPANION.discord, "discord", channelIds), CONTENT.INTRO_COMPANION.marker);
  await postIfNotExists(token, targets.welcome, renderTemplate(CONTENT.INTRO_OFFICIAL.discord, "discord", channelIds), CONTENT.INTRO_OFFICIAL.marker);
  await postIfNotExists(token, targets.order, renderTemplate(CONTENT.ORDER_FORMAT.discord, "discord", channelIds), CONTENT.ORDER_FORMAT.marker);
  await postIfNotExists(token, targets.service, renderTemplate(CONTENT.SERVICE_ITEMS.discord, "discord", channelIds), CONTENT.SERVICE_ITEMS.marker);
  await postIfNotExists(token, targets.dispatch, renderTemplate(CONTENT.DISPATCH_RULES.discord, "discord", channelIds), CONTENT.DISPATCH_RULES.marker);
}

async function getGuildChannels(token, guildId) {
  const channels = await discordGet(token, `/guilds/${guildId}/channels`);
  return Array.isArray(channels) ? channels : [];
}

async function hideInternalTestChannels(token, guildId, channels, everyoneRoleId) {
  const targets = channels.filter((channel) => ["施工", "我帅得要命，真的"].some((name) => String(channel.name || "").includes(name)));
  for (const channel of targets) {
    await discordPut(token, `/channels/${channel.id}/permissions/${everyoneRoleId}`, {
      allow: "0",
      deny: "1024",
      type: 0
    });
    console.log(`hidden internal Discord channel from @everyone: ${channel.name} (${channel.id})`);
  }
  if (!targets.length) console.log("no Discord internal test channels matched; skip hide step");
}

async function ensureServiceChannel(token, guildId, channels) {
  if (findChannel(channels, CHANNEL_PLACEHOLDERS.SERVICE_CHANNEL.patterns, 0)) return;
  const parent = findChannel(channels, ["欢迎来到may猫饼", "欢迎来到", "欢迎"], 4);
  const created = await discordPost(token, `/guilds/${guildId}/channels`, {
    name: "服务价目",
    type: 0,
    parent_id: parent?.id,
    topic: "May猫饼电竞服务项目、价格和超时计费规则"
  });
  channels.push(created);
  console.log(`created Discord service channel: ${created.id}`);
}

function buildChannelIds(env, channels) {
  return Object.fromEntries(
    Object.entries(CHANNEL_PLACEHOLDERS).map(([key, config]) => [key, resolveTarget(env, channels, config)])
  );
}

function resolveTarget(env, channels, config) {
  const fromEnv = config.env?.map((name) => env[name]).find(Boolean);
  if (fromEnv) return fromEnv;
  return findChannel(channels, config.patterns, config.type)?.id;
}

function logChannelIds(title, channelIds) {
  console.log(`\n${title}`);
  for (const [key, value] of Object.entries(channelIds)) {
    console.log(`${value ? "OK" : "MISSING"} ${key}: ${value || "not found"}`);
  }
  console.log("");
}

module.exports = {
  runDiscordSetup
};

if (require.main === module) {
  runDiscordSetup().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
