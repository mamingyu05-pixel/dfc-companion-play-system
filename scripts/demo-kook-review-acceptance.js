#!/usr/bin/env node
// Demo only: posts two cards marked 【演示】 (order review, system timeout auto acceptance) to the
// KOOK admin channel, or prints them locally. It uses made-up data and never opens the order database.
// Config comes from the environment only, e.g. node --env-file=<project .env> scripts/demo-kook-review-acceptance.js
// Flags: --simulate (never touch KOOK), --out <fresh-file> (required before live attempts).
// Existing records are never overwritten or replayed. A create attempt without a
// confirmed message id is UNKNOWN_NO_RETRY; it must not fall back to simulation.
const fs = require("node:fs");
const path = require("node:path");

const KOOK_API_BASE_URL = "https://www.kookapp.cn";
const QUIET_MINUTES = 60;

const demoNo = `DEMO-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
const cards = [
  {
    title: "【演示】客户评价（测试数据，非真实订单）",
    lines: [`订单：${demoNo}-01`, "客户：演示客户", "陪玩：演示陪玩", "评分：★★★★★ 5 星", "评语：演示评语，配合很好。", "这是一条演示消息，不对应任何真实订单。"]
  },
  {
    title: "【演示】系统超时自动验收（测试数据，非真实订单）",
    lines: [`订单：${demoNo}-02`, "陪玩报完成后 48 小时客户未验收、无投诉", "处理：系统超时自动验收，按人工验收的同一条路径结算", "审计记录：系统超时自动验收", "这是一条演示消息，没有真实放款。"]
  }
];

function cardContent(card) {
  return JSON.stringify([{ type: "card", theme: "info", size: "lg", modules: [
    { type: "header", text: { type: "plain-text", content: card.title } },
    { type: "section", text: { type: "kmarkdown", content: card.lines.join("\n") } }
  ] }]);
}

async function kookRequest(token, apiPath, body) {
  const response = await fetch(`${KOOK_API_BASE_URL}${apiPath}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.code !== 0) throw new Error(`KOOK ${apiPath.split("?")[0]} failed: HTTP ${response.status}, code ${result?.code ?? "none"}, ${result?.message ?? "no message"}`);
  return result.data;
}

// Returns why sending is not allowed, or "" when the channel is readable and quiet.
async function blockedReason(token, channelId, request) {
  const me = await request(token, "/api/v3/user/me");
  const list = await request(token, `/api/v3/message/list?target_id=${encodeURIComponent(channelId)}&page_size=50`);
  if (!Array.isArray(list?.items)) return "频道消息读回来的格式认不出，无法判断有没有人在说话";
  const since = Date.now() - QUIET_MINUTES * 60000;
  const people = list.items.filter(item => Number(item.create_at) >= since && item.author?.id !== me.id && !item.author?.bot);
  return people.length ? `频道最近 ${QUIET_MINUTES} 分钟内有 ${people.length} 条真人发言` : "";
}

async function main({ request = kookRequest, args = process.argv.slice(2), token = process.env.KOOK_TOKEN,
  channelId = process.env.KOOK_ADMIN_CHANNEL_ID, log = console.log } = {}) {
  const outFile = args.includes("--out") ? args[args.indexOf("--out") + 1] : "";
  const record = { startedAt: new Date().toISOString(), mode: "blocked", outcome: "BLOCKED_BEFORE_SEND",
    reason: "", sent: [], attempts: [], cards };
  let fd;
  function save() {
    if (fd === undefined) return;
    const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!Number.isInteger(written) || written <= 0 || written > bytes.length - offset) {
        throw new Error("Receipt write made no valid progress; sending is held");
      }
      offset += written;
    }
    fs.ftruncateSync(fd, bytes.length);
    fs.fsyncSync(fd);
  }
  try {
    if (outFile) {
      fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
      // wx refuses every existing record, including old simulated or partial records.
      fd = fs.openSync(outFile, "wx");
      save();
    }
    if (args.includes("--simulate")) {
      record.mode = "simulated"; record.outcome = "SIMULATED";
      record.reason = "按 --simulate 运行，不连接 KOOK";
    } else if (!token || !channelId) record.reason = "环境里没有 KOOK_TOKEN 或 KOOK_ADMIN_CHANNEL_ID";
    else if (!outFile) record.reason = "真实发送需要 --out 指向全新回执文件；未尝试发送";
    else {
      try {
        record.reason = await blockedReason(token, channelId, request);
        if (!record.reason) {
          for (const card of cards) {
            const attempt = { cardIndex: record.attempts.length, title: card.title, state: "STARTED", noRetry: true };
            record.attempts.push(attempt);
            record.mode = "unknown"; record.outcome = "UNKNOWN_NO_RETRY";
            // Persist before create; a crash must not make the same attempt safe to replay.
            save();
            try {
              const data = await request(token, "/api/v3/message/create", { type: 10, target_id: channelId, content: cardContent(card) });
              if (typeof data?.msg_id !== "string" || !data.msg_id.trim()) throw new Error("KOOK create 缺少有效 message id");
              attempt.state = "RETURNED"; attempt.messageId = data.msg_id;
              record.sent.push({ title: card.title, messageId: data.msg_id });
              save();
            } catch (error) {
              attempt.state = "UNKNOWN_NO_RETRY";
              record.reason = `发送已尝试，回执未确认：${error.message}`;
              save();
              break;
            }
          }
          if (record.attempts.length === cards.length && record.attempts.every(item => item.state === "RETURNED")) {
            record.mode = "sent"; record.outcome = "SENT_CONFIRMED";
          }
        }
      } catch (error) {
        record.reason = `${record.attempts.length ? "发送过程或回执落盘失败，禁止重放" : "发送前检查失败"}：${error.message}`;
      }
    }
    save();
    if (record.outcome === "UNKNOWN_NO_RETRY") log(`KOOK 发送结果未知（UNKNOWN_NO_RETRY），已停止后续发送，禁止重放。${record.reason}`);
    else if (record.outcome === "SENT_CONFIRMED") log(`已收到 KOOK 发送回执：${record.sent.length} 条演示卡片。`);
    else if (record.outcome === "SIMULATED") log(`仅本地模拟，未尝试发送。${record.reason}`);
    else log(`发送前已阻断，未尝试 message/create。${record.reason}`);
    for (const card of cards) log(`\n┌ ${card.title}\n${card.lines.map(line => `│ ${line}`).join("\n")}\n└`);
    return record;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

module.exports = { main };
if (require.main === module) main().then(record => {
  if (record.outcome === "UNKNOWN_NO_RETRY" || record.outcome === "BLOCKED_BEFORE_SEND") process.exitCode = 2;
}).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
