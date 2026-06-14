#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";

const categoryPlan = [
  { key: "customer", name: "May猫饼｜客户服务" },
  { key: "dispatch", name: "May猫饼｜陪玩派单" },
  { key: "admin", name: "May猫饼｜运营后台" }
];

const channelPlan = [
  {
    env: "DISCORD_SUPPORT_CHANNEL_ID",
    name: "💬｜客服接待",
    topic: "客户咨询、AI客服、人工接管、找陪玩需求入口。",
    categoryKey: "customer",
    type: 0,
    title: "欢迎来到 May猫饼客服接待",
    lines: [
      "你可以直接说需求，AI 客服会先整理信息，复杂问题会转人工。",
      "找陪玩请说明：游戏、模式、段位、时长、预算、是否试音、语音偏好。",
      "充值不到账、退款、投诉、提现等问题，请带账号邮箱、订单号或截图。",
      "AI 不会直接加余额、退款、提现或封号，所有资金动作必须进入后台。"
    ]
  },
  {
    env: "DISCORD_AI_DISPATCH_CHANNEL_ID",
    name: "🤖｜AI派单",
    topic: "AI 自动整理客户需求，按游戏标签提醒陪玩报名。",
    categoryKey: "dispatch",
    type: 0,
    title: "May猫饼 AI 派单大厅",
    lines: [
      "AI 客服会把 KOOK / Discord 客户需求整理到这里。",
      "消息会自动提醒对应游戏标签和声线标签的陪玩。",
      "陪玩点击报名后进入后台候选列表，客服再向客户确认最终人选。"
    ]
  },
  {
    env: "DISCORD_DISPATCH_CHANNEL_ID",
    name: "📣｜人工派单",
    topic: "客服发布需求，陪玩报名，管理员确认。",
    categoryKey: "dispatch",
    type: 0,
    title: "May猫饼人工派单大厅",
    lines: [
      "客服或 AI 会在这里整理客户需求，陪玩按格式报名，管理员最终确认。",
      "陪玩报名建议包含：可服务时间、报价、擅长模式、是否可试音、备注。",
      "报名不等于接单，最终以后台订单状态为准。禁止绕过平台私下交易。"
    ]
  },
  {
    env: "DISCORD_RECHARGE_CHANNEL_ID",
    name: "💳｜充值审核",
    topic: "人工充值提醒、截图核对、到账确认。",
    categoryKey: "admin",
    type: 0,
    title: "May猫饼充值审核",
    lines: [
      "用于人工充值提醒和截图核对。",
      "审核前确认客户账号、金额、截图、备注、优惠码是否匹配。",
      "后台通过后必须生成钱包流水，不能只在频道口头确认。"
    ]
  },
  {
    env: "DISCORD_WITHDRAWAL_CHANNEL_ID",
    name: "💸｜提现审核",
    topic: "陪玩提现申请、支付宝信息核对、人工打款确认。",
    categoryKey: "admin",
    type: 0,
    title: "May猫饼提现审核",
    lines: [
      "用于陪玩提现申请、支付宝收款信息核对和人工打款确认。",
      "打款前确认可提现收入、订单完成状态、是否存在投诉。",
      "人工打款完成后再到后台确认完成。"
    ]
  },
  {
    env: "DISCORD_COMPLAINT_CHANNEL_ID",
    name: "🧯｜投诉处理",
    topic: "退款、投诉、争议订单处理。",
    categoryKey: "admin",
    type: 0,
    title: "May猫饼投诉处理",
    lines: [
      "用于退款、投诉、争议订单处理。",
      "处理前收集订单号、聊天记录、截图或录屏、客户诉求、陪玩说明。",
      "退款、补偿、封禁必须在后台操作并保留管理员日志。"
    ]
  },
  {
    env: "DISCORD_ADMIN_CHANNEL_ID",
    name: "🛎️｜管理提醒",
    topic: "系统异常、Bot失败日志、充值/提现/投诉待办。",
    categoryKey: "admin",
    type: 0,
    title: "May猫饼管理提醒",
    lines: [
      "用于系统异常、Bot 失败日志、待审核充值、提现和投诉提醒。",
      "每日建议检查：未派单订单、充值审核、提现审核、投诉、数据库备份、Bot 日志。"
    ]
  },
  {
    env: "DISCORD_VOICE_WAITING_CHANNEL_ID",
    name: "🎧｜试音等候室",
    topic: "客户进入后由客服安排候选陪玩试音。",
    categoryKey: "dispatch",
    type: 2,
    title: "May猫饼试音等候室",
    lines: [
      "客户需要试音时先进入这里，客服再安排候选陪玩进入。",
      "试音只确认声音、沟通风格和基础需求，不在语音里完成私下付款。"
    ]
  }
];

