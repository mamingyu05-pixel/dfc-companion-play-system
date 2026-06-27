const path = require("node:path");
const { CONTENT, renderTemplate } = require("../lib/content");
const { discordDelete, discordGetMessages, discordPost, discordPostImage, sleep } = require("../lib/utils");
const {
  buildChannelIds,
  findChannel,
  getBotId,
  getDiscordEnv,
  getGuildChannels
} = require("./shared");

const INTRO_MESSAGES = [
  { image: "banner1-customer.png" },
  { contentKey: "INTRO_CUSTOMER" },
  { image: "banner2-companion.png" },
  { contentKey: "INTRO_COMPANION" },
  { image: "banner3-official.png" },
  { contentKey: "INTRO_OFFICIAL" }
];

async function resetIntro() {
  const { env, token, guildId } = getDiscordEnv();
  const channels = await getGuildChannels(token, guildId);
  const introChannel = findChannel(channels, ["频道简介", "店内导航", "welcome"], 0);
  if (!introChannel) throw new Error("未找到 Discord 频道简介频道");

  const botId = await getBotId(token);
  const channelIds = buildChannelIds(env, channels);

  await deleteBotIntroMessages(token, introChannel.id, botId);
  await publishIntroMessages(token, introChannel.id, channelIds);
}

async function deleteBotIntroMessages(token, channelId, botId) {
  const messages = await discordGetMessages(token, channelId, 100);
  const botMessages = messages.filter((message) => String(message.author?.id || "") === botId);

  if (!botMessages.length) {
    console.log("✓ 频道简介无 Bot 旧消息需要删除");
    return;
  }

  for (const message of botMessages) {
    await discordDelete(token, `/channels/${channelId}/messages/${message.id}`);
    await sleep(400);
  }
  console.log(`✓ 已删除频道简介 Bot 旧消息：${botMessages.length} 条`);
}

async function publishIntroMessages(token, channelId, channelIds) {
  for (const item of INTRO_MESSAGES) {
    if (item.image) {
      const imagePath = path.join(__dirname, "..", "banners", item.image);
      await discordPostImage(token, channelId, imagePath, null);
      console.log(`✓ 已发送频道简介横幅：${item.image}`);
    } else {
      const content = renderTemplate(CONTENT[item.contentKey].discord, "discord", channelIds);
      await discordPost(token, `/channels/${channelId}/messages`, { content });
      console.log(`✓ 已发送频道简介文案：${CONTENT[item.contentKey].marker}`);
    }
    await sleep(600);
  }
}

module.exports = {
  resetIntro
};
