const { discordPatch } = require("../lib/utils");
const {
  findChannel,
  getDiscordEnv,
  getGuildChannels,
  renameChannelIfNeeded
} = require("./shared");

const CHANNEL_RENAMES = [
  { target: "🗺️｜频道简介", type: 0, cores: ["频道简介", "welcome", "店内导航"] },
  { target: "📣｜公告通知", type: 0, cores: ["公告通知", "公告"] },
  { target: "📋｜服务价目", type: 0, cores: ["服务价目", "服务项目", "服务份目"] },
  { target: "⭐｜好评展示", type: 0, cores: ["好评展示", "好评"] },
  { target: "💬｜聊天大厅", type: 0, cores: ["聊天大厅", "文字聊天区"] },
  { target: "💳｜充值方式", type: 0, cores: ["充值方式", "充值报码"] },
  { target: "🗨️｜客服-文字", type: 0, cores: ["客服-文字", "客服"], exactOnly: true },
  { target: "📋｜考核标准", type: 0, cores: ["考核标准"] },
  { target: "⚠️｜违规处理", type: 0, cores: ["违规处理"] },
  { target: "🟥｜考核入职须知", type: 0, cores: ["考核入职须知"] },
  { target: "🔖｜技能登记", type: 0, cores: ["技能登记", "tag登记"] },
  { target: "📝｜自助下单", type: 0, cores: ["自助下单", "点单"], exactOnly: true },
  { target: "📣｜人工派单", type: 0, cores: ["人工派单"] },
  { target: "🤖｜AI派单", type: 0, cores: ["AI派单", "ai派单"] },
  { target: "🎧｜试音大厅", type: 0, cores: ["试音大厅"] },
  { target: "💬｜客服接待-1-厅", type: 0, cores: ["客服接待1厅", "客服接待-1厅"] },
  { target: "💬｜客服接待-2-厅", type: 0, cores: ["客服接待2厅", "客服接待-2厅"] }
];

const CATEGORY_RENAMES = [
  { target: "📌 May猫饼 · 客户专区", cores: ["Text Channels", "客户专区", "欢迎来到May猫饼"] },
  { target: "🧭 May猫饼 · 频道导航", cores: ["May猫饼频道导航", "频道导航"] },
  { target: "☎ May猫饼 · 客服接待", cores: ["客服接待大厅"] },
  { target: "🔧 内部 · 员工守则", cores: ["员工守则"] },
  { target: "🧾 内部 · 考核专区", cores: ["考核专区"] },
  { target: "🎙️ May猫饼 · 语音服务", cores: ["Voice Channels", "语音服务"] },
  { target: "⚡ May猫饼 · 接单大厅", cores: ["XP接单区", "陪玩派单", "接单大厅"] }
];

async function renameDiscord() {
  const { token, guildId } = getDiscordEnv();
  const channels = await getGuildChannels(token, guildId);

  for (const mapping of CATEGORY_RENAMES) {
    const channel = findRenameTarget(channels, mapping.cores, 4);
    await renameChannelIfNeeded(token, channel, mapping.target);
  }

  for (const mapping of CHANNEL_RENAMES) {
    const channel = findRenameTarget(channels, mapping.cores, mapping.type, mapping.exactOnly);
    await renameChannelIfNeeded(token, channel, mapping.target);
  }

  const refreshedChannels = await getGuildChannels(token, guildId);
  await reorderCategories(token, guildId, refreshedChannels);
  await reorderChannelsInCategory(token, guildId, refreshedChannels, "🧭 May猫饼 · 频道导航", [
    "频道简介",
    "公告通知",
    "服务价目",
    "自助下单",
    "好评展示",
    "社区守则",
    "聊天大厅"
  ]);
  await reorderChannelsInCategory(token, guildId, refreshedChannels, "🧾 内部 · 考核专区", [
    "考核入职须知",
    "技能登记",
    "试音大厅",
    "考核一厅",
    "考核二厅",
    "考核三厅",
    "考核四厅",
    "考核五厅",
    "考核六厅"
  ]);
}

function findRenameTarget(channels, cores, type, exactOnly = false) {
  const candidates = channels.filter((channel) => {
    if (Number(channel.type) !== type) return false;
    return !String(channel.name || "").startsWith("deleted-");
  });

  const exact = candidates.find((channel) => cores.some((core) => normalizeForRename(channel.name) === normalizeForRename(core)));
  if (exact || exactOnly) return exact;
  return findChannel(candidates, cores, type);
}

function normalizeForRename(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

async function reorderCategories(token, guildId, channels) {
  const desired = [
    "📌 May猫饼 · 客户专区",
    "🧭 May猫饼 · 频道导航",
    "☎ May猫饼 · 客服接待",
    "🔧 内部 · 员工守则",
    "🧾 内部 · 考核专区",
    "🎙️ May猫饼 · 语音服务",
    "⚡ May猫饼 · 接单大厅"
  ];
  const body = desired
    .map((name) => findChannel(channels, [name], 4))
    .filter(Boolean)
    .map((channel, position) => ({ id: channel.id, position }));

  if (!body.length) return;
  await discordPatch(token, `/guilds/${guildId}/channels`, body);
  console.log(`✓ 已调整分类顺序：${body.length} 个分类`);
}

async function reorderChannelsInCategory(token, guildId, channels, categoryName, orderedCores) {
  const category = findChannel(channels, [categoryName], 4);
  if (!category) return;

  const seen = new Set();
  const targets = orderedCores
    .map((core) => findChannel(channels, [core], undefined))
    .filter(Boolean)
    .filter((channel) => Number(channel.type) !== 4)
    .filter((channel) => {
      if (seen.has(channel.id)) return false;
      seen.add(channel.id);
      return true;
    });

  for (const channel of targets) {
    if (channel.parent_id !== category.id) {
      await discordPatch(token, `/channels/${channel.id}`, { parent_id: category.id });
      console.log(`✓ 已移动到 ${categoryName}：${channel.name}`);
    }
  }

  if (!targets.length) return;
  await discordPatch(
    token,
    `/guilds/${guildId}/channels`,
    targets.map((channel, position) => ({ id: channel.id, position }))
  );
  console.log(`✓ 已调整 ${categoryName} 顺序：${targets.length} 个频道`);
}

module.exports = {
  renameDiscord
};