const rolePlan = [
  { env: "DISCORD_COMPANION_ROLE_ID", name: "🎮 认证陪玩", color: 0xa78bfa, mentionable: true },
  { env: "DISCORD_VOICE_MOON_ROLE_ID", name: "🌙 月影声线", color: 0xf472b6, mentionable: true },
  { env: "DISCORD_VOICE_SOLAR_ROLE_ID", name: "☀️ 曜刃声线", color: 0x38bdf8, mentionable: true },
  { env: "DISCORD_GAME_DELTA_FORCE_ROLE_ID", name: "🎯 三角洲行动组", color: 0x22d3ee, mentionable: true },
  { env: "DISCORD_GAME_LEAGUE_OF_LEGENDS_ROLE_ID", name: "🛡️ 英雄联盟组", color: 0x60a5fa, mentionable: true },
  { env: "DISCORD_GAME_VALORANT_ROLE_ID", name: "🔺 无畏契约组", color: 0xfb7185, mentionable: true },
  { env: "DISCORD_GAME_COUNTER_STRIKE_2_ROLE_ID", name: "💥 CS2组", color: 0xfbbf24, mentionable: true },
  { env: "DISCORD_GAME_PUBG_ROLE_ID", name: "🪂 PUBG组", color: 0xf97316, mentionable: true },
  { env: "DISCORD_GAME_APEX_LEGENDS_ROLE_ID", name: "⚡ Apex组", color: 0xef4444, mentionable: true },
  { env: "DISCORD_GAME_HONOR_OF_KINGS_ROLE_ID", name: "👑 王者荣耀组", color: 0xfacc15, mentionable: true },
  { env: "DISCORD_GAME_PEACEKEEPER_ELITE_ROLE_ID", name: "🕊️ 和平精英组", color: 0x34d399, mentionable: true }
];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = { ...loadEnv(path.resolve(process.cwd(), ".env")), ...process.env };
  const token = env.DISCORD_TOKEN;
  const guildId = args.guildId || env.DISCORD_GUILD_ID;

  if (!token) throw new Error("DISCORD_TOKEN is missing in .env");
  if (!guildId) throw new Error("DISCORD_GUILD_ID is missing in .env. Example: node scripts/setup-discord-server.js 123456789");

  console.log(`Discord guild: ${guildId}`);
  console.log("Creating or reusing May猫饼 Discord channels...\n");

  const existingChannels = await listGuildChannels(token, guildId);
  const existingRoles = await listGuildRoles(token, guildId);
  const categoryIds = {};

  for (const item of categoryPlan) {
    const existing = existingChannels.find((channel) => channel.type === 4 && channel.name === item.name);
    const category = existing || (await createGuildChannel(token, guildId, { name: item.name, type: 4 }));
    categoryIds[item.key] = category.id;
    if (!existing) existingChannels.push(category);
    console.log(`${existing ? "reuse" : "create"} category ${item.name} -> ${category.id}`);
  }

  const output = {};
  for (const item of channelPlan) {
    const existing = existingChannels.find((channel) => channel.type === item.type && channel.name === item.name);
    const channel =
      existing ||
      (await createGuildChannel(token, guildId, {
        name: item.name,
        type: item.type,
        parent_id: categoryIds[item.categoryKey],
        topic: item.type === 0 ? item.topic : undefined
      }));

    if (existing && args.decorateChannels) {
      await updateChannel(token, existing.id, {
        name: item.name,
        parent_id: categoryIds[item.categoryKey],
        topic: item.type === 0 ? item.topic : undefined
      });
    }

    output[item.env] = channel.id;
    console.log(`${existing ? "reuse" : "create"} ${item.name} -> ${channel.id}`);

    if (args.postWelcome && item.type === 0) {
      const message = await postChannelMessage(token, channel.id, buildIntroMessage(item));
      console.log(`  posted intro -> ${message.id}`);
    }
  }

  const roleOutput = {};
  console.log("\nCreating or reusing May猫饼 Discord roles...\n");
  for (const item of rolePlan) {
    const existing = existingRoles.find((role) => role.name === item.name);
    const role = existing || (await createGuildRole(token, guildId, item));
    if (existing && args.decorateChannels) {
      await updateGuildRole(token, guildId, role.id, item);
    }
    roleOutput[item.env] = role.id;
    console.log(`${existing ? "reuse" : "create"} role ${item.name} -> ${role.id}`);
  }

  console.log("\nCopy these lines into /opt/companion-play-system/.env:");
  console.log(`DISCORD_GUILD_ID=${guildId}`);
  for (const item of channelPlan) {
    if (item.env === "DISCORD_VOICE_WAITING_CHANNEL_ID") continue;
    console.log(`${item.env}=${output[item.env]}`);
  }
  for (const item of rolePlan) {
    console.log(`${item.env}=${roleOutput[item.env]}`);
  }
  console.log(`# Optional voice waiting room: DISCORD_VOICE_WAITING_CHANNEL_ID=${output.DISCORD_VOICE_WAITING_CHANNEL_ID}`);
  console.log("\nAfter updating .env, run:");
  console.log("sudo docker compose restart api-server discord-bot nginx");
}

