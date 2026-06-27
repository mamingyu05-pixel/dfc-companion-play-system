const fs = require("node:fs");
const path = require("node:path");

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const KOOK_API_BASE_URL = "https://www.kookapp.cn/api/v3";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnvFile(filePath) {
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

function loadProjectEnv() {
  const root = process.cwd();
  return {
    ...loadEnvFile(path.join(root, ".env.local")),
    ...loadEnvFile(path.join(root, ".env.development")),
    ...loadEnvFile(path.join(root, ".env.production")),
    ...loadEnvFile(path.join(root, ".env")),
    ...process.env
  };
}

function requireAny(env, names, label) {
  const name = names.find((key) => env[key]);
  if (!name) throw new Error(`${label || names.join("/")} is missing in .env or environment`);
  return env[name];
}

function parseRetryAfter(response) {
  const retryAfter = response.headers.get("retry-after");
  const resetAfter = response.headers.get("x-ratelimit-reset-after");
  const raw = retryAfter ?? resetAfter;
  if (!raw) return 1000;
  const parsed = Number(raw);
  if (Number.isFinite(parsed)) return Math.max(300, Math.ceil(parsed * 1000));
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(300, date - Date.now());
  return 1000;
}

async function requestJson(url, init, label, delayMs) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(url, init);
    if (response.status === 429) {
      const waitMs = parseRetryAfter(response);
      console.log(`rate limited ${label}; retry in ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }

    const text = await response.text();
    await sleep(delayMs);

    if (!response.ok) {
      throw new Error(`${label} HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    if (!text || response.status === 204) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${label} returned non-JSON response: ${text.slice(0, 500)}`);
    }
  }
  throw new Error(`${label} failed after repeated rate limits`);
}

function discordHeaders(token) {
  return {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json"
  };
}

async function discordRequest(token, method, apiPath, body) {
  return requestJson(
    `${DISCORD_API_BASE_URL}${apiPath}`,
    {
      method,
      headers: discordHeaders(token),
      body: body === undefined ? undefined : JSON.stringify(body)
    },
    `Discord ${method} ${apiPath}`,
    300
  );
}

function discordGet(token, apiPath) {
  return discordRequest(token, "GET", apiPath);
}

function discordPost(token, apiPath, body) {
  return discordRequest(token, "POST", apiPath, body);
}

function discordPatch(token, apiPath, body) {
  return discordRequest(token, "PATCH", apiPath, body);
}

function discordPut(token, apiPath, body) {
  return discordRequest(token, "PUT", apiPath, body);
}

function discordEditMessage(token, channelId, messageId, content) {
  return discordPatch(token, `/channels/${channelId}/messages/${messageId}`, { content });
}

function discordGetMessages(token, channelId, limit = 50) {
  const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  return discordGet(token, `/channels/${channelId}/messages?limit=${boundedLimit}`);
}

async function checkMessageExists(token, channelId, markerText) {
  if (!channelId) return false;
  const messages = await discordGetMessages(token, channelId, 50);
  return Array.isArray(messages) && messages.some((message) => String(message.content || "").includes(markerText));
}

async function postIfNotExists(token, channelId, content, markerText) {
  if (!channelId) {
    console.log(`skip missing channel for marker: ${markerText}`);
    return { status: "missing" };
  }
  if (await checkMessageExists(token, channelId, markerText)) {
    console.log(`exists, skip Discord ${channelId}: ${markerText}`);
    return { status: "exists" };
  }
  const message = await discordPost(token, `/channels/${channelId}/messages`, { content });
  console.log(`sent Discord ${channelId}: ${markerText}`);
  return { status: "sent", id: message?.id };
}

function kookHeaders(token) {
  return {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json"
  };
}

async function kookRequest(token, method, apiPath, body) {
  const result = await requestJson(
    `${KOOK_API_BASE_URL}${apiPath}`,
    {
      method,
      headers: kookHeaders(token),
      body: body === undefined ? undefined : JSON.stringify(body)
    },
    `KOOK ${method} ${apiPath}`,
    200
  );

  if (result && typeof result.code === "number" && result.code !== 0) {
    throw new Error(`KOOK API error ${result.code}: ${result.message || JSON.stringify(result).slice(0, 500)}`);
  }
  return result?.data ?? result;
}

function kookGet(token, apiPath) {
  return kookRequest(token, "GET", apiPath);
}

function kookPost(token, apiPath, body) {
  return kookRequest(token, "POST", apiPath, body);
}

function kookEditMessage(token, messageId, content) {
  return kookPost(token, "/message/update", {
    msg_id: messageId,
    content
  });
}

async function kookGetMessages(token, channelId, limit = 50) {
  const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const data = await kookGet(
    token,
    `/message/list?target_id=${encodeURIComponent(channelId)}&msg_pin=0&page_size=${boundedLimit}`
  );
  return Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
}

async function kookCheckMessageExists(token, channelId, markerText) {
  if (!channelId) return false;
  const messages = await kookGetMessages(token, channelId, 50);
  return messages.some((message) => String(message.content || "").includes(markerText));
}

async function kookPostIfNotExists(token, channelId, content, markerText) {
  if (!channelId) {
    console.log(`skip missing KOOK channel for marker: ${markerText}`);
    return { status: "missing" };
  }
  if (await kookCheckMessageExists(token, channelId, markerText)) {
    console.log(`exists, skip KOOK ${channelId}: ${markerText}`);
    return { status: "exists" };
  }
  const message = await kookPost(token, "/message/create", {
    type: 9,
    target_id: channelId,
    content
  });
  console.log(`sent KOOK ${channelId}: ${markerText}`);
  return { status: "sent", id: message?.msg_id || message?.id };
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function findChannel(channels, patterns, type) {
  const normalizedPatterns = patterns.map(normalizeName).filter(Boolean);
  return channels.find((channel) => {
    if (type !== undefined && Number(channel.type) !== type) return false;
    const name = normalizeName(channel.name);
    return normalizedPatterns.some((pattern) => name.includes(pattern));
  });
}

module.exports = {
  sleep,
  loadProjectEnv,
  requireAny,
  discordGet,
  discordPost,
  discordPatch,
  discordPut,
  discordEditMessage,
  discordGetMessages,
  checkMessageExists,
  postIfNotExists,
  kookGet,
  kookPost,
  kookEditMessage,
  kookGetMessages,
  kookCheckMessageExists,
  kookPostIfNotExists,
  normalizeName,
  findChannel
};
