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
const VIOLATION_RULES_MARKER = "May猫饼电竞 · 违规处理制度";
const NAV_CATEGORY_NAME = "May猫饼｜频道导航";
const VOICE_CATEGORY_NAME = "May猫饼｜语音服务";
const NAV_CATEGORY_PATTERNS = [NAV_CATEGORY_NAME, "May猫饼 · 频道导航", "频道导航", "Text Channels"];
const VOICE_CATEGORY_PATTERNS = [VOICE_CATEGORY_NAME, "May猫饼 · 语音服务", "语音服务", "Voice Channels"];

const NAV_CHANNEL_RENAMES = [
  { target: "🗺️｜频道简介", type: 0, patterns: ["频道简介", "店内导航", "频道导航", "welcome"] },
  { target: "📣｜公告通知", type: 0, patterns: ["公告通知", "公告"] },
  { target: "📝｜自助下单", type: 0, patterns: ["自助下单", "点单"] },
  { target: "📋｜服务价目", type: 0, patterns: ["服务价目", "服务项目", "服务份目"] },
  { target: "🎮｜陪玩预览", type: 15, patterns: ["陪玩预览", "查看陪玩", "陪玩大厅"] },
  { target: "⭐｜好评展示", type: 0, patterns: ["好评展示", "好评"] },
  { target: "🍏｜社区守则", type: 0, patterns: ["社区守则", "社区规则"] },
  { target: "💰｜价格清单", type: 15, patterns: ["价格清单"] }
];

