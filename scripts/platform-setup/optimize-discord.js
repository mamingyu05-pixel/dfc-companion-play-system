const { CONTENT, renderTemplate } = require("./content");
const {
  discordEditMessage,
  discordGet,
  discordGetMessages,
  discordPatch,
  discordPost,
  discordPut,
  findChannel,
  loadProjectEnv,
  normalizeName,
  requireAny
} = require("./utils");

const EXAM_RULES_MARKER = "May猫饼电竞 · 陪玩考核标准";
const VIOLATION_RULES_MARKER = "May猫饼电竞 · 违规处理规则";

const EXAM_RULES_CONTENT = `## 🏕️ May猫饼电竞 · 陪玩考核标准

━━━━━━━━━━ 基本要求 ━━━━━━━━━━

▸ 年满 18 岁，有稳定的游戏时间
▸ 普通话清晰，无严重口音或噪音环境
▸ 至少一款支持游戏达到中高段位
▸ 性格稳定，不易情绪化，懂得照顾客户情绪
▸ 有耐心，能接受不同游戏水平的客户

━━━━━━━━━━ 考核流程 ━━━━━━━━━━

① 填写入职申请表（见 #考核入职须知 频道）
② 管理员安排试音，确认声线和沟通风格
③ 试玩一局，确认游戏水平
④ 通过后管理员开通陪玩账号并上架网站
⑤ 开始接单

━━━━━━━━━━ 注意事项 ━━━━━━━━━━

▸ 禁止私下向客户索取联系方式
▸ 禁止在平台外私自接单
▸ 违规一次警告，二次直接下架
▸ 所有订单以 maycatplay.com 后台记录为准`;

const VIOLATION_RULES_CONTENT = `## ⚠️ May猫饼电竞 · 违规处理规则

━━━━━━━━━━ 警告级（累计两次直接下架） ━━━━━━━━━━

▸ 无故爽单（已接单后取消）
▸ 服务期间态度恶劣或与客户发生口角
▸ 未经许可私自修改价格或服务时长
▸ 向客户暗示私下交易

━━━━━━━━━━ 直接下架级 ━━━━━━━━━━

▸ 私下向客户索取联系方式
▸ 绕过平台私下收款
▸ 泄露客户任何信息
▸ 在外部平台以 May猫饼名义招揽业务

━━━━━━━━━━ 申诉 ━━━━━━━━━━

如认为处理不当，在投诉处理频道反映，管理员 24 小时内回复。`;

const CHANNEL_PLACEHOLDERS = {
  ANNOUNCE_CHANNEL: {
    env: ["DISCORD_ANNOUNCE_CHANNEL_ID"],
    patterns: ["公告", "公告通知", "最新活动"],
    type: 0
  },
  SERVICE_CHANNEL: {
    env: ["DISCORD_SERVICE_CHANNEL_ID"],
    patterns: ["服务价目", "服务项目", "价目"],
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
    patterns: ["聊天大厅", "文字聊天区", "游戏id", "闲聊"],
    type: 0
  },
  SUPPORT1_CHANNEL: {
    env: ["DISCORD_SUPPORT_CHANNEL_ID"],
    patterns: ["客服接待1", "客服接待-1", "客服接待 1", "客服接待", "客服-文字"],
    type: 0
  },
  SUPPORT2_CHANNEL: {
    env: ["DISCORD_SUPPORT2_CHANNEL_ID"],
    patterns: ["客服接待2", "客服接待-2", "客服接待 2"],
    type: 0
  },
  SUPPORT_CHANNEL: {
    env: ["DISCORD_SUPPORT_CHANNEL_ID"],
    patterns: ["客服接待1", "客服接待-1", "客服接待 1", "客服接待", "客服-文字"],
    type: 0
  },
  ORDER_CHANNEL: {
    env: ["DISCORD_ORDER_CHANNEL_ID"],
    patterns: ["点单", "自助下单"],
    type: 0
  },
  EXAM_CHANNEL: {
    env: ["DISCORD_EXAM_CHANNEL_ID", "DISCORD_EXAM_RULES_CHANNEL_ID"],
    patterns: ["考核标准", "考核入职须知", "考核"],
    type: 0
  },
  TAG_CHANNEL: {
    env: ["DISCORD_TAG_CHANNEL_ID"],
    patterns: ["tag登记", "tag-登记", "技能登记"],
    type: 0
  },
  VIOLATION_CHANNEL: {
    env: ["DISCORD_VIOLATION_CHANNEL_ID", "DISCORD_COMPLAINT_CHANNEL_ID"],
    patterns: ["违规处理", "投诉处理", "投诉"],
    type: 0
  }
};

