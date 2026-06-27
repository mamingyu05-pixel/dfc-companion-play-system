const { CONTENT, renderTemplate } = require("./content");
const { findChannel, kookGet, kookPostIfNotExists, loadProjectEnv, requireAny } = require("./utils");

const CHANNEL_PLACEHOLDERS = {
  ANNOUNCE_CHANNEL: {
    env: ["KOOK_ANNOUNCE_CHANNEL_ID"],
    patterns: ["最新活动", "公告通知", "公告", "通知"],
    type: 1
  },
  SERVICE_CHANNEL: {
    env: ["KOOK_SERVICE_CHANNEL_ID"],
    patterns: ["服务价目", "价目", "服务项目"],
    type: 1
  },
  RECHARGE_CHANNEL: {
    env: ["KOOK_RECHARGE_CHANNEL_ID"],
    patterns: ["充值报码", "充值方式", "充值审核", "充值"],
    type: 1
  },
  COMPANION_CHANNEL: {
    env: ["KOOK_COMPANION_CHANNEL_ID"],
    patterns: ["陪玩预览", "查看陪玩", "陪玩大厅", "陪玩"],
    type: 1
  },
  REVIEW_CHANNEL: {
    env: ["KOOK_REVIEW_CHANNEL_ID"],
    patterns: ["好评展示", "好评"],
    type: 1
  },
  CHAT_CHANNEL: {
    env: ["KOOK_CHAT_CHANNEL_ID"],
    patterns: ["文字聊天区", "聊天大厅", "游戏id", "闲聊"],
    type: 1
  },
  SUPPORT_CHANNEL: {
    env: ["KOOK_SUPPORT_CHANNEL_ID"],
    patterns: ["客服接待1", "客服接待-1", "客服接待 1", "客服接待"],
    type: 1
  },
  ORDER_CHANNEL: {
    env: ["KOOK_ORDER_CHANNEL_ID"],
    patterns: ["点单", "自助下单"],
    type: 1
  },
  EXAM_CHANNEL: {
    env: ["KOOK_EXAM_CHANNEL_ID"],
    patterns: ["考核入职须知", "考核"],
    type: 1
  },
  TAG_CHANNEL: {
    env: ["KOOK_TAG_CHANNEL_ID"],
    patterns: ["tag登记", "tag-登记", "技能登记"],
    type: 1
  }
};

async function runKookSetup() {
  const env = loadProjectEnv();
  const token = requireAny(env, ["KOOK_TOKEN"], "KOOK_TOKEN");
  const guildId = requireAny(env, ["KOOK_GUILD_ID"], "KOOK_GUILD_ID");

  console.log(`KOOK guild: ${guildId}`);
  const channels = await listChannels(token, guildId);
  const channelIds = buildChannelIds(env, channels);
  logChannelIds("KOOK channel map", channelIds);

  const introTarget =
    findChannel(channels, ["频道简介", "welcome", "店内导航", "频道导航", "欢迎"], 1)?.id ||
    channelIds.SUPPORT_CHANNEL;
  const dispatchTarget = env.KOOK_DISPATCH_CHANNEL_ID || env.KOOK_AI_DISPATCH_CHANNEL_ID || findChannel(channels, ["人工派单"], 1)?.id;
  const orderTarget = channelIds.ORDER_CHANNEL || channelIds.SUPPORT_CHANNEL;
  const serviceTarget = channelIds.SERVICE_CHANNEL;

  await kookPostIfNotExists(token, introTarget, renderTemplate(CONTENT.INTRO_CUSTOMER.kook, "kook", channelIds), CONTENT.INTRO_CUSTOMER.marker);
  await kookPostIfNotExists(token, introTarget, renderTemplate(CONTENT.INTRO_COMPANION.kook, "kook", channelIds), CONTENT.INTRO_COMPANION.marker);
  await kookPostIfNotExists(token, introTarget, renderTemplate(CONTENT.INTRO_OFFICIAL.kook, "kook", channelIds), CONTENT.INTRO_OFFICIAL.marker);
  await kookPostIfNotExists(token, orderTarget, renderTemplate(CONTENT.ORDER_FORMAT.kook, "kook", channelIds), CONTENT.ORDER_FORMAT.marker);
  await kookPostIfNotExists(token, dispatchTarget, renderTemplate(CONTENT.DISPATCH_RULES.kook, "kook", channelIds), CONTENT.DISPATCH_RULES.marker);

  if (serviceTarget) {
    await kookPostIfNotExists(token, serviceTarget, renderTemplate(CONTENT.SERVICE_ITEMS.kook, "kook", channelIds), CONTENT.SERVICE_ITEMS.marker);
  } else {
    console.log("skip KOOK service items: KOOK_SERVICE_CHANNEL_ID / 服务价目 channel not found");
  }
}

async function listChannels(token, guildId) {
  const firstPage = await kookGet(token, `/channel/list?guild_id=${encodeURIComponent(guildId)}&page=1&page_size=50`);
  const items = Array.isArray(firstPage?.items) ? [...firstPage.items] : [];
  const pageTotal = Number(firstPage?.meta?.page_total || 1);

  for (let page = 2; page <= pageTotal; page += 1) {
    const data = await kookGet(token, `/channel/list?guild_id=${encodeURIComponent(guildId)}&page=${page}&page_size=50`);
    if (Array.isArray(data?.items)) items.push(...data.items);
  }

  return items.map((item) => ({
    id: String(item.id),
    name: String(item.name),
    type: Number(item.type)
  }));
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
  runKookSetup
};

if (require.main === module) {
  runKookSetup().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
