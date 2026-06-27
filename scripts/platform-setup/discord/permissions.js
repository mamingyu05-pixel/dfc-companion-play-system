const { discordPut } = require("../lib/utils");
const { getDiscordEnv, getGuildChannels, getGuildRoles, hasCore } = require("./shared");

const INTERNAL_CHANNEL_CORES = ["施工", "我帅得要命真的", "我们得要命真的", "帅得要命", "要命真的"];

async function fixPermissions() {
  const { token, guildId } = getDiscordEnv();
  const channels = await getGuildChannels(token, guildId);
  const roles = await getGuildRoles(token, guildId);
  const everyoneId = roles.find((role) => role.name === "@everyone")?.id || guildId;
  const targets = channels.filter((channel) =>
    INTERNAL_CHANNEL_CORES.some((core) => hasCore(channel.name, core))
  );

  if (!targets.length) {
    console.log("✓ 未找到内部测试频道，跳过权限修正");
    return;
  }

  for (const channel of targets) {
    await discordPut(token, `/channels/${channel.id}/permissions/${everyoneId}`, {
      allow: "0",
      deny: "1024",
      type: 0
    });
    console.log(`✓ 已隐藏：${channel.name}`);
  }
}

module.exports = {
  fixPermissions
};