async function runDiscordOptimize() {
  const env = loadProjectEnv();
  const token = requireAny(env, ["DISCORD_BOT_TOKEN", "DISCORD_TOKEN"], "Discord bot token");
  const guildId = requireAny(env, ["DISCORD_GUILD_ID"], "DISCORD_GUILD_ID");

  console.log(`Discord guild: ${guildId}`);
  let channels = await getGuildChannels(token, guildId);
  const channelMap = mapByLowerName(channels);
  const roles = await getGuildRoles(token, guildId);
  const roleMap = mapByLowerName(roles);
  const everyoneId = roleMap["@everyone"]?.id || guildId;
  const botUser = await discordGet(token, "/users/@me");
  const botId = String(botUser?.id || "");

  await hideInternalChannels(token, channelMap, everyoneId);
  await renameWelcomeChannel(token, channels);
  await renameSupportTextChannel(token, channels);

  channels = await getGuildChannels(token, guildId);
  await reorderTextChannels(token, guildId, channels);

  channels = await getGuildChannels(token, guildId);
  const channelIds = buildChannelIds(env, channels);
  const examChannelId = channelIds.EXAM_CHANNEL;
  const violationChannelId = channelIds.VIOLATION_CHANNEL;
  const introChannelId = resolveChannelId(env, channels, {
    env: ["DISCORD_WELCOME_CHANNEL_ID", "DISCORD_STORE_NAV_CHANNEL_ID"],
    patterns: ["频道简介", "店内导航", "频道导航", "welcome"],
    type: 0
  });

  await upsertDiscordMessage(token, examChannelId, botId, EXAM_RULES_MARKER, EXAM_RULES_CONTENT, "考核标准消息");
  await upsertDiscordMessage(token, violationChannelId, botId, VIOLATION_RULES_MARKER, VIOLATION_RULES_CONTENT, "违规处理消息");
  await upsertDiscordMessage(
    token,
    introChannelId,
    botId,
    CONTENT.INTRO_COMPANION.marker,
    renderTemplate(CONTENT.INTRO_COMPANION.discord, "discord", channelIds),
    "陪玩入驻入口消息"
  );
}

async function getGuildChannels(token, guildId) {
  const channels = await discordGet(token, `/guilds/${guildId}/channels`);
  return Array.isArray(channels) ? channels : [];
}

async function getGuildRoles(token, guildId) {
  const roles = await discordGet(token, `/guilds/${guildId}/roles`);
  return Array.isArray(roles) ? roles : [];
}

function mapByLowerName(items) {
  return Object.fromEntries(items.map((item) => [String(item.name || "").toLowerCase(), item]));
}

async function hideInternalChannels(token, channelMap, everyoneId) {
  for (const name of ["我帅得要命，真的", "施工"]) {
    const channel = channelMap[name.toLowerCase()];
    if (!channel) {
      console.log(`- 未找到内部频道，跳过隐藏：${name}`);
      continue;
    }

    await discordPut(token, `/channels/${channel.id}/permissions/${everyoneId}`, {
      allow: "0",
      deny: "1024",
      type: 0
    });
    console.log(`✓ 已隐藏：${channel.name}`);
  }
}

