#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const KOOK_API_BASE_URL = "https://www.kookapp.cn";

const channelPlan = [
  {
    env: "KOOK_SUPPORT_CHANNEL_ID",
    name: "客服接待",
    type: 1,
    purpose: "客户咨询、找陪玩需求、AI/人工客服入口"
  },
  {
    env: "KOOK_DISPATCH_CHANNEL_ID",
    name: "人工派单",
    type: 1,
    purpose: "客服/AI 生成派单信息，陪玩报名"
  },
  {
    env: "KOOK_RECHARGE_CHANNEL_ID",
    name: "充值审核",
    type: 1,
    purpose: "人工充值提醒、截图核对、到账通知"
  },
  {
    env: "KOOK_WITHDRAWAL_CHANNEL_ID",
    name: "提现审核",
    type: 1,
    purpose: "陪玩提现申请、人工打款确认"
  },
  {
    env: "KOOK_COMPLAINT_CHANNEL_ID",
    name: "投诉处理",
    type: 1,
    purpose: "退款、投诉、争议订单处理"
  },
  {
    env: "KOOK_ADMIN_CHANNEL_ID",
    name: "管理提醒",
    type: 1,
    purpose: "系统异常、失败通知、管理员提醒"
  },
  {
    env: "KOOK_VOICE_WAITING_CHANNEL_ID",
    name: "试音等候室",
    type: 2,
    purpose: "客户进入后由客服拉人试音"
  }
];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  const env = { ...loadEnv(path.resolve(process.cwd(), ".env")), ...process.env };
  const token = env.KOOK_TOKEN;
  const guildId = env.KOOK_GUILD_ID || process.argv[2];

  if (!token) {
    throw new Error("KOOK_TOKEN is missing in .env");
  }
  if (!guildId) {
    throw new Error("KOOK_GUILD_ID is missing in .env. You can also pass it as: node scripts/setup-kook-channels.js 70204909");
  }

  console.log(`KOOK guild: ${guildId}`);
  console.log("Creating or reusing May猫饼运营频道...\n");

  const existingChannels = await listChannels(token, guildId);
  const output = {};

  for (const item of channelPlan) {
    const existing = existingChannels.find((channel) => channel.name === item.name && Number(channel.type) === item.type);
    const channel = existing || (await createChannel(token, guildId, item));
    output[item.env] = channel.id;
    console.log(`${existing ? "reuse" : "create"} ${item.name} -> ${channel.id}`);
    console.log(`  ${item.purpose}`);
  }

  console.log("\nCopy these lines into /opt/companion-play-system/.env:");
  console.log(`KOOK_GUILD_ID=${guildId}`);
  for (const item of channelPlan) {
    if (item.env === "KOOK_VOICE_WAITING_CHANNEL_ID") continue;
    console.log(`${item.env}=${output[item.env]}`);
  }
  console.log(`# Optional voice waiting room: KOOK_VOICE_WAITING_CHANNEL_ID=${output.KOOK_VOICE_WAITING_CHANNEL_ID}`);
  console.log("\nAfter updating .env, run:");
  console.log("sudo docker compose restart api-server kook-bot nginx");
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

async function listChannels(token, guildId) {
  const result = await kookRequest(token, `/api/v3/channel/list?guild_id=${encodeURIComponent(guildId)}`, {
    method: "GET"
  });
  const items = Array.isArray(result.items) ? result.items : Array.isArray(result) ? result : [];
  return items.map((item) => ({
    id: String(item.id),
    name: String(item.name),
    type: Number(item.type)
  }));
}

async function createChannel(token, guildId, item) {
  const body = {
    guild_id: guildId,
    name: item.name,
    type: item.type
  };

  if (item.type === 2) {
    body.limit_amount = 10;
    body.voice_quality = "2";
  }

  const channel = await kookRequest(token, "/api/v3/channel/create", {
    method: "POST",
    body: JSON.stringify(body)
  });

  return {
    id: String(channel.id),
    name: String(channel.name),
    type: Number(channel.type)
  };
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
  if (!response.ok) {
    throw new Error(`KOOK API HTTP ${response.status}: ${text}`);
  }

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
