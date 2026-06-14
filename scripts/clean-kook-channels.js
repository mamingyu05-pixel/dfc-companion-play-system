#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const KOOK_API_BASE_URL = "https://www.kookapp.cn";

const channelRules = [
  {
    key: "support",
    title: "客服接待",
    type: 1,
    keepEnv: ["KOOK_SUPPORT_CHANNEL_ID", "KOOK_ORDER_CHANNEL_ID"],
    aliases: ["客服接待"]
  },
  {
    key: "ai-dispatch",
    title: "AI派单",
    type: 1,
    keepEnv: ["KOOK_AI_DISPATCH_CHANNEL_ID"],
    aliases: ["AI派单", "AI 派单"]
  },
  {
    key: "manual-dispatch",
    title: "人工派单",
    type: 1,
    keepEnv: ["KOOK_DISPATCH_CHANNEL_ID"],
    aliases: ["人工派单"]
  },
  {
    key: "recharge",
    title: "充值审核",
    type: 1,
    keepEnv: ["KOOK_RECHARGE_CHANNEL_ID"],
    aliases: ["充值审核"]
  },
  {
    key: "withdrawal",
    title: "提现审核",
    type: 1,
    keepEnv: ["KOOK_WITHDRAWAL_CHANNEL_ID"],
    aliases: ["提现审核"]
  },
  {
    key: "complaint",
    title: "投诉处理",
    type: 1,
    keepEnv: ["KOOK_COMPLAINT_CHANNEL_ID"],
    aliases: ["投诉处理"]
  },
  {
    key: "admin-alert",
    title: "管理提醒",
    type: 1,
    keepEnv: ["KOOK_ADMIN_CHANNEL_ID"],
    aliases: ["管理提醒"]
  },
  {
    key: "voice-waiting",
    title: "试音等候室",
    type: 2,
    keepEnv: ["KOOK_VOICE_WAITING_CHANNEL_ID"],
    aliases: ["试音等候室"]
  }
];

const aiDispatchDecoration = {
  name: "🤖｜AI派单",
  topic: "AI 汇总客户需求，按游戏/声线标签提醒陪玩报名，客服后台确认后转正式订单。",
  title: "May猫饼 AI 派单大厅",
  lines: [
    "这里用于接收 KOOK / Discord / 网站客服整理出的派单草稿。",
    "客户需求会先变成试音派单，陪玩报名后进入后台候选列表。",
    "陪玩报名格式：报名 TRY编号 段位/水平，报价，可服务时间，性格优势，是否可试音。",
    "报名不等于接单；客服和管理员确认后，客户确认人选，才会转正式订单。",
    "长时间无人报名、客户失联或需求取消，可以在后台标记流单。"
  ]
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = { ...loadEnv(path.resolve(process.cwd(), ".env")), ...process.env };
  const token = env.KOOK_TOKEN;
  const guildId = args.guildId || env.KOOK_GUILD_ID;

  if (!token) throw new Error("KOOK_TOKEN is missing in .env");
  if (!guildId) throw new Error("KOOK_GUILD_ID is missing. Example: node scripts/clean-kook-channels.js 3189962583916682");

  const channels = await listChannels(token, guildId);
  const duplicateGroups = findDuplicateGroups(channels, env);

  console.log(`KOOK guild: ${guildId}`);
  console.log(args.delete ? "Mode: DELETE duplicates" : "Mode: preview only");
  console.log("");

  if (!duplicateGroups.length) {
    console.log("No duplicate managed KOOK channels found.");
  }

  for (const group of duplicateGroups) {
    console.log(`Duplicate group: ${group.rule.title}`);
    console.log(`  keep: ${formatChannel(group.keep)}`);
    for (const channel of group.remove) {
      console.log(`  ${args.delete ? "delete" : "would delete"}: ${formatChannel(channel)}`);
    }

    if (args.delete) {
      for (const channel of group.remove) {
        await deleteChannel(token, channel.id);
      }
    }
    console.log("");
  }

  if (args.decorateAi) {
    await decorateAiDispatch(token, env, channels);
  } else {
    console.log("Tip: add --decorate-ai to update the AI派单 channel name/topic and post a short rule card.");
  }
}

