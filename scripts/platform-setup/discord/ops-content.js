const { CONTENT, renderTemplate } = require("../lib/content");
const {
  buildChannelIds,
  findChannel,
  getBotId,
  getDiscordEnv,
  getGuildChannels,
  upsertDiscordMessage
} = require("./shared");

async function publishOpsContent() {
  const { env, token, guildId } = getDiscordEnv();
  const channels = await getGuildChannels(token, guildId);
  const botId = await getBotId(token);
  const channelIds = buildChannelIds(env, channels);

  const serviceChannel = findChannel(channels, ["服务价目"], 0);
  const orderChannel = findChannel(channels, ["自助下单", "点单"], 0);
  const dispatchChannel = findChannel(channels, ["人工派单"], 0);

  await upsertDiscordMessage(
    token,
    serviceChannel?.id,
    botId,
    CONTENT.SERVICE_ITEMS.marker,
    renderTemplate(CONTENT.SERVICE_ITEMS.discord, "discord", channelIds),
    "服务价目消息"
  );
  await upsertDiscordMessage(
    token,
    orderChannel?.id,
    botId,
    CONTENT.ORDER_FORMAT.marker,
    renderTemplate(CONTENT.ORDER_FORMAT.discord, "discord", channelIds),
    "自助下单格式消息"
  );
  await upsertDiscordMessage(
    token,
    dispatchChannel?.id,
    botId,
    CONTENT.DISPATCH_RULES.marker,
    renderTemplate(CONTENT.DISPATCH_RULES.discord, "discord", channelIds),
    "人工派单规则消息"
  );
}

module.exports = {
  publishOpsContent
};
