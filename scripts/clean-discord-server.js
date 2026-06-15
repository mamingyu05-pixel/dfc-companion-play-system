#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";

const channelRules = [
  {
    key: "support",
    title: "客服接待",
    type: 0,
    keepEnv: ["DISCORD_SUPPORT_CHANNEL_ID", "DISCORD_ORDER_CHANNEL_ID"],
    aliases: ["客服接待"]
  },
  {
    key: "ai-dispatch",
    title: "AI派单",
    type: 0,
    keepEnv: ["DISCORD_AI_DISPATCH_CHANNEL_ID"],
    aliases: ["AI派单", "AI 派单", "ai派单"]
  },
  {
    key: "manual-dispatch",
    title: "人工派单",
    type: 0,
    keepEnv: ["DISCORD_DISPATCH_CHANNEL_ID"],
    aliases: ["人工派单"]
  },
  {
    key: "recharge",
    title: "充值审核",
    type: 0,
    keepEnv: ["DISCORD_RECHARGE_CHANNEL_ID"],
    aliases: ["充值审核"]
  },
  {
    key: "withdrawal",
    title: "提现审核",
    type: 0,
    keepEnv: ["DISCORD_WITHDRAWAL_CHANNEL_ID"],
    aliases: ["提现审核"]
  },
  {
    key: "complaint",
    title: "投诉处理",
    type: 0,
    keepEnv: ["DISCORD_COMPLAINT_CHANNEL_ID"],
    aliases: ["投诉处理"]
  },
  {
    key: "admin-alert",
    title: "管理提醒",
    type: 0,
    keepEnv: ["DISCORD_ADMIN_CHANNEL_ID"],
    aliases: ["管理提醒"]
  },
  {
    key: "voice-waiting",
    title: "试音等候室",
    type: 2,
    keepEnv: ["DISCORD_VOICE_WAITING_CHANNEL_ID"],
    aliases: ["试音等候室"]
  }
];

const adminRoleRules = [
  { env: "DISCORD_SUPER_ADMIN_ROLE_ID", name: "👑 总管理", aliases: ["总管理", "SUPER_ADMIN"], color: 0xffd166 },
  { env: "DISCORD_ADMIN_ROLE_ID", name: "🛡️ 管理员", aliases: ["管理员", "ADMIN"], color: 0xff5a6a }
];

