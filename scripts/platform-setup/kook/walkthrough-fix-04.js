const {
  findChannel,
  kookDeleteMessage,
  kookEditMessage,
  kookGet,
  kookGetMessages,
  kookPost,
  loadProjectEnv,
  requireAny,
  sleep
} = require("../lib/utils");

const DEFAULT_SCAN_LIMIT = 100;
const KNOWN_KOOK_CHANNEL_IDS = {
  DISPATCH_CHANNEL: "5136741567563919",
  AI_DISPATCH_CHANNEL: "8501092340079641",
  SERVICE_CHANNEL: "7899539614518714",
  NAV_CHANNEL: "1488906930940679"
};

const CONTENT = {
  aiCustomerOrder: {
    marker: "客户下单格式",
    body: ({ recharge }) => `**🤖 May猫饼电竞 · 客户下单格式**

下单前请确认钱包余额充足（充值见 ${mentionOrName(recharge)}）。

请按以下格式发单：

游戏：
模式：
时长（小时）：
预算：（或填“按陪玩报价”）
试听：需要 / 不需要
开始时间：现在 / 预约___
陪玩偏好：指定___ / 平台推荐
备注：

AI 客服会整理成派单卡并 @ 匹配的陪玩，最终由客服确认人选并从余额扣费。
网页只用于查余额、看陪玩、查记录，不在网页下单。`
  },
  navSelfOrder: {
    marker: "自助下单入口",
    body: ({ aiDispatch }) => `**📝 自助下单入口**

自助下单请到 ${mentionOrName(aiDispatch)} 按格式发单。
网页 maycatplay.com 只用于查余额、看陪玩、查订单记录，不在网页下单。`
  }
};

async function runKookWalkthroughFix04(options = {}) {
  const env = loadProjectEnv();
  const token = requireAny(env, ["KOOK_TOKEN"], "KOOK_TOKEN");
  const guildId = requireAny(env, ["KOOK_GUILD_ID"], "KOOK_GUILD_ID");
  const apply = Boolean(options.apply && options.confirmCleanup);
  const context = {
    apply,
    token,
    guildId,
    scanLimit: options.scanLimit || DEFAULT_SCAN_LIMIT,
    touched: new Map(),
    warnings: []
  };

  console.log(`KOOK guild: ${guildId}`);
  console.log(apply ? "模式：执行 KOOK 第 04 版频道清理" : "模式：KOOK 只审计，不修改频道");

  context.channels = await listKookChannels(token, guildId);
  const botUser = await kookGet(token, "/user/me");
  context.botId = String(botUser?.id || botUser?.user_id || "");

  await fixKookSelfOrder(context, env);
  await fixKookDispatchDuplicate(context, env);
  await printKookSummary(context);

  return {
    mode: apply ? "apply" : "dry-run",
    warnings: context.warnings
  };
}

async function fixKookSelfOrder(context, env) {
  const dispatch = resolveKookTextChannel(context, env, "DISPATCH_CHANNEL", ["人工派单"], "K02 人工派单");
  const aiDispatch = resolveKookTextChannel(context, env, "AI_DISPATCH_CHANNEL", ["AI派单", "ai派单"], "K02 AI 派单");
  const nav = resolveKookTextChannel(context, env, "NAV_CHANNEL", ["店内导航", "频道简介"], "K02 店内导航");
  const recharge = resolveKookTextChannel(context, env, "RECHARGE_CHANNEL", ["充值审核", "充值方式", "充值"], "K02 充值审核", false);

  if (dispatch) {
    await deleteKookMessages(context, dispatch, "K02 删除人工派单里的自助下单旧文案", isLegacyOrderMessage);
  }

  if (aiDispatch) {
    await upsertKookMessage(
      context,
      aiDispatch,
      CONTENT.aiCustomerOrder.marker,
      CONTENT.aiCustomerOrder.body({ recharge }),
      "K02 AI 派单客户下单格式"
    );
  }

  if (nav) {
    await upsertKookMessage(
      context,
      nav,
      CONTENT.navSelfOrder.marker,
      CONTENT.navSelfOrder.body({ aiDispatch }),
      "K02 店内导航自助下单入口"
    );
  }
}

async function fixKookDispatchDuplicate(context, env) {
  const dispatch = resolveKookTextChannel(context, env, "DISPATCH_CHANNEL", ["人工派单"], "K03 人工派单");
  if (!dispatch) return;

  const messages = await getKookRecentMessages(context, dispatch);
  const targets = messages.filter((message) => hasAny(getContent(message), ["人工派单大厅", "May猫饼·人工派单大厅", "May猫饼 · 人工派单大厅"]));
  if (targets.length <= 1) {
    console.log(`✓ K03 人工派单简介无需去重，候选 ${targets.length} 条`);
    return;
  }

  const keep =
    targets.find((message) => {
      const content = getContent(message);
      return hasAll(content, ["报名格式", "段位", "报价", "可服务时间", "性格优势", "是否可试音"]);
    }) || longestKookMessage(targets);

  for (const message of targets) {
    if (getKookMessageId(message) === getKookMessageId(keep)) continue;
    await deleteOneKookMessage(context, dispatch, message, "K03 删除人工派单重复简介");
  }
}