function parseArgs(argv) {
  return {
    guildId: argv.find((value) => !value.startsWith("--")),
    decorateChannels: argv.includes("--decorate-channels"),
    postWelcome: argv.includes("--post-welcome")
  };
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    env[key] = value;
  }
  return env;
}

async function listGuildChannels(token, guildId) {
  return discordRequest(token, `/guilds/${guildId}/channels`, { method: "GET" });
}

async function listGuildRoles(token, guildId) {
  return discordRequest(token, `/guilds/${guildId}/roles`, { method: "GET" });
}

async function createGuildChannel(token, guildId, body) {
  return discordRequest(token, `/guilds/${guildId}/channels`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

async function updateChannel(token, channelId, body) {
  return discordRequest(token, `/channels/${channelId}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

async function createGuildRole(token, guildId, item) {
  return discordRequest(token, `/guilds/${guildId}/roles`, {
    method: "POST",
    body: JSON.stringify({
      name: item.name,
      color: item.color,
      mentionable: Boolean(item.mentionable)
    })
  });
}

async function updateGuildRole(token, guildId, roleId, item) {
  return discordRequest(token, `/guilds/${guildId}/roles/${roleId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: item.name,
      color: item.color,
      mentionable: Boolean(item.mentionable)
    })
  });
}

async function postChannelMessage(token, channelId, content) {
  return discordRequest(token, `/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content })
  });
}

function buildIntroMessage(item) {
  return [
    `## ${item.title}`,
    "",
    "━━━━━━━━━━━━━━━━",
    "",
    ...item.lines.map((line) => `- ${line}`),
    "",
    "━━━━━━━━━━━━━━━━",
    "",
    "May猫饼电竞：下单、派单、充值、提现、投诉都以网站后台记录为准。"
  ].join("\n");
}

async function discordRequest(token, apiPath, init) {
  const response = await fetch(`${DISCORD_API_BASE_URL}${apiPath}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`Discord API HTTP ${response.status}: ${text}`);

  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Discord API returned non-JSON response: ${text}`);
  }
}
