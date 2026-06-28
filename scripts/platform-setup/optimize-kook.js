const {
  findChannel,
  kookEditMessage,
  kookGet,
  kookGetMessages,
  kookPost,
  loadProjectEnv,
  normalizeName,
  requireAny
} = require("./utils");

const EXAM_RULES_MARKER = "May猫饼电竞 · 陪玩考核标准";

const KOOK_EXAM_RULES_CONTENT = `**📋 May猫饼电竞 · 陪玩考核标准**

━━━━━━ 基本要求 ━━━━━━

▸ 年满 18 岁，有稳定游戏时间
▸ 普通话清晰，无严重口音 / 噪音环境
▸ 至少一款支持游戏达到中高段位
▸ 性格稳定、不易情绪化，懂照顾客户情绪
▸ 有耐心，能接受不同游戏水平的客户

━━━━━━ 考核流程 ━━━━━━

① 填写入职申请（见 考核入职须知）
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

async function runKookOptimize() {
  const env = loadProjectEnv();
  const token = requireAny(env, ["KOOK_TOKEN"], "KOOK_TOKEN");
  const guildId = requireAny(env, ["KOOK_GUILD_ID"], "KOOK_GUILD_ID");
  const botUser = await kookGet(token, "/user/me");
  const botId = String(botUser?.id || botUser?.user_id || "");

  console.log(`KOOK guild: ${guildId}`);
  let channels = await listKookChannels(token, guildId);
  await fixServiceChannelTypo(token, channels);

  channels = await listKookChannels(token, guildId);
  await fixStoreNavigationOrderLink(token, env, channels, botId);
  await syncKookExamNotice(token, env, channels, botId);
}

async function listKookChannels(token, guildId) {
  const firstPage = await kookGet(token, `/channel/list?guild_id=${encodeURIComponent(guildId)}&page=1&page_size=100`);
  const items = Array.isArray(firstPage?.items) ? [...firstPage.items] : [];
  const pageTotal = Number(firstPage?.meta?.page_total || 1);

  for (let page = 2; page <= pageTotal; page += 1) {
    const data = await kookGet(token, `/channel/list?guild_id=${encodeURIComponent(guildId)}&page=${page}&page_size=100`);
    if (Array.isArray(data?.items)) items.push(...data.items);
  }

  return items.map((item) => ({
    ...item,
    id: String(item.id),
    name: String(item.name || ""),
    type: Number(item.type)
  }));
}

async function fixServiceChannelTypo(token, channels) {
  if (findExactChannel(channels, "服务价目", 1)) {
    console.log("✓ 频道名已正确：服务价目");
    return;
  }

  const typoChannel = findExactChannel(channels, "服务份目", 1);
  if (!typoChannel) {
    console.log("- 未找到 服务份目 频道，跳过错字修正");
    return;
  }

  await kookPost(token, "/channel/update", {
    channel_id: typoChannel.id,
    name: "服务价目"
  });
  console.log("✓ 已修正频道名：服务份目 → 服务价目");
}

async function fixStoreNavigationOrderLink(token, env, channels, botId) {
  const storeNavChannelId =
    env.KOOK_STORE_NAV_CHANNEL_ID || findChannel(channels, ["店内导航", "频道简介", "频道导航", "welcome"], 1)?.id;
  if (!storeNavChannelId) {
    console.log("⚠️ 未找到 KOOK 店内导航频道，请检查 KOOK_STORE_NAV_CHANNEL_ID");
    return;
  }

  const messages = await kookGetMessages(token, storeNavChannelId, 50);
  const targetMessage = messages.find((message) => String(message.content || "").includes("自助下单"));
  if (!targetMessage) {
    console.log('⚠️ 未找到含"自助下单"的消息，请检查 KOOK_STORE_NAV_CHANNEL_ID 是否正确');
    return;
  }

  if (getKookAuthorId(targetMessage) !== botId) {
    console.log(`店内导航当前消息内容：\n${targetMessage.content || ""}`);
    console.log('⚠️ 店内导航由人工发布，请手动将"自助下单"的链接改为 AI派单频道');
    return;
  }

  const targetChannelId = resolveOrderTargetChannelId(env, channels);
  if (!targetChannelId) {
    console.log("⚠️ 未找到 AI派单或客服接待频道，跳过店内导航链接修正");
    return;
  }

  const wrongDispatchId = env.KOOK_DISPATCH_CHANNEL_ID || findChannel(channels, ["人工派单"], 1)?.id;
  const nextContent = fixSelfOrderLine(String(targetMessage.content || ""), targetChannelId, wrongDispatchId);
  if (nextContent === String(targetMessage.content || "")) {
    console.log("✓ 店内导航自助下单链接已正确");
    return;
  }

  await kookEditMessage(token, getKookMessageId(targetMessage), nextContent);
  console.log("✓ 已修正店内导航自助下单链接");
}

function resolveOrderTargetChannelId(env, channels) {
  return (
    env.KOOK_AI_DISPATCH_CHANNEL_ID ||
    findChannel(channels, ["AI派单", "ai-派单", "ai派单"], 1)?.id ||
    env.KOOK_SUPPORT_CHANNEL_ID ||
    findChannel(channels, ["客服接待", "客服-文字", "客服"], 1)?.id
  );
}

function fixSelfOrderLine(content, targetChannelId, wrongDispatchId) {
  const targetMention = `(chn)${targetChannelId}(chn)`;
  let next = content;
  if (wrongDispatchId) {
    next = next.replaceAll(`(chn)${wrongDispatchId}(chn)`, targetMention);
  }

  return next
    .split(/\r?\n/)
    .map((line) => {
      if (!line.includes("自助下单")) return line;
      if (line.includes(targetMention)) return line;
      return line.replace(/(自助下单)\s*(?:[→:：\-—>]+\s*)?.*$/, `$1   → ${targetMention}`);
    })
    .join("\n");
}

async function syncKookExamNotice(token, env, channels, botId) {
  const channelId =
    env.KOOK_EXAM_CHANNEL_ID || findChannel(channels, ["考核须知", "考核入职须知", "考核标准"], 1)?.id;
  if (!channelId) {
    console.log("- KOOK 未找到考核须知频道，跳过可选同步");
    return;
  }

  await upsertKookMessage(token, channelId, botId, EXAM_RULES_MARKER, KOOK_EXAM_RULES_CONTENT, "KOOK 考核须知消息");
}

async function upsertKookMessage(token, channelId, botId, markerText, content, label) {
  const messages = await kookGetMessages(token, channelId, 50);
  const target = messages.find((message) => String(message.content || "").includes(markerText));

  if (target && getKookAuthorId(target) !== botId) {
    console.log(`⚠️ ${label}由人工发布，跳过自动更新`);
    return;
  }

  if (target) {
    if (String(target.content || "") === content) {
      console.log(`✓ ${label}已正确，跳过更新`);
      return;
    }
    await kookEditMessage(token, getKookMessageId(target), content);
    console.log(`✓ 已更新${label}`);
    return;
  }

  await kookPost(token, "/message/create", {
    type: 9,
    target_id: channelId,
    content
  });
  console.log(`✓ 已发布${label}`);
}

function getKookAuthorId(message) {
  return String(message.author_id || message.author?.id || message.user_id || message.user?.id || "");
}

function getKookMessageId(message) {
  return String(message.msg_id || message.id || "");
}

function findExactChannel(channels, name, type) {
  const expected = normalizeName(name);
  return channels.find((channel) => {
    if (type !== undefined && Number(channel.type) !== type) return false;
    return normalizeName(channel.name) === expected;
  });
}

module.exports = {
  runKookOptimize
};

if (require.main === module) {
  runKookOptimize().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
