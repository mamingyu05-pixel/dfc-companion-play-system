const path = require("node:path");

const CARD_DIR = path.join(__dirname, "price-cards");
const DISCORD_PRICE_FORUM_NAME = "💰｜价格清单";
const DISCORD_SERVICE_PRICE_CHANNEL_ID = "1517375867989524544";
const KOOK_SERVICE_PRICE_CHANNEL_ID = "7899539614518714";
const KOOK_GUILD_ID = "3189962583916682";

const PRICE_NOTICE = {
  key: "price-notice",
  title: "00｜May猫饼价目说明",
  marker: "[MayCatPriceList:price-notice]",
  content: [
    "[MayCatPriceList:price-notice]",
    "🐱 May猫饼电竞 · 统一价目",
    "",
    "语音/排位陪玩：¥128 / 小时",
    "娱乐陪玩：¥108 / 小时",
    "",
    "全部陪玩均可语音，不设静音价；平台不做代练、代打、上号服务。",
    "支持游戏：三角洲行动、英雄联盟、无畏契约、CS2、PUBG 绝地求生、Apex 英雄、永劫无间、塔科夫/COD。",
    "",
    "充值福利：充100得105 / 充300得320 / 充500得540 / 充1000得1100。",
    "下单、扣费、服务、收入均以后台记录为准。"
  ].join("\n")
};

const PRICE_POSTS = [
  {
    key: "delta-force",
    title: "01｜三角洲行动",
    file: "delta-force.png",
    caption: "三角洲行动陪玩：语音/排位 ¥128/小时，娱乐 ¥108/小时。支持试音，按后台订单确认。"
  },
  {
    key: "league-of-legends",
    title: "02｜英雄联盟",
    file: "league-of-legends.png",
    caption: "英雄联盟陪玩：语音/排位 ¥128/小时，娱乐 ¥108/小时。支持双排、娱乐、试音。"
  },
  {
    key: "valorant",
    title: "03｜无畏契约",
    file: "valorant.png",
    caption: "无畏契约陪玩：语音/排位 ¥128/小时，娱乐 ¥108/小时。可先试音再确认。"
  },
  {
    key: "counter-strike-2",
    title: "04｜CS2",
    file: "counter-strike-2.png",
    caption: "CS2 陪玩：语音/排位 ¥128/小时，娱乐 ¥108/小时。最终以后台订单为准。"
  },
  {
    key: "pubg",
    title: "05｜PUBG 绝地求生",
    file: "pubg.png",
    caption: "PUBG 绝地求生陪玩：语音/排位 ¥128/小时，娱乐 ¥108/小时。"
  },
  {
    key: "apex-legends",
    title: "06｜Apex 英雄",
    file: "apex-legends.png",
    caption: "Apex 英雄陪玩：语音/排位 ¥128/小时，娱乐 ¥108/小时。"
  },
  {
    key: "naraka-bladepoint",
    title: "07｜永劫无间",
    file: "naraka-bladepoint.png",
    caption: "永劫无间陪玩：语音/排位 ¥128/小时，娱乐 ¥108/小时。"
  },
  {
    key: "tarkov-cod",
    title: "08｜塔科夫 / COD",
    file: "tarkov-cod.png",
    caption: "塔科夫 / COD 陪玩：语音/排位 ¥128/小时，娱乐 ¥108/小时。"
  },
  {
    key: "recharge-bonus",
    title: "09｜充值福利",
    file: "recharge-bonus.png",
    caption: "预存福利：充100得105，充300得320，充500得540，充1000得1100。人工审核通过后入账。"
  }
].map((post) => ({
  ...post,
  marker: `[MayCatPriceList:${post.key}]`,
  content: `[MayCatPriceList:${post.key}]\n${post.caption}`
}));

module.exports = {
  CARD_DIR,
  DISCORD_PRICE_FORUM_NAME,
  DISCORD_SERVICE_PRICE_CHANNEL_ID,
  KOOK_SERVICE_PRICE_CHANNEL_ID,
  KOOK_GUILD_ID,
  PRICE_NOTICE,
  PRICE_POSTS
};
