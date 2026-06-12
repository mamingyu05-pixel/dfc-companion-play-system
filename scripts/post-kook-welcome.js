#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const KOOK_API_BASE_URL = "https://www.kookapp.cn";

const messages = [
  {
    env: "KOOK_SUPPORT_CHANNEL_ID",
    title: "May猫饼客服接待",
    content: [
      "欢迎来到 May猫饼电竞客服接待。",
      "",
      "你可以直接发送：",
      "1. 找陪玩：游戏、模式、预计时长、是否试音、预算可不填。",
      "2. 充值问题：金额、截图、账号邮箱或昵称。",
      "3. 试音选人：说出偏好，客服会安排候选陪玩。",
      "4. 退款投诉：订单号、问题说明、截图或录屏。",
      "",
      "AI 客服会先回复常见问题；余额、退款、提现、封号和投诉结论必须由人工客服确认。"
    ].join("\n")
  },
  {
    env: "KOOK_DISPATCH_CHANNEL_ID",
    title: "人工派单规则",
    content: [
      "这里是陪玩报名和人工派单频道。",
      "",
      "客服会把客户需求整理成派单信息。",
      "陪玩报名时请说明：可服务时间、报价、是否可试音、擅长模式。",
      "",
      "禁止抢单后失联；禁止私下绕过平台交易。"
    ].join("\n")
  },
  {
    env: "KOOK_RECHARGE_CHANNEL_ID",
    title: "充值审核规则",
    content: [
      "这里记录人工充值提醒和审核。",
      "",
      "审核前确认：账号、金额、截图、备注、优惠码。",
      "审核通过后由后台加余额，所有变动必须有钱包流水和管理员日志。"
    ].join("\n")
  },
  {
    env: "KOOK_WITHDRAWAL_CHANNEL_ID",
    title: "提现审核规则",
    content: [
      "这里记录陪玩提现申请。",
      "",
      "审核前确认：陪玩账号、可提现收入、支付宝收款信息、订单结算状态。",
      "打款完成后再在后台确认，禁止提前确认。"
    ].join("\n")
  },
  {
    env: "KOOK_COMPLAINT_CHANNEL_ID",
    title: "投诉处理规则",
    content: [
      "这里处理退款、投诉和争议订单。",
      "",
      "处理前先收集：订单号、聊天记录、截图/录屏、陪玩说明、客户诉求。",
      "任何退款和补偿都必须后台操作并保留日志。"
    ].join("\n")
  },
  {
    env: "KOOK_ADMIN_CHANNEL_ID",
    title: "管理提醒",
    content: [
      "这里接收系统提醒、失败通知和管理员待办。",
      "",
      "上线前建议每天检查：充值审核、提现审核、投诉处理、Bot 失败日志、数据库备份。"
    ].join("\n")
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

  for (const item of messages) {
    const channelId = env[item.env];
    if (!channelId) {
      console.log(`skip ${item.env}: not configured`);
      continue;
    }

    const content = `**${item.title}**\n${item.content}`;
    const result = await postKookMessage(token, channelId, content);
    console.log(`posted ${item.env} -> ${result.msg_id}`);
  }

  console.log("\nDone. You can pin these messages in KOOK manually.");
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
