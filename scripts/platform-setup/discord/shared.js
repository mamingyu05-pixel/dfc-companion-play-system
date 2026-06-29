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
const VIOLATION_RULES_MARKER = "违规处理制度";

const EXAM_RULES_CONTENT = `## 📋 May猫饼电竞 · 陪玩考核标准

━━━━━━ 基本要求 ━━━━━━

▸ 年满 18 岁，有稳定游戏时间
▸ 普通话清晰，无严重口音 / 噪音环境
▸ 至少一款支持游戏达到中高段位
▸ 性格稳定、不易情绪化，懂照顾客户情绪
▸ 有耐心，能接受不同水平的客户

━━━━━━ 考核流程 ━━━━━━

① 填写入职申请（见 #考核入职须知）
② 管理员安排试音，确认声线和沟通风格
③ 试玩一局，确认游戏水平
④ 通过后开通账号并上架网站
⑤ 开始接单

━━━━━━ 游戏考核细则（三角洲）━━━━━━
※ 考核环境禁网咖 / 电竞房；外挂异常对局不计；考核期间不允许接暗号；其余由考核官视情况而定
· 单考：允许六套、AW；3 取 2 择优（击杀）；击杀数 12 / 14 / 16 / 18
· 双考：用五套装备，不可六套 / AW（黑屋局视情况、成功需标注）；击杀+撤离 1 局 1000W（3 取 2）择优；击杀数 15 / 17 / 19 / 21；人头差 ≤ 3
（哈吉米=小哈 / 中哈 / 大哈 / 魔王哈，为段位档位称呼）

━━━━━━ 通过后处理 ━━━━━━
① 进押金查挂群（3 天内）② 进店规服务培训群（3 天内）③ 开始培训接单 ④ 体验单每周最低 1 单

▸ 禁止私下向客户索取联系方式　▸ 禁止平台外私接
▸ 违规一次警告，二次直接下架　▸ 一切以 maycatplay.com 后台记录为准`;

const VIOLATION_RULES_CONTENT = `## ⚠️ May猫饼电竞 · 违规处理制度（周结工资制）

━━━━━━ 一级 · 警告级 ━━━━━━（累计 3 次升二级）
· 未及时提交订单 / 战绩截图；服务后未及时反馈
处罚：首次警告 → 第二次罚 20 元 → 第三次升二级

━━━━━━ 二级 · 罚款级（50~200 元）━━━━━━
· 放鸽子 / 接单后失联：50 → 100 → 清退
· 消极接单 / 无故拒单 / 长期挑单：50~100 元，严重暂停派单
· 服务态度差（与客户争吵 / 爆粗 / 嘲讽 / 甩锅）：首次 100 元，严重清退
· 虚报战绩 / 改图 / 谎报：首次 200 元，再犯永久拉黑

━━━━━━ 三级 · 清退级（扣全部工资 + 没收保证金 + 永久拉黑）━━━━━━
· 私单（绕过平台私下收钱）· 挖人（挖老板 / 打手 / 拉管理）
· 使用外挂（含借号、明知队友开挂仍长期组队）
· 恶意毁单（私藏物资 / 摆烂 / 炸队友 / 故意掉分 / 对喷致退款）

━━━━━━ 保证金 & 结算 ━━━━━━
· 工资周结；保证金用于违规扣罚，清退级没收
· 所有处罚、订单、结算均以 maycatplay.com 后台记录为准`;

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
