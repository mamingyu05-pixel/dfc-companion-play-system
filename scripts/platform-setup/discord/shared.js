const {
  discordEditMessage,
  discordGet,
  discordGetMessages,
  discordPatch,
  discordPost,
  findChannel,
  loadProjectEnv,
  normalizeName,
  requireAny
} = require("../lib/utils");

const CHANNEL_PLACEHOLDERS = {
  ANNOUNCE_CHANNEL: { env: ["DISCORD_ANNOUNCE_CHANNEL_ID"], patterns: ["公告通知", "公告"], type: 0 },
  SERVICE_CHANNEL: { env: ["DISCORD_SERVICE_CHANNEL_ID"], patterns: ["服务价目"], type: 0 },
  RECHARGE_CHANNEL: { env: ["DISCORD_RECHARGE_CHANNEL_ID"], patterns: ["充值方式", "充值报码", "充值审核"], type: 0 },
  COMPANION_CHANNEL: { env: ["DISCORD_COMPANION_CHANNEL_ID"], patterns: ["陪玩预览", "查看陪玩", "陪玩大厅"], type: 0 },
  REVIEW_CHANNEL: { env: ["DISCORD_REVIEW_CHANNEL_ID"], patterns: ["好评展示"], type: 0 },
  CHAT_CHANNEL: { env: ["DISCORD_CHAT_CHANNEL_ID"], patterns: ["聊天大厅", "文字聊天区"], type: 0 },
  SUPPORT1_CHANNEL: { env: ["DISCORD_SUPPORT_CHANNEL_ID"], patterns: ["客服接待-1-厅", "客服接待1", "客服接待"], type: 0 },
  SUPPORT2_CHANNEL: { env: ["DISCORD_SUPPORT2_CHANNEL_ID"], patterns: ["客服接待-2-厅", "客服接待2"], type: 0 },
  SUPPORT_CHANNEL: { env: ["DISCORD_SUPPORT_CHANNEL_ID"], patterns: ["客服接待-1-厅", "客服接待1", "客服接待"], type: 0 },
  ORDER_CHANNEL: { env: ["DISCORD_ORDER_CHANNEL_ID"], patterns: ["自助下单", "点单"], type: 0 },
  EXAM_CHANNEL: { env: ["DISCORD_EXAM_CHANNEL_ID"], patterns: ["考核入职须知", "考核标准"], type: 0 },
  TAG_CHANNEL: { env: ["DISCORD_TAG_CHANNEL_ID"], patterns: ["技能登记", "tag登记"], type: 0 },
  DISPATCH_CHANNEL: { env: ["DISCORD_DISPATCH_CHANNEL_ID"], patterns: ["人工派单"], type: 0 },
  AI_DISPATCH_CHANNEL: { env: ["DISCORD_AI_DISPATCH_CHANNEL_ID"], patterns: ["AI派单", "ai派单"], type: 0 },
  VIOLATION_CHANNEL: { env: ["DISCORD_VIOLATION_CHANNEL_ID"], patterns: ["违规处理"], type: 0 }
};

const EXAM_RULES_MARKER = "陪玩考核标准";
const VIOLATION_RULES_MARKER = "违规处理规则";

const EXAM_RULES_CONTENT = `## 🏕️ May猫饼电竞 · 陪玩考核标准

━━━━━━━━━━ 基本要求 ━━━━━━━━━━

▸ 年满 18 岁，有稳定的游戏时间
▸ 普通话清晰，无严重口音或噪音环境
▸ 至少一款支持游戏达到中高段位
▸ 性格稳定，懂得照顾客户情绪
▸ 有耐心，能接受不同水平的客户

━━━━━━━━━━ 考核流程 ━━━━━━━━━━

① 填写入职申请表（见考核入职须知频道）
② 管理员安排试音，确认声线和沟通风格
③ 试玩一局，确认游戏水平
④ 通过后管理员开通账号并上架网站
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

function getDiscordEnv() {
  const env = loadProjectEnv();
  return {
    env,
    token: requireAny(env, ["DISCORD_BOT_TOKEN", "DISCORD_TOKEN"], "Discord bot token"),
    guildId: requireAny(env, ["DISCORD_GUILD_ID"], "DISCORD_GUILD_ID")
  };
}

async function getGuildChannels(token, guildId) {
  const channels = await discordGet(token, `/guilds/${guildId}/channels`);
  return Array.isArray(channels) ? channels : [];
}

async function getGuildRoles(token, guildId) {
  const roles = await discordGet(token, `/guilds/${guildId}/roles`);
  return Array.isArray(roles) ? roles : [];
}

async function getBotId(token) {
  const botUser = await discordGet(token, "/users/@me");
  return String(botUser?.id || "");
}

function coreName(value) {
  return normalizeName(value);
}

function findExactChannel(channels, name, type) {
  const expected = coreName(name);
  return channels.find((channel) => {
    if (type !== undefined && Number(channel.type) !== type) return false;
    return coreName(channel.name) === expected;
  });
}

function findChannelId(env, channels, config) {
  const fromEnv = (config.env || []).map((name) => env[name]).find(Boolean);
  if (fromEnv) return fromEnv;
  return findChannel(channels, config.patterns, config.type)?.id;
}

function buildChannelIds(env, channels) {
  return Object.fromEntries(
    Object.entries(CHANNEL_PLACEHOLDERS).map(([key, config]) => [key, findChannelId(env, channels, config)])
  );
}

function hasCore(name, core) {
  return coreName(name).includes(coreName(core));
}

async function renameChannelIfNeeded(token, channel, targetName) {
  if (!channel) return false;
  if (channel.name === targetName) {
    console.log(`✓ 已正确：${targetName}`);
    return false;
  }
  if (channel.name.includes(targetName.slice(0, 2)) && hasCore(channel.name, targetName)) {
    console.log(`✓ 已带前缀，跳过：${channel.name}`);
    return false;
  }

  const oldName = channel.name;
  await discordPatch(token, `/channels/${channel.id}`, { name: targetName });
  console.log(`✓ 重命名：${oldName} → ${targetName}`);
  return true;
}

async function upsertDiscordMessage(token, channelId, botId, markerText, content, label) {
  if (!channelId) {
    console.log(`⚠️ ${label}频道未找到，跳过`);
    return { status: "missing" };
  }

  const messages = await discordGetMessages(token, channelId, 50);
  const target = messages.find((message) => String(message.content || "").includes(markerText));
  if (target && String(target.author?.id || "") !== botId) {
    console.log(`⚠️ ${label}由人工发布，跳过自动更新`);
    return { status: "manual" };
  }

  if (target) {
    if (String(target.content || "") === content) {
      console.log(`✓ ${label}已正确，跳过更新`);
      return { status: "exists" };
    }
    await discordEditMessage(token, channelId, target.id, content);
    console.log(`✓ 已更新${label}`);
    return { status: "updated" };
  }

  const message = await discordPost(token, `/channels/${channelId}/messages`, { content });
  console.log(`✓ 已发布${label}`);
  return { status: "created", id: message?.id };
}

module.exports = {
  CHANNEL_PLACEHOLDERS,
  EXAM_RULES_CONTENT,
  EXAM_RULES_MARKER,
  VIOLATION_RULES_CONTENT,
  VIOLATION_RULES_MARKER,
  buildChannelIds,
  coreName,
  findChannel,
  findChannelId,
  findExactChannel,
  getBotId,
  getDiscordEnv,
  getGuildChannels,
  getGuildRoles,
  hasCore,
  renameChannelIfNeeded,
  upsertDiscordMessage
};