async function renameWelcomeChannel(token, channels) {
  if (findExactChannel(channels, "频道简介", 0)) {
    console.log("✓ 频道简介已存在");
  }

  const welcome = findExactChannel(channels, "welcome", 0);
  if (!welcome) {
    console.log("- 未找到 welcome 文字频道，跳过重命名");
    return;
  }

  await discordPatch(token, `/channels/${welcome.id}`, { name: "频道简介" });
  console.log("✓ 已重命名：welcome → 频道简介");
}

async function renameSupportTextChannel(token, channels) {
  if (findExactChannel(channels, "客服-文字", 0)) {
    console.log("✓ 客服-文字已存在");
    return;
  }

  const support = findExactChannel(channels, "客服", 0);
  if (!support) {
    console.log("- 未找到名为 客服 的文字频道，跳过重命名");
    return;
  }

  await discordPatch(token, `/channels/${support.id}`, { name: "客服-文字" });
  console.log("✓ 已重命名：客服 → 客服-文字");
}

async function reorderTextChannels(token, guildId, channels) {
  const category = findExactChannel(channels, "Text Channels", 4);
  if (!category) {
    console.log("- 未找到 Text Channels 分类，跳过频道排序");
    return;
  }

  const targets = [
    findChannel(channels, ["频道简介", "welcome"], 0),
    findChannel(channels, ["公告", "公告通知"], 0),
    findChannel(channels, ["服务价目", "服务项目"], 0),
    findChannel(channels, ["好评展示", "好评"], 0),
    findChannel(channels, ["聊天大厅", "文字聊天区"], 0)
  ].filter(Boolean);

  const seen = new Set();
  const body = targets
    .filter((channel) => {
      if (seen.has(channel.id)) return false;
      seen.add(channel.id);
      return true;
    })
    .map((channel, position) => ({
      id: channel.id,
      position,
      parent_id: category.id
    }));

  if (!body.length) {
    console.log("- Text Channels 下目标频道均未找到，跳过排序");
    return;
  }

  await discordPatch(token, `/guilds/${guildId}/channels`, body);
  console.log(`✓ 已调整 Text Channels 顺序：${body.length} 个频道`);
}

async function upsertDiscordMessage(token, channelId, botId, markerText, content, label) {
  if (!channelId) {
    console.log(`⚠️ ${label}频道未找到，跳过`);
    return;
  }

  const messages = await discordGetMessages(token, channelId, 50);
  const target = Array.isArray(messages)
    ? messages.find((message) => String(message.content || "").includes(markerText))
    : undefined;

  if (target && String(target.author?.id || "") !== botId) {
    console.log(`⚠️ ${label}由人工发布，跳过自动更新`);
    return;
  }

  if (target) {
    if (String(target.content || "") === content) {
      console.log(`✓ ${label}已正确，跳过更新`);
      return;
    }
    await discordEditMessage(token, channelId, target.id, content);
    console.log(`✓ 已更新${label}`);
    return;
  }

  await discordPost(token, `/channels/${channelId}/messages`, { content });
  console.log(`✓ 已发布${label}`);
}

function buildChannelIds(env, channels) {
  return Object.fromEntries(
    Object.entries(CHANNEL_PLACEHOLDERS).map(([key, config]) => [key, resolveChannelId(env, channels, config)])
  );
}

function resolveChannelId(env, channels, config) {
  const fromEnv = config.env?.map((name) => env[name]).find(Boolean);
  if (fromEnv) return fromEnv;
  return findChannel(channels, config.patterns, config.type)?.id;
}

function findExactChannel(channels, name, type) {
  const expected = normalizeName(name);
  return channels.find((channel) => {
    if (type !== undefined && Number(channel.type) !== type) return false;
    return normalizeName(channel.name) === expected;
  });
}

module.exports = {
  runDiscordOptimize
};

if (require.main === module) {
  runDiscordOptimize().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
