#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const KOOK_API_BASE_URL = "https://www.kookapp.cn";

const rolePlan = [
  { env: "KOOK_SUPER_ADMIN_ROLE_ID", name: "👑 总管理", color: 0xffd166, grantToAdmin: true },
  { env: "KOOK_ADMIN_ROLE_ID", name: "🛡️ 管理员", color: 0xff5a6a, grantToAdmin: true },
  { env: "KOOK_SUPPORT_ROLE_ID", name: "💬 May客服", color: 0x22d3ee },
  { env: "KOOK_COMPANION_ROLE_ID", name: "🎮 认证陪玩", color: 0xa78bfa, mentionable: true },
  { env: "KOOK_VOICE_MOON_ROLE_ID", name: "🌙 月影声线", color: 0xf472b6, mentionable: true },
  { env: "KOOK_VOICE_SOLAR_ROLE_ID", name: "☀️ 曜刃声线", color: 0x38bdf8, mentionable: true },
  { env: "KOOK_GAME_DELTA_FORCE_ROLE_ID", name: "🎯 三角洲行动组", color: 0x22d3ee, mentionable: true },
  { env: "KOOK_GAME_LEAGUE_OF_LEGENDS_ROLE_ID", name: "🛡️ 英雄联盟组", color: 0x60a5fa, mentionable: true },
  { env: "KOOK_GAME_VALORANT_ROLE_ID", name: "🔺 无畏契约组", color: 0xfb7185, mentionable: true },
  { env: "KOOK_GAME_COUNTER_STRIKE_2_ROLE_ID", name: "💥 CS2组", color: 0xfbbf24, mentionable: true },
  { env: "KOOK_GAME_PUBG_ROLE_ID", name: "🪂 PUBG组", color: 0xf97316, mentionable: true },
  { env: "KOOK_GAME_APEX_LEGENDS_ROLE_ID", name: "⚡ Apex组", color: 0xef4444, mentionable: true },
  { env: "KOOK_GAME_HONOR_OF_KINGS_ROLE_ID", name: "👑 王者荣耀组", color: 0xfacc15, mentionable: true },
  { env: "KOOK_GAME_PEACEKEEPER_ELITE_ROLE_ID", name: "🕊️ 和平精英组", color: 0x34d399, mentionable: true },
  { env: "KOOK_CUSTOMER_ROLE_ID", name: "🐾 猫饼客户", color: 0x38bdf8 },
  { env: "KOOK_CUSTOMER_NO_ORDER_ROLE_ID", name: "🌱 未下单客户", color: 0x94a3b8 },
  { env: "KOOK_CUSTOMER_SPECIAL_HALL_ROLE_ID", name: "👑 May名人堂", color: 0xfacc15 },
  { env: "KOOK_CUSTOMER_SPECIAL_NEON_ROLE_ID", name: "💎 霓虹贵宾", color: 0xf472b6 },
  ...Array.from({ length: 15 }, (_, index) => {
    const level = index + 1;
    return {
      env: `KOOK_CUSTOMER_LEVEL_${level}_ROLE_ID`,
      name: `🐾 猫饼会员 Lv.${level}`,
      color: level <= 4 ? 0x38bdf8 : level <= 9 ? 0x818cf8 : 0xc084fc
    };
  })
];