async function upsertKookMessage(context, channel, marker, body, label) {
  markTouched(context, channel);
  const messages = await getKookRecentMessages(context, channel);
  const targets = messages.filter((message) => getContent(message).includes(marker));

  if (!targets.length) {
    await mutate(context, `${label}：#${channel.name} 发新说明`, async () => {
      await kookPost(context.token, "/message/create", {
        type: 9,
        target_id: channel.id,
        content: body
      });
      await sleep(250);
    });
    return;
  }

  const keep = longestKookMessage(targets);
  for (const message of targets) {
    if (getKookMessageId(message) === getKookMessageId(keep)) continue;
    await deleteOneKookMessage(context, channel, message, `${label} 删除重复说明`);
  }

  if (getContent(keep) === body) {
    console.log(`✓ ${label} 已正确：#${channel.name}`);
    return;
  }

  await mutate(context, `${label}：#${channel.name} 编辑已有说明`, async () => {
    await kookEditMessage(context.token, getKookMessageId(keep), body);
    await sleep(250);
  });
}

async function deleteKookMessages(context, channel, label, predicate) {
  const messages = await getKookRecentMessages(context, channel);
  const targets = messages.filter(predicate);
  if (!targets.length) {
    console.log(`✓ ${label} 未发现需删除消息`);
    return;
  }

  for (const message of targets) {
    await deleteOneKookMessage(context, channel, message, label);
  }
}

async function deleteOneKookMessage(context, channel, message, label) {
  markTouched(context, channel);
  await mutate(context, `${label}：#${channel.name} message=${getKookMessageId(message)}`, async () => {
    await kookDeleteMessage(context.token, getKookMessageId(message));
    await sleep(250);
  });
}

async function getKookRecentMessages(context, channel) {
  const messages = await kookGetMessages(context.token, channel.id, context.scanLimit || DEFAULT_SCAN_LIMIT);
  return Array.isArray(messages) ? messages : [];
}

async function listKookChannels(token, guildId) {
  const firstPage = await kookGet(token, `/channel/list?guild_id=${encodeURIComponent(guildId)}&page=1&page_size=100`);
  const items = Array.isArray(firstPage?.items) ? [...firstPage.items] : [];
  const pageTotal = Number(firstPage?.meta?.page_total || 1);

  for (let page = 2; page <= pageTotal; page += 1) {
    const data = await kookGet(token, `/channel/list?guild_id=${encodeURIComponent(guildId)}&page=${page}&page_size=100`);
    if (Array.isArray(data?.items)) items.push(...data.items);
  }

  return items.map((item) => ({
    ...item,
    id: String(item.id),
    name: String(item.name || ""),
    type: Number(item.type)
  }));
}

async function printKookSummary(context) {
  console.log("\nKOOK 执行摘要：");
  if (!context.touched.size) {
    console.log("  - 没有 KOOK 频道被列入修改/补文案清单");
  }
  for (const channel of context.touched.values()) {
    const messages = await getKookRecentMessages(context, channel);
    console.log(`  - #${channel.name}：最近 ${messages.length} 条消息已扫描`);
  }
  addWarning(context, "K04 其他 KOOK 频道未逐一深查，建议后续按 Discord 同规则复核。");
  if (context.warnings.length) {
    console.log("\nKOOK 需人工确认：");
    for (const warning of context.warnings) console.log(`  - ${warning}`);
  }
}

async function mutate(context, label, fn) {
  if (!context.apply) {
    console.log(`计划：${label}`);
    return null;
  }

  const result = await fn();
  console.log(`✓ ${label}`);
  return result;
}

function resolveKookTextChannel(context, env, envKey, patterns, label, warn = true) {
  const envId = env[`KOOK_${envKey}_ID`] || env[envKey] || KNOWN_KOOK_CHANNEL_IDS[envKey];
  const channel = envId
    ? context.channels.find((item) => String(item.id) === String(envId))
    : findChannel(context.channels, patterns, 1);
  if (!channel && warn) addWarning(context, `${label} 未找到，跳过`);
  return channel || null;
}

function markTouched(context, channel) {
  context.touched.set(channel.id, channel);
}

function addWarning(context, message) {
  context.warnings.push(message);
  console.log(`⚠️ ${message}`);
}

function mentionOrName(channel) {
  return channel?.id ? `(chn)${channel.id}(chn)` : "对应频道";
}

function getContent(message) {
  return String(message.content || "");
}

function getKookMessageId(message) {
  return String(message.msg_id || message.id || "");
}

function hasAny(content, keywords) {
  return keywords.some((keyword) => content.includes(keyword));
}

function hasAll(content, keywords) {
  return keywords.every((keyword) => content.includes(keyword));
}

function longestKookMessage(messages) {
  return [...messages].sort((a, b) => getContent(b).length - getContent(a).length || getKookMessageId(b).localeCompare(getKookMessageId(a)))[0];
}

function isLegacyOrderMessage(message) {
  const content = getContent(message);
  return hasAny(content, [
    "自助下单格式",
    "前往网站支付",
    "网站下单",
    "下单地址",
    "maycatplay.com/customer/order",
    "未在网站完成下单支付"
  ]);
}

module.exports = {
  CONTENT,
  runKookWalkthroughFix04
};
