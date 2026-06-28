#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const {
  sleep,
  loadProjectEnv,
  requireAny,
  discordGet,
  discordPost,
  kookGetMessages,
  kookPost,
  normalizeName,
  findChannel
} = require("./utils");
const {
  CARD_DIR,
  DISCORD_PRICE_FORUM_NAME,
  DISCORD_SERVICE_PRICE_CHANNEL_ID,
  KOOK_SERVICE_PRICE_CHANNEL_ID,
  PRICE_NOTICE,
  PRICE_POSTS
} = require("./price-list-content");

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const KOOK_API_BASE_URL = "https://www.kookapp.cn/api/v3";
const DEFAULT_DISCORD_GUILD_ID = "1515442632086651130";

main().catch((error) => {
  console.error("❌ 错误：", error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  validateAssets();

  console.log("💰 May猫饼价目表发布");
  console.log(options.apply ? "模式：真实发布" : "模式：只演练，不修改 Discord/KOOK");
  console.log(`图片目录：${CARD_DIR}`);
  console.log(`计划发布：${1 + PRICE_POSTS.length} 条`);

  if (!options.apply) {
    console.log("\n如需真实发布，运行：node scripts/platform-setup/publish-price-list.js --apply --confirm-publish");
    return;
  }
  if (!options.confirmPublish) {
    throw new Error("真实发布需要同时传入 --confirm-publish，避免误发频道");
  }

  const env = loadProjectEnv();
  if (options.discord) await publishDiscord(env);
  if (options.kook) await publishKook(env);
  console.log("\n✅ 价目表发布完成");
}

function parseArgs(args) {
  const flags = new Set(args);
  const discordOnly = flags.has("--discord-only");
  const kookOnly = flags.has("--kook-only");
  if (discordOnly && kookOnly) throw new Error("--discord-only 和 --kook-only 不能同时使用");
  return {
    apply: flags.has("--apply"),
    confirmPublish: flags.has("--confirm-publish"),
    discord: !kookOnly,
    kook: !discordOnly
  };
}

function validateAssets() {
  if (!fs.existsSync(CARD_DIR)) throw new Error(`价目卡目录不存在：${CARD_DIR}`);
  for (const post of PRICE_POSTS) {
    const imagePath = path.join(CARD_DIR, post.file);
    if (!fs.existsSync(imagePath)) throw new Error(`缺少价目卡图片：${imagePath}`);
  }
}

async function publishDiscord(env) {
  console.log("\n═══ Discord ═══");
  const token = requireAny(env, ["DISCORD_TOKEN"], "DISCORD_TOKEN");
  const guildId = env.DISCORD_GUILD_ID || DEFAULT_DISCORD_GUILD_ID;
  console.log(`Discord guild: ${guildId}`);

  const channels = await discordGet(token, `/guilds/${guildId}/channels`);
  let forum = findChannel(channels, [DISCORD_PRICE_FORUM_NAME, "价格清单"], 15);
  const serviceChannel =
    channels.find((channel) => channel.id === (env.DISCORD_SERVICE_PRICE_CHANNEL_ID || DISCORD_SERVICE_PRICE_CHANNEL_ID)) ||
    findChannel(channels, ["服务价目", "服务项目"], 0);

  if (!forum) {
    forum = await discordPost(token, `/guilds/${guildId}/channels`, {
      name: DISCORD_PRICE_FORUM_NAME,
      type: 15,
      parent_id: serviceChannel?.parent_id ?? undefined,
      topic: "May猫饼统一价目卡：游戏价格与充值福利"
    });
    console.log(`✓ 已创建论坛频道：${forum.name}`);
  } else {
    console.log(`✓ 价格清单论坛已存在：${forum.name}`);
  }

  const existingThreads = await listDiscordForumThreads(token, forum.id);
  await ensureDiscordTextThread(token, forum.id, existingThreads, PRICE_NOTICE.title, PRICE_NOTICE.content);
  for (const post of PRICE_POSTS) {
    await ensureDiscordImageThread(token, forum.id, existingThreads, post.title, post.content, path.join(CARD_DIR, post.file));
  }
}

async function listDiscordForumThreads(token, forumId) {
  const threads = [];
  const active = await discordGet(token, `/channels/${forumId}/threads/active`).catch(() => null);
  if (Array.isArray(active?.threads)) threads.push(...active.threads);
  const archived = await discordGet(token, `/channels/${forumId}/threads/archived/public?limit=100`).catch(() => null);
  if (Array.isArray(archived?.threads)) threads.push(...archived.threads);
  return threads;
}

function hasDiscordThread(existingThreads, title) {
  const target = normalizeName(title);
  return existingThreads.some((thread) => normalizeName(thread.name) === target);
}

async function ensureDiscordTextThread(token, forumId, existingThreads, title, content) {
  if (hasDiscordThread(existingThreads, title)) {
    console.log(`- Discord 已存在，跳过：${title}`);
    return;
  }
  const thread = await discordPost(token, `/channels/${forumId}/threads`, {
    name: title,
    auto_archive_duration: 10080,
    message: { content }
  });
  existingThreads.push(thread);
  console.log(`✓ Discord 已发布：${title}`);
}

async function ensureDiscordImageThread(token, forumId, existingThreads, title, content, imagePath) {
  if (hasDiscordThread(existingThreads, title)) {
    console.log(`- Discord 已存在，跳过：${title}`);
    return;
  }
  const thread = await discordCreateForumImageThread(token, forumId, title, content, imagePath);
  existingThreads.push(thread);
  console.log(`✓ Discord 已发布：${title}`);
}

async function discordCreateForumImageThread(token, forumId, title, content, imagePath) {
  const buffer = fs.readFileSync(imagePath);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const form = new FormData();
    form.append(
      "payload_json",
      JSON.stringify({
        name: title,
        auto_archive_duration: 10080,
        message: { content }
      })
    );
    form.append("files[0]", new Blob([buffer]), path.basename(imagePath));

    const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${forumId}/threads`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}` },
      body: form
    });
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") || "1");
      await sleep(Math.max(500, retryAfter * 1000));
      continue;
    }
    const text = await response.text();
    await sleep(500);
    if (!response.ok) throw new Error(`Discord forum image thread HTTP ${response.status}: ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : null;
  }
  throw new Error("Discord forum image thread failed after repeated rate limits");
}

async function publishKook(env) {
  console.log("\n═══ KOOK ═══");
  const token = requireAny(env, ["KOOK_TOKEN"], "KOOK_TOKEN");
  const channelId = env.KOOK_SERVICE_PRICE_CHANNEL_ID || env.KOOK_PRICE_LIST_CHANNEL_ID || KOOK_SERVICE_PRICE_CHANNEL_ID;
  console.log(`KOOK channel: ${channelId}`);

  const existingMessages = await kookGetMessages(token, channelId, 100);
  await ensureKookTextMessage(token, channelId, existingMessages, PRICE_NOTICE.marker, PRICE_NOTICE.content);
  for (const post of PRICE_POSTS) {
    await ensureKookCardMessage(token, channelId, existingMessages, post);
  }
}

function hasKookMarker(existingMessages, marker) {
  return existingMessages.some((message) => String(message.content || "").includes(marker));
}

async function ensureKookTextMessage(token, channelId, existingMessages, marker, content) {
  if (hasKookMarker(existingMessages, marker)) {
    console.log(`- KOOK 已存在，跳过：${marker}`);
    return;
  }
  const message = await kookPost(token, "/message/create", {
    type: 9,
    target_id: channelId,
    content
  });
  existingMessages.push({ content, msg_id: message?.msg_id || message?.id });
  console.log("✓ KOOK 已发布：价目说明");
}

async function ensureKookCardMessage(token, channelId, existingMessages, post) {
  if (hasKookMarker(existingMessages, post.marker)) {
    console.log(`- KOOK 已存在，跳过：${post.title}`);
    return;
  }
  const imageUrl = await kookUploadAsset(token, path.join(CARD_DIR, post.file));
  const content = JSON.stringify([
    {
      type: "card",
      theme: "primary",
      size: "lg",
      modules: [
        { type: "header", text: { type: "plain-text", content: post.title } },
        { type: "section", text: { type: "kmarkdown", content: post.content } },
        { type: "container", elements: [{ type: "image", src: imageUrl }] }
      ]
    }
  ]);
  const message = await kookPost(token, "/message/create", {
    type: 10,
    target_id: channelId,
    content
  });
  existingMessages.push({ content, msg_id: message?.msg_id || message?.id });
  console.log(`✓ KOOK 已发布：${post.title}`);
}

async function kookUploadAsset(token, imagePath) {
  const buffer = fs.readFileSync(imagePath);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const form = new FormData();
    form.append("file", new Blob([buffer]), path.basename(imagePath));
    const response = await fetch(`${KOOK_API_BASE_URL}/asset/create`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}` },
      body: form
    });
    if (response.status === 429) {
      await sleep(1000);
      continue;
    }
    const text = await response.text();
    await sleep(300);
    if (!response.ok) throw new Error(`KOOK asset upload HTTP ${response.status}: ${text.slice(0, 500)}`);
    const result = JSON.parse(text);
    if (typeof result.code === "number" && result.code !== 0) {
      throw new Error(`KOOK asset upload error ${result.code}: ${result.message || text.slice(0, 500)}`);
    }
    const data = result.data;
    const url = typeof data === "string" ? data : data?.url;
    if (!url) throw new Error(`KOOK asset upload returned no url: ${text.slice(0, 500)}`);
    return url;
  }
  throw new Error("KOOK asset upload failed after repeated rate limits");
}