const channelIntroPlan = [
  {
    env: "KOOK_SUPPORT_CHANNEL_ID",
    name: "💬｜客服接待",
    topic: "客户咨询、AI客服、人工接管、找陪玩需求入口",
    title: "欢迎来到 May猫饼客服接待",
    lines: [
      "这里是客户咨询入口。你可以直接说需求，AI 客服会先整理信息，复杂问题会转人工。",
      "找陪玩请说清楚：游戏、模式、段位、时长、预算、是否试音、语音偏好。",
      "充值不到账、退款、投诉、提现等问题，请带账号邮箱、订单号或截图，人工客服会继续处理。",
      "AI 不会直接加余额、退款、提现或封号，所有资金动作必须进入后台。"
    ]
  },
  {
    env: "KOOK_DISPATCH_CHANNEL_ID",
    name: "📣｜人工派单",
    topic: "客服发布需求，陪玩报名，管理员确认",
    title: "May猫饼人工派单大厅",
    lines: [
      "客服或 AI 会在这里整理客户需求，陪玩按格式报名，管理员最终确认。",
      "陪玩报名建议包含：可服务时间、报价、擅长模式、是否可试音、备注。",
      "报名不等于接单，最终以后台订单状态为准。禁止绕过平台私下交易。"
    ]
  },
  {
    env: "KOOK_AI_DISPATCH_CHANNEL_ID",
    name: "🤖｜AI派单",
    topic: "AI 自动整理客户需求，按游戏标签和声线标签提醒陪玩报名",
    title: "May猫饼 AI 派单大厅",
    lines: [
      "AI 客服会把 KOOK / Discord 客户需求整理到这里。",
      "派单会自动提醒对应游戏标签和声线标签的陪玩。",
      "陪玩报名后进入后台候选列表，客服再向客户确认最终人选。"
    ]
  },
  {
    env: "KOOK_RECHARGE_CHANNEL_ID",
    name: "💳｜充值审核",
    topic: "人工充值提醒、截图核对、到账确认",
    title: "May猫饼充值审核",
    lines: [
      "用于人工充值提醒和截图核对。",
      "审核前确认客户账号、金额、截图、备注、优惠码是否匹配。",
      "后台通过后必须生成钱包流水，不能只在频道口头确认。"
    ]
  },
  {
    env: "KOOK_WITHDRAWAL_CHANNEL_ID",
    name: "💸｜提现审核",
    topic: "陪玩提现申请、支付宝信息核对、人工打款确认",
    title: "May猫饼提现审核",
    lines: [
      "用于陪玩提现申请、支付宝收款信息核对和人工打款确认。",
      "打款前确认可提现收入、订单完成状态、是否存在投诉。",
      "人工打款完成后再到后台确认完成。"
    ]
  },
  {
    env: "KOOK_COMPLAINT_CHANNEL_ID",
    name: "🧯｜投诉处理",
    topic: "退款、投诉、争议订单处理",
    title: "May猫饼投诉处理",
    lines: [
      "用于退款、投诉、争议订单处理。",
      "处理前收集订单号、聊天记录、截图或录屏、客户诉求、陪玩说明。",
      "退款、补偿、封禁必须在后台操作并保留管理员日志。"
    ]
  },
  {
    env: "KOOK_ADMIN_CHANNEL_ID",
    name: "🛎️｜管理提醒",
    topic: "系统异常、Bot失败日志、充值/提现/投诉待办",
    title: "May猫饼管理提醒",
    lines: [
      "用于系统异常、Bot 失败日志、待审核充值、提现和投诉提醒。",
      "每日建议检查：未派单订单、充值审核、提现审核、投诉、数据库备份、Bot 日志。"
    ]
  }
];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = { ...loadEnv(path.resolve(process.cwd(), ".env")), ...process.env };
  const token = env.KOOK_TOKEN;
  const guildId = args.guildId || env.KOOK_GUILD_ID;
  const adminUserIds = unique([
    args.adminUserId || env.KOOK_ADMIN_USER_ID || "1481361693",
    ...args.adminUserIds,
    ...splitIds(env.KOOK_ADMIN_USER_IDS)
  ]);
  const supportUserIds = unique([...args.supportUserIds, ...splitIds(env.KOOK_SUPPORT_USER_IDS)]);

  if (!token) throw new Error("KOOK_TOKEN is missing in .env");
  if (!guildId) throw new Error("KOOK_GUILD_ID is missing in .env. Example: node scripts/decorate-kook-server.js 3189962583916682");

  console.log(`KOOK guild: ${guildId}`);
  console.log("Ensuring May猫饼 roles...\n");

  const existingRoles = await listRoles(token, guildId);
  const roleOutput = {};

  for (const item of rolePlan) {
    const role = await ensureRole(token, guildId, existingRoles, item);
    await tryUpdateRoleDisplay(token, guildId, role, item);
    roleOutput[item.env] = role.id;
    console.log(`${role.created ? "create" : "reuse"} ${item.name} -> ${role.id}`);
  }

  const adminRoleIds = [roleOutput.KOOK_SUPER_ADMIN_ROLE_ID, roleOutput.KOOK_ADMIN_ROLE_ID].filter(Boolean);
  for (const userId of adminUserIds) {
    for (const roleId of adminRoleIds) {
      await grantRole(token, guildId, userId, roleId);
      console.log(`grant admin role ${roleId} to KOOK user ${userId}`);
    }
  }

  const supportRoleId = roleOutput.KOOK_SUPPORT_ROLE_ID;
  if (supportRoleId && args.botAsSupport) {
    const botUserId = await tryGetCurrentBotUserId(token);
    if (botUserId) {
      supportUserIds.unshift(botUserId);
    }
  }
  for (const userId of unique(supportUserIds)) {
    await grantRole(token, guildId, userId, supportRoleId);
    console.log(`grant support role ${supportRoleId} to KOOK user ${userId}`);
  }

  if (args.decorateChannels) {
    console.log("\nDecorating channel names and topics...\n");
    for (const item of channelIntroPlan) {
      const channelId = env[item.env];
      if (!channelId) {
        console.log(`skip ${item.env}: not configured`);
        continue;
      }
      await tryUpdateChannel(token, channelId, item);
    }
  }

  if (args.postWelcome) {
    console.log("\nPosting channel layout messages...\n");
    for (const item of channelIntroPlan) {
      const channelId = env[item.env];
      if (!channelId) {
        console.log(`skip ${item.env}: not configured`);
        continue;
      }
      const result = await postChannelMessage(token, channelId, buildIntroMessage(item));
      console.log(`posted ${item.title} -> ${result.msg_id}`);
    }
  }

  console.log("\nCopy these lines into /opt/companion-play-system/.env:");
  console.log(`KOOK_GUILD_ID=${guildId}`);
  for (const item of rolePlan) {
    console.log(`${item.env}=${roleOutput[item.env]}`);
  }
  console.log("\nAfter updating .env, run:");
  console.log("sudo docker compose restart api-server kook-bot nginx");
  console.log("\nManual KOOK step: 服务器设置 -> 角色权限，把角色按文档顺序拖动；Bot 自己的角色必须排在这些业务角色上方。");
}

