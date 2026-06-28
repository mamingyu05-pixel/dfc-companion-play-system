const { discordDelete, discordEditMessage, discordGet, discordPatch, discordPost, discordPut, sleep } = require("../lib/utils");
const { findChannel, getBotId, getDiscordEnv, getGuildChannels } = require("./shared");

const TARGET_COMMUNITY_NAME = "🍏｜社区守则";
const DEFAULT_SCAN_LIMIT = 300;

const CONTENT = {
  onboarding: {
    marker: "陪玩入职须知",
    body: ({ exam, tag }) => `## 🟥 May猫饼电竞 · 陪玩入职须知

想入驻陪玩，按下面流程走：

1. 先阅读考核标准：${mentionOrName(exam)}
2. 联系管理员提交入职申请。
3. 管理员安排试音和试玩考核。
4. 通过后登记技能标签：${mentionOrName(tag)}
5. 管理员开通后台账号并上架陪玩资料。

申请格式：
昵称：
年龄：
主玩游戏 / 段位：
可服务时间：
是否可语音 / 可试音：
陪玩风格：
过往经验：

注意：
■ 未通过考核前不要私下接单。
■ 所有订单、价格、结算以 maycatplay.com 后台记录为准。
■ 禁止绕过平台私下交易。`
  },
  examMerged: {
    marker: "陪玩考核标准",
    body: ({ onboarding }) => `## 📋 May猫饼电竞 · 陪玩考核标准

━━━━━━ 基本要求 ━━━━━━
▸ 年满 18 岁，有稳定游戏时间
▸ 普通话清晰，无严重口音 / 噪音环境
▸ 至少一款支持游戏达到中高段位
▸ 性格稳定、不易情绪化，懂照顾客户情绪
▸ 有耐心，能接受不同水平的客户

━━━━━━ 考核流程 ━━━━━━
① 填写入职申请（见 ${mentionOrName(onboarding)}）
② 管理员安排试音，确认声线和沟通风格
③ 试玩一局，确认游戏水平
④ 通过后开通账号并上架网站
⑤ 开始接单

━━━━━━ 游戏考核细则（三角洲）━━━━━━
※ 考核环境禁网咖 / 电竞房；外挂异常对局不计；考核期间不允许接暗号；其余由考核官视情况而定
· 单考：允许六套、AW；3 取 2 择优（击杀）；击杀数 12 / 14 / 16 / 18
· 双考：用五套装备，不可六套 / AW（黑屋局视情况、成功需标注）；击杀+撤离 1 局 1000W（3 取 2）择优；击杀数 15 / 17 / 19 / 21；人头差 ≤ 3
（哈吉米=小哈 / 中哈 / 大哈 / 魔王哈，为段位档位称呼）

━━━━━━ 通过后处理 ━━━━━━
① 进押金查挂群（3 天内）② 进店规服务培训群（3 天内）③ 开始培训接单 ④ 体验单每周最低 1 单

▸ 禁止私下向客户索取联系方式　▸ 禁止平台外私接
▸ 违规一次警告，二次直接下架　▸ 一切以 maycatplay.com 后台记录为准`
  },
  violationMerged: {
    marker: "违规处理制度",
    body: () => `## ⚠️ May猫饼电竞 · 违规处理制度（周结工资制）

━━━━━━ 一级 · 警告级 ━━━━━━（累计 3 次升二级）
· 未及时提交订单 / 战绩截图；服务后未及时反馈
处罚：首次警告 → 第二次罚 20 元 → 第三次升二级

━━━━━━ 二级 · 罚款级（50~200 元）━━━━━━
· 放鸽子 / 接单后失联：50 → 100 → 清退
· 消极接单 / 无故拒单 / 长期挑单：50~100 元，严重暂停派单
· 服务态度差（与客户争吵 / 爆粗 / 嘲讽 / 甩锅）：首次 100 元，严重清退
· 虚报战绩 / 改图 / 谎报：首次 200 元，再犯永久拉黑

━━━━━━ 三级 · 清退级（扣全部工资 + 没收保证金 + 永久拉黑）━━━━━━
· 私单（绕过平台私下收钱）· 挖人（挖老板 / 打手 / 拉管理）
· 使用外挂（含借号、明知队友开挂仍长期组队）
· 恶意毁单（私藏物资 / 摆烂 / 炸队友 / 故意掉分 / 对喷致退款）

━━━━━━ 保证金 & 结算 ━━━━━━
· 工资周结；保证金用于违规扣罚，清退级没收
· 所有处罚、订单、结算均以 maycatplay.com 后台记录为准`
  },
  complaint: {
    marker: "投诉处理说明",
    body: () => `## 🧯 May猫饼电竞 · 投诉处理说明

遇到服务纠纷、态度问题、超时计费争议或其他异常，请按格式提交：

订单号：
问题类型：
发生时间：
相关陪玩 / 客服：
问题描述：
证据截图 / 录屏：
希望处理结果：

管理员会按后台订单记录和证据处理。请不要刷屏、辱骂或重复提交同一问题。`
  },
  announcement: {
    marker: "官方公告",
    body: () => `## 📣 May猫饼电竞 · 官方公告

本频道仅发布平台公告、活动通知和重要规则变更。

当前正式入口：
🌐 官网：https://maycatplay.com/customer/
💬 微信客服：MMY-NB
🟡 KOOK：邀请码 i0o2qA
🔵 Discord：discord.gg/dX5prAZMPu

充值、下单、售后、投诉均以 maycatplay.com 后台记录和管理员确认为准。`
  },
  community: {
    marker: "社区守则",
    body: () => `## 🍏 May猫饼电竞 · 社区守则

1. 尊重他人，禁止辱骂、骚扰、歧视和人身攻击。
2. 禁止广告、刷屏、钓鱼链接、恶意引流和无关推广。
3. 禁止私下交易、绕过平台付款或索要客户/陪玩的私人联系方式。
4. 禁止泄露他人隐私、订单信息、聊天记录和支付信息。
5. 频道按用途发言，客服、下单、投诉、入驻请去对应频道。
6. 发现违规请截图留证并联系管理员处理。

违反守则可能被禁言、移出服务器或取消平台资格。`
  },
  reviews: {
    marker: "好评征集说明",
    body: () => `## ⭐ May猫饼电竞 · 好评展示

本频道用于展示客户真实好评和服务反馈。

想投稿好评请发给客服：
订单号：
陪玩昵称：
好评内容：
是否允许匿名展示：

展示前会隐藏手机号、微信号、订单隐私等敏感信息。`
  },
  predeposit: {
    marker: "预存福利说明",
    body: () => `## 💎 May猫饼电竞 · 预存福利

预存/充值后金额进入网站账户余额，下单时从余额扣减。

规则说明：
■ 充值请在充值审核频道提交截图，不要私下转给个人。
■ 到账以充值审核频道和网站后台记录为准。
■ 活动福利、赠送额度、有效期以当期公告或客服确认内容为准。
■ 退款、争议和异常订单由管理员按后台记录人工处理。
■ 网页只用于查余额、流水、陪玩资料和订单记录。`
  },
  tagRegistration: {
    marker: "陪玩标签登记说明",
    body: () => `## 🏷｜陪玩 tag 登记说明

入驻或更新资料时，请按格式登记标签，方便客户筛选和客服派单：

主玩游戏：
段位 / 水平：
擅长模式：
可服务时段：
是否可语音：
声线 / 沟通风格：
接单价格：
是否可试音：
备注：

示例标签：三角洲、排位、娱乐、可教学、可试音、话多、安静陪打、女声、男声、国际服。`
  },
  skillRegistration: {
    marker: "技能登记指引",
    body: ({ tag }) => `## 🔖 May猫饼电竞 · 技能登记指引

这里是陪玩技能资料入口。

请前往 ${mentionOrName(tag)} 按格式登记游戏、段位、模式、声线、可服务时间和是否可试音。

资料变更后也在 tag 登记频道补充最新信息，管理员会同步到后台陪玩资料。`
  },
  selfOrder: {
    marker: "自助下单 = 走 AI 派单",
    body: ({ recharge, aiDispatch }) => `## 📝 自助下单 = 走 AI 派单

下单前请确认钱包余额充足（充值见 ${mentionOrName(recharge)}；余额、流水、订单可在网页后台 maycatplay.com 查询）。

按以下格式在 ${mentionOrName(aiDispatch)} 发单：
AI 客服会整理成派单卡并 @ 匹配的陪玩，确认人选后由客服从你的余额扣费并开始服务。

游戏：
模式：
时长（小时）：
预算：（或填“按陪玩报价”）
试听：需要 / 不需要
开始时间：现在 / 预约___
陪玩偏好：指定___ / 平台推荐
备注：

⚠️ 余额不足无法派单。下单、扣费、服务、收入均以网站后台记录为准。
🌐 网页只用于查余额、看陪玩、查记录，不在网页下单。`
  },
  aiCustomerOrder: {
    marker: "客户下单格式",
    body: ({ recharge }) => `## 🤖 May猫饼电竞 · 客户下单格式

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
  }
};

const EXACT_TEST_MESSAGES = [
  "这个公告可以改一下",
  "这是个duplicate 还没改完",
  "May猫饼试音派单，有空的陪玩可以报名",
  "May猫饼 AI 派单，有空的陪玩可以报名"
];

const SUPPORT_TEST_MESSAGES = new Set([
  "下单",
  "三角洲",
  "没要求",
  "随意模式",
  "开始",
  "现在"
]);

function parseOptions(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  const limitArg = argv.find((arg) => arg.startsWith("--scan-limit="));
  const scanLimit = limitArg ? Number(limitArg.split("=")[1]) : DEFAULT_SCAN_LIMIT;

  return {
    apply: args.has("--apply"),
    confirmCleanup: args.has("--confirm-cleanup"),
    scanLimit: Number.isFinite(scanLimit) ? Math.max(50, Math.min(1000, scanLimit)) : DEFAULT_SCAN_LIMIT
  };
}

async function runWalkthroughFix04(options = parseOptions()) {
  const { token, guildId } = getDiscordEnv();
  const apply = Boolean(options.apply && options.confirmCleanup);
  const context = {
    apply,
    scanLimit: options.scanLimit || DEFAULT_SCAN_LIMIT,
    token,
    guildId,
    touched: new Map(),
    warnings: []
  };

  console.log(`Discord guild: ${guildId}`);
  console.log(apply ? "模式：执行第 04 版频道清理" : "模式：只审计，不修改频道");
  if (options.apply && !options.confirmCleanup) {
    console.log("⚠️ 已传入 --apply，但缺少 --confirm-cleanup，本次仍按只审计处理");
  }

  const channels = await getGuildChannels(token, guildId);
  context.channels = channels;
  context.botId = await getBotId(token);

  await fixBotIntroDuplicates(context);
  await fixDispatchChannels(context);
  await fixWrongChannelContent(context);
  await fixPlaceholdersAndNames(context);
  await fillEmptyChannels(context);
  await fixMergedRules(context);
  await fixSelfOrderFlow(context);
  await checkRemainingItems(context);
  await printSummary(context);

  if (!apply) {
    console.log("\n确认计划后执行：");
    console.log("node scripts/platform-setup/walkthrough-fix-04.js --apply --confirm-cleanup");
  }

  return {
    mode: apply ? "apply" : "dry-run",
    warnings: context.warnings
  };
}

async function fixBotIntroDuplicates(context) {
  const dedupeChannels = [
    ["💳｜充值审核", ["充值审核"]],
    ["💸｜提现审核", ["提现审核"]],
    ["🛎｜管理提醒", ["管理提醒"]],
    ["🧯｜投诉处理", ["投诉处理"]]
  ];

  for (const [label, patterns] of dedupeChannels) {
    const channel = requireTextChannel(context, patterns, label);
    if (!channel) continue;
    await dedupeIdenticalBotMessages(context, channel, label);
  }

  const aiDispatch = requireTextChannel(context, ["ai派单", "AI派单"], "🤖｜ai-派单");
  if (aiDispatch) {
    await keepBestBotMessage(context, aiDispatch, "C05 ai-派单简介", {
      predicate: (message) => {
        const content = getContent(message);
        if (hasAny(content, [CONTENT.aiCustomerOrder.marker, CONTENT.selfOrder.marker, "客户下单格式"])) return false;
        return hasAny(content, ["AI 派单", "ai-派单", "报名建议", "流单", "陪玩报名"]);
      },
      keep: (messages) =>
        messages.find((message) => hasAny(getContent(message), ["报名建议", "流单规则", "流单"])) ||
        longestMessage(messages)
    });
  }
}

async function fixDispatchChannels(context) {
  const dispatch = requireTextChannel(context, ["人工派单"], "📣｜人工派单");
  if (!dispatch) return;

  await keepBestBotMessage(context, dispatch, "C06 人工派单简介", {
    predicate: (message) => hasAny(getContent(message), ["人工派单大厅", "人工派单"]),
    keep: (messages) =>
      messages.find((message) => {
        const content = getContent(message);
        return hasAll(content, ["报名格式", "段位", "报价", "可服务时间", "性格优势", "是否可试音"]);
      }) || longestMessage(messages)
  });

  await deleteMessages(context, dispatch, "C13 人工派单测试消息", (message) =>
    EXACT_TEST_MESSAGES.some((text) => getContent(message).includes(text))
  );
}

async function fixWrongChannelContent(context) {
  const onboarding = requireTextChannel(context, ["考核入职须知", "入职须知"], "🟥｜考核入职须知");
  const exam = findTextChannel(context.channels, ["考核标准"]);
  const tag = findTextChannel(context.channels, ["陪玩tag登记", "tag登记"]);

  if (onboarding) {
    await deleteBotMessages(context, onboarding, "C09 错放的考核标准内容", (message) => {
      const content = getContent(message);
      return hasAny(content, ["陪玩考核标准"]) || hasAll(content, ["基本要求", "考核流程"]);
    });
    await upsertManagedMessage(context, onboarding, CONTENT.onboarding.marker, CONTENT.onboarding.body({ exam, tag }), "C09 入职须知正式文案");
  }

  const complaint = requireTextChannel(context, ["投诉处理"], "🧯｜投诉处理");
  if (complaint) {
    await deleteBotMessages(context, complaint, "C10 错位违规处理规则", (message) => hasAny(getContent(message), ["违规处理规则"]));
    await dedupeIdenticalBotMessages(context, complaint, "C04 投诉处理简介");
    await upsertManagedMessage(context, complaint, CONTENT.complaint.marker, CONTENT.complaint.body(), "C10 投诉处理正式文案", {
      fallbackPredicate: (message) => hasAny(getContent(message), ["投诉处理", "投诉"])
    });
  }
}

async function fixPlaceholdersAndNames(context) {
  const announcement = requireTextChannel(context, ["公告通知", "公告"], "📣｜公告通知");
  if (announcement) {
    await deleteMessages(context, announcement, "C11 公告占位/入服系统消息", (message) => {
      const content = getContent(message);
      return content.includes("这个公告可以改一下") || Number(message.type) === 7 || hasAny(content, ["降落了", "打个招呼吧"]);
    });
    await upsertManagedMessage(context, announcement, CONTENT.announcement.marker, CONTENT.announcement.body(), "C11 正式公告");
  }

  const community = requireTextChannel(context, ["社区守则"], "🍏｜社区守则");
  if (community) {
    if (community.name !== TARGET_COMMUNITY_NAME) {
      await mutate(context, `C15 重命名 ${community.name} -> ${TARGET_COMMUNITY_NAME}`, async () => {
        await discordPatch(context.token, `/channels/${community.id}`, { name: TARGET_COMMUNITY_NAME });
        community.name = TARGET_COMMUNITY_NAME;
      });
    } else {
      console.log(`✓ C15 频道名已正确：${TARGET_COMMUNITY_NAME}`);
    }
    await deleteMessages(context, community, "C12 社区守则残留备注", (message) => getContent(message).includes("这是个duplicate 还没改完"));
    await upsertManagedMessage(context, community, CONTENT.community.marker, CONTENT.community.body(), "C12 正式社区守则");
  }

  const support = requireTextChannel(context, ["客服接待-1-厅", "客服接待1厅", "客服接待1"], "💬｜客服接待-1-厅");
  if (support) {
    await deleteMessages(context, support, "C14 客服接待测试对话", (message) => {
      const content = normalizeText(getContent(message));
      return SUPPORT_TEST_MESSAGES.has(content) || content.includes("下单三角洲没要求");
    });
    await dedupeIdenticalBotMessages(context, support, "C14 客服接待简介");
  }
}

async function fillEmptyChannels(context) {
  const reviews = requireTextChannel(context, ["好评展示"], "⭐｜好评展示");
  if (reviews) {
    await upsertManagedMessage(context, reviews, CONTENT.reviews.marker, CONTENT.reviews.body(), "C16 好评展示说明");
  }

  const predeposit = requireTextChannel(context, ["预存福利"], "💎｜预存福利");
  if (predeposit) {
    await upsertManagedMessage(context, predeposit, CONTENT.predeposit.marker, CONTENT.predeposit.body(), "C17 预存福利说明");
  }

  const tag = requireTextChannel(context, ["陪玩tag登记", "tag登记"], "🏷｜陪玩tag登记");
  if (tag) {
    await upsertManagedMessage(context, tag, CONTENT.tagRegistration.marker, CONTENT.tagRegistration.body(), "C18 tag 登记说明");
  }

  const skill = requireTextChannel(context, ["技能登记"], "🔖｜技能登记");
  if (skill) {
    await upsertManagedMessage(context, skill, CONTENT.skillRegistration.marker, CONTENT.skillRegistration.body({ tag }), "C18 技能登记指引");
  }
}

async function fixMergedRules(context) {
  const onboarding = findTextChannel(context.channels, ["考核入职须知", "入职须知"]);
  const exam = requireTextChannel(context, ["考核标准"], "C07 考核标准");
  if (exam) {
    await replaceWithSingleManagedMessage(
      context,
      exam,
      CONTENT.examMerged.marker,
      CONTENT.examMerged.body({ onboarding }),
      "C07 考核标准合并文案",
      (message) => {
        const content = getContent(message);
        return hasAny(content, ["陪玩考核标准", "三角洲具体考核", "单考", "双考", "押金查挂群", "查挂群"]);
      }
    );
  }

  const violation = requireTextChannel(context, ["违规处理"], "C08 违规处理");
  if (violation) {
    await replaceWithSingleManagedMessage(
      context,
      violation,
      CONTENT.violationMerged.marker,
      CONTENT.violationMerged.body(),
      "C08 违规处理合并文案",
      (message) => {
        const content = getContent(message);
        return hasAny(content, ["违规处理规则", "打手违规处理制度", "周结工资制", "保证金", "清退级"]);
      }
    );
  }
}

async function fixSelfOrderFlow(context) {
  const order = requireTextChannel(context, ["自助下单", "点单"], "📝｜自助下单");
  const aiDispatch = findTextChannel(context.channels, ["ai派单", "AI派单"]);
  const recharge = findTextChannel(context.channels, ["充值审核", "充值"]);

  if (order) {
    await replaceWithSingleManagedMessage(
      context,
      order,
      CONTENT.selfOrder.marker,
      CONTENT.selfOrder.body({ recharge, aiDispatch }),
      "C19 自助下单说明书",
      isLegacyOrderMessage
    );
    await setChannelReadOnly(context, order, "C19 自助下单设为只读");
  }

  if (aiDispatch) {
    await upsertManagedMessage(
      context,
      aiDispatch,
      CONTENT.aiCustomerOrder.marker,
      CONTENT.aiCustomerOrder.body({ recharge }),
      "C19b AI 派单客户下单格式"
    );
  } else {
    addWarning(context, "C19b 未找到 AI 派单频道，无法补客户下单格式");
  }
}

async function checkRemainingItems(context) {
  addWarning(context, "H 类未逐一打开的语音/接单/聊天频道仍建议后续人工复核；本脚本只处理任务卡明确列出的频道。");
}

async function dedupeIdenticalBotMessages(context, channel, label) {
  const messages = await getRecentMessages(context, channel);
  const botMessages = messages.filter((message) => isBotMessage(message, context.botId) && getContent(message).trim());
  const groups = new Map();

  for (const message of botMessages) {
    const key = normalizeContent(getContent(message));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(message);
  }

  let removed = 0;
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const keep = longestMessage(group);
    const duplicates = group.filter((message) => message.id !== keep.id);
    for (const duplicate of duplicates) {
      await deleteOneMessage(context, channel, duplicate, `${label} 删除重复 Bot 简介`);
      removed += 1;
    }
  }

  if (!removed) console.log(`✓ ${label} 未发现完全相同的 Bot 重复消息`);
}

async function keepBestBotMessage(context, channel, label, options) {
  const messages = await getRecentMessages(context, channel);
  const targets = messages.filter((message) => isBotMessage(message, context.botId) && options.predicate(message));
  if (targets.length <= 1) {
    console.log(`✓ ${label} 无需清理，候选 ${targets.length} 条`);
    return;
  }

  const keep = options.keep(targets) || longestMessage(targets);
  for (const message of targets) {
    if (message.id === keep.id) continue;
    await deleteOneMessage(context, channel, message, `${label} 删除冗余版本`);
  }
}

async function deleteBotMessages(context, channel, label, predicate) {
  await deleteMessages(context, channel, label, (message) => isBotMessage(message, context.botId) && predicate(message));
}

async function deleteMessages(context, channel, label, predicate) {
  const messages = await getRecentMessages(context, channel);
  const targets = messages.filter(predicate);
  if (!targets.length) {
    console.log(`✓ ${label} 未发现需删除消息`);
    return;
  }

  for (const message of targets) {
    await deleteOneMessage(context, channel, message, label);
  }
}

async function deleteOneMessage(context, channel, message, label) {
  markTouched(context, channel);
  await mutate(context, `${label}：#${channel.name} message=${message.id}`, async () => {
    await discordDelete(context.token, `/channels/${channel.id}/messages/${message.id}`);
    await sleep(350);
  });
}

