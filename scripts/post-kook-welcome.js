#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const KOOK_API_BASE_URL = "https://www.kookapp.cn";

const channelMessages = [
  {
    env: "KOOK_SUPPORT_CHANNEL_ID",
    title: "May猫饼客服接待",
    lines: [
      "这里是客户咨询入口。你可以直接说需求，AI 客服会先整理信息，复杂问题会转人工。",
      "",
      "**找陪玩请按这个格式发：**",
      "游戏：",
      "模式：",
      "预计时长：",
      "预算：",
      "是否需要试音：",
      "语音偏好：",
      "其他要求：",
      "",
      "**充值/到账问题请发：** 注册邮箱或昵称、充值金额、转账截图、备注。",
      "**退款/投诉请发：** 订单号、问题说明、截图或录屏。",
      "",
      "余额、退款、提现、封号、补偿等结果必须由人工客服确认，AI 不会直接改钱。"
    ]
  },
  {
    env: "KOOK_DISPATCH_CHANNEL_ID",
    title: "人工派单频道",
    lines: [
      "这里用于客服或 AI 整理客户需求，陪玩报名，管理员最终确认。",
      "",
      "**派单格式：**",
      "客户：",
      "游戏：",
      "模式：",
      "预计时长：",
      "预算：",
      "是否试音：",
      "语音偏好：",
      "特殊要求：",
      "",
      "**陪玩报名格式：**",
      "可服务时间：",
      "报价：",
      "擅长模式：",
      "是否可试音：",
      "备注：",
      "",
      "禁止私下绕过平台交易。报名不等于接单，最终以后台订单为准。"
    ]
  },
  {
    env: "KOOK_RECHARGE_CHANNEL_ID",
    title: "充值审核频道",
    lines: [
      "这里记录人工充值审核提醒。",
      "",
      "**审核前确认：**",
      "1. 客户账号是否匹配",
      "2. 金额是否一致",
      "3. 截图是否清晰",
      "4. 优惠码或活动是否有效",
      "5. 后台加余额后是否生成钱包流水",
      "",
      "只允许管理员在后台加余额，禁止在频道里口头确认到账后不录入系统。"
    ]
  },
  {
    env: "KOOK_WITHDRAWAL_CHANNEL_ID",
    title: "提现审核频道",
    lines: [
      "这里记录陪玩提现申请和人工打款确认。",
      "",
      "**审核前确认：**",
      "陪玩账号、可提现收入、支付宝收款信息、订单是否已完成、是否存在投诉。",
      "",
      "人工打款完成后，再到后台确认提现完成并生成流水。禁止提前确认。"
    ]
  },
  {
    env: "KOOK_COMPLAINT_CHANNEL_ID",
    title: "投诉处理频道",
    lines: [
      "这里处理退款、投诉和争议订单。",
      "",
      "**处理前收集：**",
      "订单号、聊天记录、截图或录屏、客户诉求、陪玩说明、处理建议。",
      "",
      "任何退款、补偿、封禁都必须在后台操作，并保留管理员日志。"
    ]
  },
  {
    env: "KOOK_ADMIN_CHANNEL_ID",
    title: "管理提醒频道",
    lines: [
      "这里接收系统提醒、失败通知、待办事项。",
      "",
      "**每日建议检查：**",
      "充值审核、提现审核、投诉处理、未派单订单、Bot 失败日志、数据库备份。",
      "",
      "如果发现 Bot 不回复，优先检查 api-server 日志、KOOK 回调地址、频道 ID 和 Bot 权限。"
    ]
  },
  {
    env: "KOOK_VOICE_WAITING_CHANNEL_ID",
    title: "试音等候室",
    lines: [
      "客户需要试音时先进入这里，客服再安排候选陪玩进入。",
      "",
      "试音只确认声音、沟通风格和基础需求，不在语音里完成私下付款。"
    ]
  }
];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  const env = { ...loadEnv(path.resolve(process.cwd(), ".env")), ...process.env };
  const token = env.KOOK_TOKEN;
  if (!token) throw new Error("KOOK_TOKEN is missing");

  for (const item of channelMessages) {
    const channelId = env[item.env];
    if (!channelId) {
      console.log(`skip ${item.env}: not configured`);
      continue;
    }

    const content = buildMessage(item.title, item.lines);
    const result = await postKookMessage(token, channelId, content);
    console.log(`posted ${item.env} -> ${result.msg_id}`);
  }

  console.log("\nDone. 建议在 KOOK 里把这些规则消息手动置顶。");
}

function buildMessage(title, lines) {
  return [
    `**${title}**`,
    "",
    ...lines,
    "",
    "━━━━━━━━━━━━━━━━",
    "Website: https://maycatplay.com/customer/",
    "Account binding: https://maycatplay.com/customer/settings",
    "May猫饼规则：下单、派单、充值、提现、投诉都以网站后台记录为准。"
  ].join("\n");
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

async function postKookMessage(token, channelId, content) {
  const response = await fetch(`${KOOK_API_BASE_URL}/api/v3/message/create`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      target_id: channelId,
      type: 9,
      content
    })
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`KOOK API HTTP ${response.status}: ${text}`);

  const result = JSON.parse(text);
  if (result.code !== 0) throw new Error(`KOOK API error ${result.code}: ${result.message}`);
  return result.data;
}
