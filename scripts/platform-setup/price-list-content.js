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
    "🐱 May猫饼电竞 · 价格须知",
    "",
    "· 按段位分档定价，均可语音（各游戏价目见对应帖图）；黄金以下 ¥98/时 起，高段位递增",
    "· 新客首单试音免费（限 15 分钟）",
    "· 多陪玩同享：同一客户点 2 个及以上陪玩，每人 −¥10/时",
    "· 无加班费、无任何隐藏收费；排位按老板段位计费，组排按车上最高段位",
    "· 充值预存：充¥100得¥105 / ¥300得¥320 / ¥500得¥540 / ¥1000得¥1100",
    "· 下单走 KOOK / Discord（#AI 派单 频道按格式发单）；下单、扣费、服务、收入均以网站后台记录为准"
  ].join("\n")
};

const PRICE_POSTS = [
  {
    key: "delta-force",
    title: "01｜三角洲行动",
    file: "delta-force.png",
    caption: "三角洲行动：硬核战术撤离，语音指挥陪玩。黄金以下 ¥98 起，按段位递增。\n\n均可语音 · 首单试音免费(限15分钟) · 点2个陪玩起每人−¥10/时 · 无隐藏收费"
  },
  {
    key: "league-of-legends",
    title: "02｜英雄联盟",
    file: "league-of-legends.png",
    caption: "英雄联盟：召唤师峡谷陪练，单双排/组排都接。黄金以下 ¥98 起，按段位递增。\n\n均可语音 · 首单试音免费(限15分钟) · 点2个陪玩起每人−¥10/时 · 无隐藏收费"
  },
  {
    key: "valorant",
    title: "03｜无畏契约",
    file: "valorant.png",
    caption: "无畏契约：特工战术，排位/娱乐随心开。黄金以下 ¥98 起，按段位递增。\n\n均可语音 · 首单试音免费(限15分钟) · 点2个陪玩起每人−¥10/时 · 无隐藏收费"
  },
  {
    key: "counter-strike-2",
    title: "04｜反恐精英2",
    file: "counter-strike-2.png",
    caption: "反恐精英2：竞技射击陪练，按 Premier 分数段计价，1万分以下 ¥98 起。\n\n均可语音 · 首单试音免费(限15分钟) · 点2个陪玩起每人−¥10/时 · 无隐藏收费"
  },
  {
    key: "pubg",
    title: "05｜PUBG 绝地求生",
    file: "pubg.png",
    caption: "绝地求生 PUBG：吃鸡四排陪玩，语音更默契。黄金以下 ¥98 起，按段位递增。\n\n均可语音 · 首单试音免费(限15分钟) · 点2个陪玩起每人−¥10/时 · 无隐藏收费"
  },
  {
    key: "apex-legends",
    title: "06｜Apex 英雄",
    file: "apex-legends.png",
    caption: "APEX 英雄：英雄射击组排陪玩。黄金以下 ¥98 起，按段位递增。\n\n均可语音 · 首单试音免费(限15分钟) · 点2个陪玩起每人−¥10/时 · 无隐藏收费"
  },
  {
    key: "naraka-bladepoint",
    title: "07｜永劫无间",
    file: "naraka-bladepoint.png",
    caption: "永劫无间：武侠对战陪练，单人/组队都可。勇者以下 ¥98 起，按段位递增。\n\n均可语音 · 首单试音免费(限15分钟) · 点2个陪玩起每人−¥10/时 · 无隐藏收费"
  },
  {
    key: "tarkov-cod",
    title: "08｜塔科夫 / COD",
    file: "tarkov-cod.png",
    caption: "塔科夫 / COD：硬核搜打撤 + 使命召唤。无排位分段：常规 ¥118/时、硬核深处 ¥138/时。\n\n均可语音 · 首单试音免费(限15分钟) · 点2个陪玩起每人−¥10/时 · 无隐藏收费"
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