async function replaceWithSingleManagedMessage(context, channel, marker, body, label, legacyPredicate) {
  await upsertManagedMessage(context, channel, marker, body, label, {
    fallbackPredicate: legacyPredicate,
    replaceManual: true
  });

  const messages = await getRecentMessages(context, channel);
  const keep =
    messages.find((message) => isBotMessage(message, context.botId) && getContent(message) === body) ||
    messages.find((message) => isBotMessage(message, context.botId) && getContent(message).includes(marker));

  if (!keep) {
    addWarning(context, `${label} 未找到可保留的 Bot 新文案，跳过旧消息删除：#${channel.name}`);
    return;
  }

  const targets = messages.filter((message) => message.id !== keep.id && legacyPredicate(message));
  if (!targets.length) {
    console.log(`✓ ${label} 无旧版本需要删除：#${channel.name}`);
    return;
  }

  for (const message of targets) {
    await deleteOneMessage(context, channel, message, `${label} 删除旧版本`);
  }
}

async function upsertManagedMessage(context, channel, marker, body, label, options = {}) {
  markTouched(context, channel);
  const messages = await getRecentMessages(context, channel);
  let matchingBotMessages = messages.filter((message) => isBotMessage(message, context.botId) && getContent(message).includes(marker));
  if (!matchingBotMessages.length && options.fallbackPredicate) {
    matchingBotMessages = messages.filter((message) => isBotMessage(message, context.botId) && options.fallbackPredicate(message));
  }
  const matchingManual = messages.find((message) => !isBotMessage(message, context.botId) && getContent(message).includes(marker));

  if (matchingManual && !matchingBotMessages.length && !options.replaceManual) {
    addWarning(context, `${label} 已存在人工消息，跳过自动改写：#${channel.name}`);
    return;
  }

  if (!matchingBotMessages.length) {
    await mutate(context, `${label}：#${channel.name} 发新简介`, async () => {
      await discordPost(context.token, `/channels/${channel.id}/messages`, { content: body });
      await sleep(350);
    });
    return;
  }

  const keep = longestMessage(matchingBotMessages);
  for (const message of matchingBotMessages) {
    if (message.id === keep.id) continue;
    await deleteOneMessage(context, channel, message, `${label} 删除重复简介`);
  }

  if (getContent(keep) === body) {
    console.log(`✓ ${label} 已正确：#${channel.name}`);
    return;
  }

  await mutate(context, `${label}：#${channel.name} 编辑已有简介`, async () => {
    await discordEditMessage(context.token, channel.id, keep.id, body);
    await sleep(350);
  });
}

