const { CONTENT, renderTemplate } = require("../lib/content");
const {
  findChannel,
  kookEditMessage,
  kookGet,
  kookGetMessages,
  kookPost,
  loadProjectEnv,
  requireAny
} = require("../lib/utils");
const { runKookOptimize } = require("../optimize-kook");

async function syncKook() {
  await runKookOptimize();

  const env = loadProjectEnv();
  const token = requireAny(env, ["KOOK_TOKEN"], "KOOK_TOKEN");
  const guildId = requireAny(env, ["KOOK_GUILD_ID"], "KOOK_GUILD_ID");
  const botUser = await kookGet(token, "/user/me");
  const botId = String(botUser?.id || botUser?.user_id || "");
  const channels = await listKookChannels(token, guildId);
  const channelIds = buildKookChannelIds(env, channels);

  const supportChannelId = env.KOOK_SUPPORT_CHANNEL_ID || findChannel(channels, ["客服接待", "客服"], 1)?.id;
  const dispatchChannelId =
    env.KOOK_DISPATCH_CHANNEL_ID || env.KOOK_AI_DISPATCH_CHANNEL_ID || findChannel(channels, ["人工派单", "AI派单"], 1)?.id;

  await upsertKookMessage(
    token,
    supportChannelId,
    botId,
    CONTENT.INTRO_CUSTOMER.marker,
    [
      renderTemplate(CONTENT.INTRO_CUSTOMER.kook, "kook", channelIds),
      renderTemplate(CONTENT.INTRO_OFFICIAL.kook, "kook", channelIds)
    ].join("\n\n---\n\n"),
    "KOOK 客服导航消息"
  );
  await upsertKookMessage(
    token,
    dispatchChannelId,
    botId,
    CONTENT.DISPATCH_RULES.marker,
    renderTemplate(CONTENT.DISPATCH_RULES.kook, "kook", channelIds),
    "KOOK 派单规则消息"
  );
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

function buildKookChannelIds(env, channels) {
  return {
    ANNOUNCE_CHANNEL: env.KOOK_ANNOUNCE_CHANNEL_ID || findChannel(channels, ["公告通知", "公告"], 1)?.id,
    SERVICE_CHANNEL: env.KOOK_SERVICE_CHANNEL_ID || findChannel(channels, ["服务价目"], 1)?.id,
    RECHARGE_CHANNEL: env.KOOK_RECHARGE_CHANNEL_ID || findChannel(channels, ["充值方式", "充值"], 1)?.id,
    COMPANION_CHANNEL: env.KOOK_COMPANION_CHANNEL_ID || findChannel(channels, ["陪玩预览", "陪玩"], 1)?.id,
    REVIEW_CHANNEL: env.KOOK_REVIEW_CHANNEL_ID || findChannel(channels, ["好评展示", "好评"], 1)?.id,
    CHAT_CHANNEL: env.KOOK_CHAT_CHANNEL_ID || findChannel(channels, ["聊天大厅", "文字聊天"], 1)?.id,
    SUPPORT_CHANNEL: env.KOOK_SUPPORT_CHANNEL_ID || findChannel(channels, ["客服接待", "客服"], 1)?.id,
    ORDER_CHANNEL: env.KOOK_ORDER_CHANNEL_ID || findChannel(channels, ["自助下单", "点单"], 1)?.id,
    EXAM_CHANNEL: env.KOOK_EXAM_CHANNEL_ID || findChannel(channels, ["考核入职须知", "考核"], 1)?.id,
    TAG_CHANNEL: env.KOOK_TAG_CHANNEL_ID || findChannel(channels, ["技能登记", "tag登记"], 1)?.id
  };
}

async function upsertKookMessage(token, channelId, botId, markerText, content, label) {
  if (!channelId) {
    console.log(`⚠️ ${label}频道未找到，跳过`);
    return;
  }

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

module.exports = {
  syncKook
};
