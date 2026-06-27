const {
  EXAM_RULES_CONTENT,
  EXAM_RULES_MARKER,
  VIOLATION_RULES_CONTENT,
  VIOLATION_RULES_MARKER,
  findChannel,
  getBotId,
  getDiscordEnv,
  getGuildChannels,
  upsertDiscordMessage
} = require("./shared");

async function updateExamChannels() {
  const { token, guildId } = getDiscordEnv();
  const channels = await getGuildChannels(token, guildId);
  const botId = await getBotId(token);

  const examChannel = findChannel(channels, ["考核标准"], 0);
  const violationChannel = findChannel(channels, ["违规处理"], 0);

  await upsertDiscordMessage(token, examChannel?.id, botId, EXAM_RULES_MARKER, EXAM_RULES_CONTENT, "考核标准消息");
  await upsertDiscordMessage(
    token,
    violationChannel?.id,
    botId,
    VIOLATION_RULES_MARKER,
    VIOLATION_RULES_CONTENT,
    "违规处理消息"
  );
}

module.exports = {
  updateExamChannels
};
