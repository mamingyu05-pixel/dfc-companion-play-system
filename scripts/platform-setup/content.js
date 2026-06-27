const missingChannel = (key) => `[频道未找到：${key}，请手动配置]`;

function channelMention(platform, channelIds, key) {
  const channelId = channelIds[key];
  if (!channelId) return missingChannel(key);
  return platform === "kook" ? `(chn)${channelId}(chn)` : `<#${channelId}>`;
}

function renderTemplate(template, platform, channelIds) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => channelMention(platform, channelIds, key));
}

const CONTENT = {
  INTRO_CUSTOMER: {
    marker: "客户专区",
    discord: `## 🐱 May猫饼电竞 · 客户频道导航

**先接待，再试听，确认舒服了再下单。**

━━━━━━ 📌 客户专区 ━━━━━━

📢 公告通知   → {{ANNOUNCE_CHANNEL}}
📋 服务价目   → {{SERVICE_CHANNEL}}
💳 充值方式   → {{RECHARGE_CHANNEL}}
🎧 查看陪玩   → {{COMPANION_CHANNEL}}
⭐ 好评展示   → {{REVIEW_CHANNEL}}
💬 公屏聊天   → {{CHAT_CHANNEL}}

━━━━━━ 🎮 下单专区 ━━━━━━

🙋 找客服派单 → {{SUPPORT1_CHANNEL}} / {{SUPPORT2_CHANNEL}}
📝 自助下单   → {{ORDER_CHANNEL}}`,
    kook: `**May猫饼电竞 · 客户频道导航**

先接待，再试听，确认舒服了再下单。

---

**📌 客户专区**

📢 公告通知   → {{ANNOUNCE_CHANNEL}}
📋 服务价目   → {{SERVICE_CHANNEL}}
💳 充值方式   → {{RECHARGE_CHANNEL}}
🎧 查看陪玩   → {{COMPANION_CHANNEL}}
⭐ 好评展示   → {{REVIEW_CHANNEL}}
💬 公屏聊天   → {{CHAT_CHANNEL}}

---

**🎮 下单专区**

🙋 找客服派单 → {{SUPPORT_CHANNEL}}
📝 自助下单   → {{ORDER_CHANNEL}}`
  },

  INTRO_COMPANION: {
    marker: "陪玩入驻",
    discord: `━━━━━━ 🏠 陪玩入驻 ━━━━━━

➡️ 考核标准   → {{EXAM_CHANNEL}}
📋 入职申请   → 联系管理员，考核通过后由管理员开通账号
🔖 技能登记   → {{TAG_CHANNEL}}`,
    kook: `---

**🏠 陪玩入驻**

➡️ 考核标准   → {{EXAM_CHANNEL}}
📋 入职申请   → 联系管理员，考核通过后开通账号
🔖 技能登记   → {{TAG_CHANNEL}}`
  },

  INTRO_OFFICIAL: {
    marker: "官方渠道",
    discord: `━━━━━━ 🌐 官方渠道 ━━━━━━

🌐 官网：https://maycatplay.com/customer/
💬 微信客服：MMY-NB
🟡 KOOK：邀请码 i0o2qA
🔵 Discord：discord.gg/dX5prAZMPu

━━━━━━ 📐 平台规则 ━━━━━━

■ 先充值后下单，不赊账不先打
■ 超时计费：不超 15 分钟不收费，超 15 分钟按半小时算，超 40 分钟按 1 小时算
■ 禁止私下添加陪玩联系方式，平台外交易概不负责
■ 订单、充值、提现、投诉均以 maycatplay.com 后台记录为准
■ 禁止辱骂、骚扰、歧视行为
■ 禁止在平台内发布广告或代练信息`,
    kook: `**🌐 官方渠道**

🌐 官网：https://maycatplay.com/customer/
💬 微信客服：MMY-NB
🟡 KOOK：邀请码 i0o2qA
🔵 Discord：discord.gg/dX5prAZMPu

---

**📐 平台规则**

■ 先充值后下单，不赊账不先打
■ 超时计费：不超 15 分钟不收费，超 15 分钟按半小时算，超 40 分钟按 1 小时算
■ 禁止私下添加陪玩联系方式，平台外交易概不负责
■ 订单、充值、提现、投诉均以 maycatplay.com 后台记录为准
■ 禁止辱骂、骚扰、歧视行为
■ 禁止在平台内发布广告或代练信息`
  },

  ORDER_FORMAT: {
    marker: "自助下单格式",
    discord: `📝 **自助下单格式**

按以下格式发消息，客服 / 陪玩确认后再去网站支付，支付完成后服务开始：

游戏：
模式：
时长：（小时）
价格预算：（或填“按陪玩报价”）
试听：需要 / 不需要
开始时间：现在 / 预约___
陪玩偏好：指定___ / 平台推荐
备注：

⚠️ 未在网站完成下单支付，服务不开始
🌐 下单地址：https://maycatplay.com/customer/order/`,
    kook: `📝 **自助下单格式**

按以下格式发消息，客服 / 陪玩确认后再去网站支付，支付完成后服务开始：

游戏：
模式：
时长：（小时）
价格预算：（或填“按陪玩报价”）
试听：需要 / 不需要
开始时间：现在 / 预约___
陪玩偏好：指定___ / 平台推荐
备注：

⚠️ 未在网站完成下单支付，服务不开始
🌐 下单地址：https://maycatplay.com/customer/order/`
  },

  SERVICE_ITEMS: {
    marker: "服务项目",
    discord: `📋 May猫饼电竞 · 服务项目

━━━━━━ 支持游戏 ━━━━━━
三角洲行动 / 英雄联盟 / 无畏契约 / CS2
PUBG 绝地求生 / Apex 英雄 / 永劫无间 / 王者荣耀

━━━━━━ 服务内容 ━━━━━━
✓ 游戏陪玩（可语音 / 可不语音）
✓ 赛前试听确认（推荐新客户先试听）
✓ 带排位 / 娱乐模式

━━━━━━ 价格 ━━━━━━
¥100 - ¥108 / 小时（以陪玩主页标价为准）
最短 1 小时起

━━━━━━ 超时计费规则 ━━━━━━
超时不足 15 分钟：不收费
超时 15 - 40 分钟：按半小时收费
超时超过 40 分钟：按 1 小时收费

━━━━━━ 下单 ━━━━━━
🌐 https://maycatplay.com/customer/`,
    kook: `📋 **May猫饼电竞 · 服务项目**

---

**支持游戏**
三角洲行动 / 英雄联盟 / 无畏契约 / CS2
PUBG 绝地求生 / Apex 英雄 / 永劫无间 / 王者荣耀

---

**服务内容**
✓ 游戏陪玩（可语音 / 可不语音）
✓ 赛前试听确认（推荐新客户先试听）
✓ 带排位 / 娱乐模式

---

**价格**
¥100 - ¥108 / 小时（以陪玩主页标价为准）
最短 1 小时起

---

**超时计费规则**
超时不足 15 分钟：不收费
超时 15 - 40 分钟：按半小时收费
超时超过 40 分钟：按 1 小时收费

---

**下单**
🌐 https://maycatplay.com/customer/`
  },

  DISPATCH_RULES: {
    marker: "人工派单大厅",
    discord: `📢 May猫饼 · 人工派单大厅

客服或 AI 会在此发布派单信息，陪玩按格式报名，管理员最终确认。

报名格式：
段位/水平：
报价：（每小时）
可服务时间：
性格优势：
是否可试听：

■ 报名不等于接单，最终以后端订单状态为准
■ 禁止绕过平台私下交易
■ 下单、派单、充值、提现均以 maycatplay.com 后台记录为准`,
    kook: `📢 **May猫饼 · 人工派单大厅**

客服或 AI 会在此发布派单信息，陪玩按格式报名，管理员最终确认。

报名格式：
段位/水平：
报价：（每小时）
可服务时间：
性格优势：
是否可试听：

■ 报名不等于接单，最终以后端订单状态为准
■ 禁止绕过平台私下交易
■ 下单、派单、充值、提现均以 maycatplay.com 后台记录为准`
  }
};

module.exports = {
  CONTENT,
  renderTemplate
};