async function setChannelReadOnly(context, channel, label) {
  markTouched(context, channel);
  await mutate(context, `${label}：#${channel.name}`, async () => {
    await discordPut(context.token, `/channels/${channel.id}/permissions/${context.guildId}`, {
      type: 0,
      allow: "0",
      deny: "2048"
    });
    await sleep(350);
  });
}

async function getRecentMessages(context, channel) {
  const limit = context.scanLimit || DEFAULT_SCAN_LIMIT;
  const result = [];
  let before = null;

  while (result.length < limit) {
    const batchSize = Math.min(100, limit - result.length);
    const suffix = before ? `&before=${before}` : "";
    const batch = await discordGet(context.token, `/channels/${channel.id}/messages?limit=${batchSize}${suffix}`);
    if (!Array.isArray(batch) || !batch.length) break;
    result.push(...batch);
    before = batch[batch.length - 1].id;
    if (batch.length < batchSize) break;
    await sleep(250);
  }

  return result;
}

async function printSummary(context) {
  console.log("\n执行摘要：");
  if (!context.touched.size) {
    console.log("  - 没有频道被列入修改/补文案清单");
  }

  for (const channel of context.touched.values()) {
    const messages = await getRecentMessages(context, channel);
    console.log(`  - #${channel.name}：最近 ${messages.length} 条消息已扫描`);
  }

  if (context.warnings.length) {
    console.log("\n需人工确认：");
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

function requireTextChannel(context, patterns, label) {
  const channel = findTextChannel(context.channels, patterns);
  if (!channel) addWarning(context, `${label} 未找到，跳过`);
  return channel;
}

function findTextChannel(channels, patterns) {
  return findChannel(channels, patterns, 0);
}

function markTouched(context, channel) {
  context.touched.set(channel.id, channel);
}

function addWarning(context, message) {
  context.warnings.push(message);
  console.log(`⚠️ ${message}`);
}

function mentionOrName(channel) {
  return channel?.id ? `<#${channel.id}>` : "对应频道";
}

function getContent(message) {
  return String(message.content || "");
}

function isBotMessage(message, botId) {
  return String(message.author?.id || "") === String(botId);
}

function hasAny(content, keywords) {
  return keywords.some((keyword) => content.includes(keyword));
}

function hasAll(content, keywords) {
  return keywords.every((keyword) => content.includes(keyword));
}

function longestMessage(messages) {
  return [...messages].sort((a, b) => getContent(b).length - getContent(a).length || String(b.id).localeCompare(String(a.id)))[0];
}

function normalizeContent(content) {
  return normalizeText(content).replace(/\s+/g, " ");
}

function normalizeText(content) {
  return String(content || "").replace(/\s+/g, "").trim();
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
  parseOptions,
  runWalkthroughFix04
};
