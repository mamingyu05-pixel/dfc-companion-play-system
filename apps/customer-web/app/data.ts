export const games = [
  { code: "DELTA_FORCE", name: "三角洲行动", category: "射击", hot: true },
  { code: "LEAGUE_OF_LEGENDS", name: "英雄联盟", category: "MOBA", hot: true },
  { code: "VALORANT", name: "无畏契约", category: "射击", hot: true },
  { code: "COUNTER_STRIKE_2", name: "CS2", category: "射击", hot: true },
  { code: "PUBG", name: "PUBG 绝地求生", category: "吃鸡", hot: true },
  { code: "APEX_LEGENDS", name: "Apex 英雄", category: "射击", hot: true },
  { code: "NARAKA_BLADEPOINT", name: "永劫无间", category: "动作竞技", hot: true },
  { code: "HONOR_OF_KINGS", name: "王者荣耀", category: "手游 MOBA", hot: true },
  { code: "PEACEKEEPER_ELITE", name: "和平精英", category: "手游吃鸡", hot: true },
  { code: "DOTA_2", name: "Dota 2", category: "MOBA", hot: false },
  { code: "OVERWATCH_2", name: "守望先锋 2", category: "射击", hot: false },
  { code: "RAINBOW_SIX_SIEGE", name: "彩虹六号：围攻", category: "战术射击", hot: false },
  { code: "ROCKET_LEAGUE", name: "火箭联盟", category: "体育竞技", hot: false },
  { code: "EA_SPORTS_FC", name: "EA Sports FC", category: "体育", hot: false },
  { code: "STREET_FIGHTER_6", name: "街头霸王 6", category: "格斗", hot: false },
  { code: "CALL_OF_DUTY", name: "使命召唤", category: "射击", hot: false },
  { code: "WILD_RIFT", name: "英雄联盟手游", category: "手游 MOBA", hot: false },
  { code: "MOBILE_LEGENDS", name: "Mobile Legends", category: "手游 MOBA", hot: false },
  { code: "MINECRAFT", name: "我的世界", category: "沙盒", hot: false },
  { code: "GENSHIN_IMPACT", name: "原神", category: "开放世界", hot: false },
  { code: "STEAM", name: "Steam 综合游戏", category: "综合平台", hot: true }
];

export const companions = [
  {
    id: "nova",
    nickname: "Nova",
    game: "三角洲行动",
    rank: "高分段",
    modes: ["烽火地带", "全面战场"],
    price: 68,
    onlineStatus: "ONLINE",
    voice: "可语音",
    voiceStyle: "教学型 / 路线讲解",
    trial: "支持进语音频道试音",
    tags: ["推荐", "控图", "稳定上分"],
    intro: "擅长资源路线规划和安全撤离，适合新手熟悉节奏。",
    rating: "4.9",
    orders: 312,
    accent: "gold"
  },
  {
    id: "viper",
    nickname: "Viper",
    game: "无畏契约",
    rank: "高分段",
    modes: ["排位", "教学"],
    price: 88,
    onlineStatus: "BUSY",
    voice: "可语音",
    voiceStyle: "指挥型 / 快节奏",
    trial: "支持进语音频道试音",
    tags: ["枪法", "突破", "指挥"],
    intro: "主打高强度对局推进和小队沟通，适合追求效率的玩家。",
    rating: "4.8",
    orders: 246,
    accent: "blue"
  },
  {
    id: "echo",
    nickname: "Echo",
    game: "英雄联盟",
    rank: "钻石+",
    modes: ["双排", "教学"],
    price: 58,
    onlineStatus: "ONLINE",
    voice: "文字/语音",
    voiceStyle: "耐心型 / 新手友好",
    trial: "支持进语音频道试音",
    tags: ["耐心", "教学", "上分"],
    intro: "适合新手陪练，讲解清楚，节奏稳定。",
    rating: "4.7",
    orders: 178,
    accent: "violet"
  }
];

export const recentOrders = [
  { id: "MAY-240601", companion: "Nova", mode: "烽火地带", status: "待派单", amount: 136 },
  { id: "MAY-240528", companion: "Echo", mode: "双排", status: "已完成", amount: 90 }
];

export const walletTransactions = [
  { id: "W-001", type: "充值审核通过", amount: "+300.00", status: "已入账" },
  { id: "W-002", type: "订单支付", amount: "-136.00", status: "已完成" }
];