const EXAM_RULES_CONTENT = `## 📋 May猫饼电竞 · 陪玩考核标准

━━━━━━ 基本要求 ━━━━━━

▸ 年满 18 岁，有稳定游戏时间
▸ 普通话清晰，无严重口音 / 噪音环境
▸ 至少一款支持游戏达到中高段位
▸ 性格稳定、不易情绪化，懂照顾客户情绪
▸ 有耐心，能接受不同游戏水平的客户

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
  await normalizeLayoutCategories(token, channels);
  await normalizeNavigationChannelNames(token, channels);

  channels = await getGuildChannels(token, guildId);
  await reorderDiscordLayout(token, guildId, channels);

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

async function normalizeLayoutCategories(token, channels) {
  if (findExactChannel(channels, NAV_CATEGORY_NAME, 4)) {
    console.log(`✓ ${NAV_CATEGORY_NAME} 分类已存在`);
  } else {
    const navCategory = findChannel(channels, NAV_CATEGORY_PATTERNS, 4);
    if (navCategory) {
      await discordPatch(token, `/channels/${navCategory.id}`, { name: NAV_CATEGORY_NAME });
      console.log(`✓ 已重命名分类：${navCategory.name} → ${NAV_CATEGORY_NAME}`);
    } else {
      console.log(`- 未找到 ${NAV_CATEGORY_NAME} 分类，跳过分类重命名`);
    }
  }

  if (findExactChannel(channels, VOICE_CATEGORY_NAME, 4)) {
    console.log(`✓ ${VOICE_CATEGORY_NAME} 分类已存在`);
    return;
  }

  const voiceChannels = findChannel(channels, VOICE_CATEGORY_PATTERNS, 4);
  if (!voiceChannels) {
    console.log(`- 未找到 ${VOICE_CATEGORY_NAME} 分类，跳过语音分类重命名`);
    return;
  }

  await discordPatch(token, `/channels/${voiceChannels.id}`, { name: VOICE_CATEGORY_NAME });
  console.log(`✓ 已重命名分类：${voiceChannels.name} → ${VOICE_CATEGORY_NAME}`);
}

async function normalizeNavigationChannelNames(token, channels) {
  for (const mapping of NAV_CHANNEL_RENAMES) {
    const channel = findChannel(channels, mapping.patterns, mapping.type);
    if (!channel || channel.name === mapping.target) continue;
    const oldName = channel.name;
    await discordPatch(token, `/channels/${channel.id}`, { name: mapping.target });
    console.log(`✓ 已规范频道名：${oldName} → ${mapping.target}`);
  }
}

async function reorderDiscordLayout(token, guildId, channels) {
  await reorderCategories(token, guildId, channels);
  const refreshedChannels = await getGuildChannels(token, guildId);
  await reorderNavigationChannels(token, guildId, refreshedChannels);
  await reorderExamChannels(token, guildId, refreshedChannels);
}

async function reorderCategories(token, guildId, channels) {
  const desiredCategories = [
    NAV_CATEGORY_PATTERNS,
    ["✦ 欢迎来到 May猫饼 ✦", "欢迎来到May猫饼", "欢迎来到"],
    ["☎ 客服接待大厅 ☎", "客服接待大厅"],
    ["员工守则"],
    ["🧾 考核专区", "考核专区"],
    VOICE_CATEGORY_PATTERNS,
    ["May猫饼｜陪玩派单", "陪玩派单"]
  ];

  const seen = new Set();
  const body = desiredCategories
    .map((patterns) => findChannel(channels, patterns, 4))
    .filter(Boolean)
    .filter((category) => {
      if (seen.has(category.id)) return false;
      seen.add(category.id);
      return true;
    })
    .map((category, position) => ({
      id: category.id,
      position
    }));

  if (!body.length) {
    console.log("- 未找到可排序分类，跳过分类排序");
    return;
  }

  await discordPatch(token, `/guilds/${guildId}/channels`, body);
  console.log(`✓ 已调整分类顺序：${body.length} 个分类`);
}

async function reorderNavigationChannels(token, guildId, channels) {
  const category = findChannel(channels, NAV_CATEGORY_PATTERNS, 4);
  if (!category) {
    console.log(`- 未找到 ${NAV_CATEGORY_NAME} 分类，跳过频道排序`);
    return;
  }

  const targets = [
    findChannel(channels, ["频道简介", "welcome"], 0),
    findChannel(channels, ["公告", "公告通知"], 0),
    findChannel(channels, ["点单", "自助下单"], 0),
    findChannel(channels, ["服务价目", "服务项目"], 0),
    findChannel(channels, ["陪玩预览", "查看陪玩", "陪玩大厅"], 15),
    findChannel(channels, ["好评展示", "好评"], 0),
    findChannel(channels, ["社区守则", "社区规则"], 0),
    findChannel(channels, ["价格清单"], 15),
    findChannel(channels, ["聊天大厅", "文字聊天区"], 0)
  ].filter(Boolean);

  const seen = new Set();
  const body = targets
    .filter((channel) => {
      if (seen.has(channel.id)) return false;
      seen.add(channel.id);
      return true;
    })
    .map((channel, position) => ({ channel, position }));

  if (!body.length) {
    console.log(`- ${NAV_CATEGORY_NAME} 下目标频道均未找到，跳过排序`);
    return;
  }

  for (const item of body) {
    if (item.channel.parent_id === category.id) continue;
    await discordPatch(token, `/channels/${item.channel.id}`, { parent_id: category.id });
    console.log(`✓ 已移动到 ${NAV_CATEGORY_NAME}：${item.channel.name}`);
  }

  await discordPatch(
    token,
    `/guilds/${guildId}/channels`,
    body.map((item) => ({
      id: item.channel.id,
      position: item.position
    }))
  );
  console.log(`✓ 已调整 ${NAV_CATEGORY_NAME} 顺序：${body.length} 个频道`);
}

async function reorderExamChannels(token, guildId, channels) {
  const category = findChannel(channels, ["🧾 考核专区", "考核专区"], 4);
  if (!category) {
    console.log("- 未找到考核专区分类，跳过考核频道排序");
    return;
  }

  const targets = [
    findChannel(channels, ["考核入职须知", "入职须知"], 0),
    findChannel(channels, ["tag-登记", "tag登记", "技能登记"], 0),
    findChannel(channels, ["试音大厅"], 0),
    findChannel(channels, ["考核一厅"], 2),
    findChannel(channels, ["考核二厅"], 2),
    findChannel(channels, ["考核三厅"], 2),
    findChannel(channels, ["考核四厅"], 2),
    findChannel(channels, ["考核五厅"], 2),
    findChannel(channels, ["考核六厅"], 2)
  ].filter(Boolean);

  const seen = new Set();
  const body = targets
    .filter((channel) => {
      if (seen.has(channel.id)) return false;
      seen.add(channel.id);
      return true;
    })
    .map((channel, position) => ({ channel, position }));

  if (!body.length) {
    console.log("- 考核专区下目标频道均未找到，跳过排序");
    return;
  }

  for (const item of body) {
    if (item.channel.parent_id === category.id) continue;
    await discordPatch(token, `/channels/${item.channel.id}`, { parent_id: category.id });
    console.log(`✓ 已移动到考核专区：${item.channel.name}`);
  }

  await discordPatch(
    token,
    `/guilds/${guildId}/channels`,
    body.map((item) => ({
      id: item.channel.id,
      position: item.position
    }))
  );
  console.log(`✓ 已调整考核专区顺序：${body.length} 个频道`);
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