const aiDispatchDecoration = {
  name: "🤖｜ai派单",
  topic: "AI 汇总客户需求，按游戏/声线标签提醒陪玩报名，客服后台确认后转正式订单。",
  title: "May猫饼 AI 派单大厅",
  lines: [
    "这里用于接收 KOOK / Discord / 网站客服整理出的派单草稿。",
    "客户需求会先进入后台草稿；陪玩报名后进入候选列表，客服再向客户确认最终人选。",
    "陪玩报名建议写：段位/水平、报价、可服务时间、性格优势、是否可试音。",
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
  const token = env.DISCORD_TOKEN;
  const guildId = args.guildId || env.DISCORD_GUILD_ID;

  if (!token) throw new Error("DISCORD_TOKEN is missing in .env");
  if (!guildId) throw new Error("DISCORD_GUILD_ID is missing. Example: node scripts/clean-discord-server.js 1515442632086651130");

  const channels = await listGuildChannels(token, guildId);
  const duplicateGroups = findDuplicateGroups(channels, env);

  console.log(`Discord guild: ${guildId}`);
  console.log(args.delete ? "Mode: DELETE duplicate managed channels" : "Mode: preview only");
  console.log("");

  if (!duplicateGroups.length) {
    console.log("No duplicate managed Discord channels found.");
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

  if (args.grantAdmin) {
    await grantAdminRoles(token, guildId, env, args.adminUserIds);
  } else {
    console.log("Tip: add --grant-admin --admin-user-id <discordUserId> to grant 总管理/管理员.");
  }
}

function parseArgs(argv) {
  const positional = getPositionalValues(argv);
  return {
    guildId: positional[0],
    delete: argv.includes("--delete"),
    decorateAi: argv.includes("--decorate-ai"),
    grantAdmin: argv.includes("--grant-admin"),
    adminUserIds: unique([
      positional[1],
      ...getFlagValues(argv, "--admin-user-id")
    ])
  };
}

function getPositionalValues(argv) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value.startsWith("--")) {
      if (argv[index + 1] && !argv[index + 1].startsWith("--")) index += 1;
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

async function listGuildChannels(token, guildId) {
  const channels = await discordRequest(token, `/guilds/${guildId}/channels`, { method: "GET" });
  return channels.map((channel) => ({
    id: String(channel.id),
    name: String(channel.name),
    type: Number(channel.type),
    topic: channel.topic ? String(channel.topic) : ""
  }));
}

async function listGuildRoles(token, guildId) {
  const roles = await discordRequest(token, `/guilds/${guildId}/roles`, { method: "GET" });
  return roles.map((role) => ({
    id: String(role.id),
    name: String(role.name)
  }));
}

function findDuplicateGroups(channels, env) {
  const groups = [];

  for (const rule of channelRules) {
    const matches = channels.filter((channel) => channel.type === rule.type && matchesRule(channel.name, rule));
    if (matches.length <= 1) continue;

    const keep = chooseKeepChannel(matches, rule, env);
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
    .replace(/[｜|_\-—–:：()[\]【】]/g, "")
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
  await discordRequest(token, `/channels/${channelId}`, { method: "DELETE" });
  console.log(`  deleted: ${channelId}`);
}

async function decorateAiDispatch(token, env, channels) {
  const channelId = env.DISCORD_AI_DISPATCH_CHANNEL_ID || findAiDispatchChannel(channels)?.id;
  if (!channelId) {
    console.log("skip AI decoration: DISCORD_AI_DISPATCH_CHANNEL_ID is not configured and no AI派单 channel was found.");
    return;
  }

  await discordRequest(token, `/channels/${channelId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: aiDispatchDecoration.name,
      topic: aiDispatchDecoration.topic
    })
  });

  const message = [
    `## ${aiDispatchDecoration.title}`,
    "",
    "━━━━━━━━━━━━━━━━",
    "",
    ...aiDispatchDecoration.lines.map((line) => `- ${line}`),
    "",
    "━━━━━━━━━━━━━━━━",
    "",
    "Website: https://maycatplay.com/customer/",
    "Account binding: https://maycatplay.com/customer/settings",
    "",
    "May猫饼规则：派单、报名、确认、结算都以网站后台记录为准。"
  ].join("\n");

  const result = await discordRequest(token, `/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: message })
  });

  console.log(`decorated AI派单 channel ${channelId}`);
  console.log(`posted AI派单 intro -> ${result.id}`);
}

function findAiDispatchChannel(channels) {
  const rule = channelRules.find((item) => item.key === "ai-dispatch");
  return rule ? channels.find((channel) => matchesRule(channel.name, rule)) : undefined;
}

async function grantAdminRoles(token, guildId, env, userIds) {
  if (!userIds.length) {
    console.log("skip grant admin roles: no Discord user id was provided.");
    return;
  }

  const roles = await listGuildRoles(token, guildId);
  const targetRoles = [];

  for (const rule of adminRoleRules) {
    const role = await ensureRole(token, guildId, roles, rule, env);
    targetRoles.push(role);
  }

  for (const userId of userIds) {
    for (const role of targetRoles) {
      try {
        await discordRequest(token, `/guilds/${guildId}/members/${userId}/roles/${role.id}`, { method: "PUT" });
        console.log(`grant ${role.name} (${role.id}) to Discord user ${userId}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`warn grant ${role.name} (${role.id}) to Discord user ${userId} failed: ${message}`);
        if (message.includes("Missing Permissions") || message.includes("50013")) {
          console.warn("  fix: Discord 服务器设置 -> 身份组，把 Bot 身份组拖到目标身份组上方，并确认 Bot 拥有“管理身份组”。");
        }
      }
    }
  }

  console.log("\nCopy these role lines into /opt/companion-play-system/.env if they are not configured:");
  for (const role of targetRoles) {
    const rule = adminRoleRules.find((item) => item.name === role.ruleName);
    if (rule) console.log(`${rule.env}=${role.id}`);
  }
}

function findRole(rule, roles, env) {
  const configuredId = env[rule.env];
  if (configuredId) {
    const configured = roles.find((role) => role.id === String(configuredId));
    if (configured) return configured;
  }

  return roles.find((role) => matchesRule(role.name, rule));
}

async function ensureRole(token, guildId, roles, rule, env) {
  const existing = findRole(rule, roles, env);
  if (existing) return { ...existing, ruleName: rule.name };

  const role = await discordRequest(token, `/guilds/${guildId}/roles`, {
    method: "POST",
    body: JSON.stringify({
      name: rule.name,
      color: rule.color,
      hoist: true,
      mentionable: false
    })
  });

  const created = {
    id: String(role.id),
    name: String(role.name),
    ruleName: rule.name
  };
  roles.push(created);
  console.log(`create missing role ${rule.name} -> ${created.id}`);
  return created;
}

function formatChannel(channel) {
  return `${channel.name} (${channel.id})`;
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