function parseArgs(argv) {
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value.startsWith("--")) continue;
    positional.push(value);
  }

  return {
    guildId: positional[0],
    delete: argv.includes("--delete"),
    decorateAi: argv.includes("--decorate-ai")
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

async function listChannels(token, guildId) {
  const result = await kookRequest(token, `/api/v3/channel/list?guild_id=${encodeURIComponent(guildId)}`, { method: "GET" });
  const items = Array.isArray(result.items) ? result.items : Array.isArray(result) ? result : [];
  return items.map((item) => ({
    id: String(item.id),
    name: String(item.name),
    type: Number(item.type),
    topic: item.topic ? String(item.topic) : ""
  }));
}

function findDuplicateGroups(channels, env) {
  const groups = [];

  for (const rule of channelRules) {
    const matches = channels.filter((channel) => Number(channel.type) === rule.type && matchesRule(channel.name, rule));
    if (matches.length <= 1) continue;

    const keep = chooseKeepChannel(matches, rule, env);
    if (!keep) {
      console.log(`Ambiguous duplicate group ${rule.title}: no configured channel id found, skip deletion.`);
      continue;
    }

    const remove = matches.filter((channel) => channel.id !== keep.id);
    if (remove.length) groups.push({ rule, keep, remove });
  }

  return groups;
}

function matchesRule(name, rule) {
  const normalized = normalizeName(name);
  return rule.aliases.some((alias) => normalized.includes(normalizeName(alias)));
}

function normalizeName(value) {
  return String(value)
    .replace(/\s+/g, "")
    .replace(/[|｜#_\-—–·•.。:：()[\]【】]/g, "")
    .toLowerCase();
}

function chooseKeepChannel(matches, rule, env) {
  const configuredIds = rule.keepEnv.map((key) => env[key]).filter(Boolean).map(String);
  const configuredMatch = matches.find((channel) => configuredIds.includes(channel.id));
  if (configuredMatch) return configuredMatch;

  const decorated = matches.find((channel) => /[｜|]/.test(channel.name) || channel.name.includes("🤖"));
  return decorated || matches[0];
}

async function deleteChannel(token, channelId) {
  await kookRequest(token, "/api/v3/channel/delete", {
    method: "POST",
    body: JSON.stringify({ channel_id: channelId })
  });
  console.log(`  deleted: ${channelId}`);
}

async function decorateAiDispatch(token, env, channels) {
  const channelId = env.KOOK_AI_DISPATCH_CHANNEL_ID || findAiDispatchChannel(channels)?.id;
  if (!channelId) {
    console.log("skip AI decoration: KOOK_AI_DISPATCH_CHANNEL_ID is not configured and no AI派单 channel was found.");
    return;
  }

  await kookRequest(token, "/api/v3/channel/update", {
    method: "POST",
    body: JSON.stringify({
      channel_id: channelId,
      name: aiDispatchDecoration.name,
      topic: aiDispatchDecoration.topic
    })
  });

  const message = [
    `**${aiDispatchDecoration.title}**`,
    "",
    "━━━━━━━━━━━━━━━━",
    "",
    ...aiDispatchDecoration.lines.map((line) => `- ${line}`),
    "",
    "━━━━━━━━━━━━━━━━",
    "",
    "May猫饼规则：派单、报名、确认、结算都以网站后台记录为准。"
  ].join("\n");

  const result = await kookRequest(token, "/api/v3/message/create", {
    method: "POST",
    body: JSON.stringify({
      target_id: channelId,
      type: 9,
      content: message
    })
  });

  console.log(`decorated AI派单 channel ${channelId}`);
  console.log(`posted AI派单 intro -> ${result.msg_id}`);
}

function findAiDispatchChannel(channels) {
  const rule = channelRules.find((item) => item.key === "ai-dispatch");
  return rule ? channels.find((channel) => matchesRule(channel.name, rule)) : undefined;
}

function formatChannel(channel) {
  return `${channel.name} (${channel.id})`;
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