function parseArgs(argv) {
  const positional = getPositionalValues(argv);
  return {
    guildId: positional[0],
    adminUserId: positional[1],
    adminUserIds: getFlagValues(argv, "--admin-user-id"),
    supportUserIds: getFlagValues(argv, "--support-user-id"),
    postWelcome: argv.includes("--post-welcome"),
    decorateChannels: argv.includes("--decorate-channels"),
    botAsSupport: !argv.includes("--no-bot-support")
  };
}

function getPositionalValues(argv) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value.startsWith("--")) {
      if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
        index += 1;
      }
      continue;
    }
    values.push(value);
  }
  return values;
}

function getFlagValues(argv, flag) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === flag && argv[index + 1] && !argv[index + 1].startsWith("--")) {
      values.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (value.startsWith(`${flag}=`)) {
      values.push(value.slice(flag.length + 1));
    }
  }
  return values.flatMap(splitIds);
}

function splitIds(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
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

async function listRoles(token, guildId) {
  const data = await kookRequest(token, `/api/v3/guild-role/list?guild_id=${encodeURIComponent(guildId)}`, { method: "GET" });
  const roles = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  return roles.map((role) => ({
    id: String(role.role_id ?? role.id),
    name: String(role.name)
  }));
}

async function ensureRole(token, guildId, existingRoles, item) {
  const existing = existingRoles.find((role) => role.name === item.name);
  if (existing) return { ...existing, created: false };

  const data = await kookRequest(token, "/api/v3/guild-role/create", {
    method: "POST",
    body: JSON.stringify({
      guild_id: guildId,
      name: item.name,
      color: item.color,
      hoist: 1,
      mentionable: item.mentionable ? 1 : 0
    })
  });

  const role = {
    id: String(data.role_id ?? data.id),
    name: String(data.name ?? item.name),
    created: true
  };
  existingRoles.push(role);
  return role;
}

async function tryUpdateRoleDisplay(token, guildId, role, item) {
  try {
    await kookRequest(token, "/api/v3/guild-role/update", {
      method: "POST",
      body: JSON.stringify({
        guild_id: guildId,
        role_id: Number(role.id),
        name: item.name,
        color: item.color,
        hoist: 1,
        mentionable: item.mentionable ? 1 : 0
      })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`warn update role display failed for ${item.name}: ${message}`);
  }
}

async function tryGetCurrentBotUserId(token) {
  try {
    const data = await kookRequest(token, "/api/v3/user/me", { method: "GET" });
    return data?.id ? String(data.id) : undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`warn cannot detect bot user id: ${message}`);
    return undefined;
  }
}

async function grantRole(token, guildId, userId, roleId) {
  await kookRequest(token, "/api/v3/guild-role/grant", {
    method: "POST",
    body: JSON.stringify({
      guild_id: guildId,
      user_id: userId,
      role_id: Number(roleId)
    })
  });
}

async function postChannelMessage(token, channelId, content) {
  return kookRequest(token, "/api/v3/message/create", {
    method: "POST",
    body: JSON.stringify({
      target_id: channelId,
      type: 9,
      content
    })
  });
}

async function tryUpdateChannel(token, channelId, item) {
  try {
    await kookRequest(token, "/api/v3/channel/update", {
      method: "POST",
      body: JSON.stringify({
        channel_id: channelId,
        name: item.name,
        topic: item.topic
      })
    });
    console.log(`updated ${channelId} -> ${item.name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`warn update channel failed for ${item.env}: ${message}`);
  }
}

function buildIntroMessage(item) {
  return [
    `**${item.title}**`,
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

async function kookRequest(token, apiPath, init) {
  const response = await fetch(`${KOOK_API_BASE_URL}${apiPath}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`KOOK API HTTP ${response.status}: ${text}`);

  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`KOOK API returned non-JSON response: ${text}`);
  }

  if (result.code !== 0) {
    throw new Error(`KOOK API error ${result.code}: ${result.message || text}`);
  }

  return result.data;
}
