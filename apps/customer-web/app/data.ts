export const games = [
  { code: "DELTA_FORCE", name: "三角洲行动", category: "射击", hot: true },
  { code: "LEAGUE_OF_LEGENDS", name: "英雄联盟", category: "MOBA", hot: true },
  { code: "VALORANT", name: "无畏契约", category: "射击", hot: true },
  { code: "COUNTER_STRIKE_2", name: "CS2", category: "射击", hot: true },
  { code: "PUBG", name: "PUBG 绝地求生", category: "吃鸡", hot: true },
  { code: "APEX_LEGENDS", name: "Apex 英雄", category: "射击", hot: true },
  { code: "NARAKA_BLADEPOINT", name: "永劫无间", category: "动作竞技", hot: true },
  { code: "CALL_OF_DUTY", name: "塔科夫 / COD", category: "战术射击", hot: true }
];

export const companions = [
  {
    id: "nova",
    nickname: "Nova",
    game: "三角洲行动",
    rank: "高分段",
    modes: ["烽火地带", "全面战场"],
    price: 118,
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
    price: 118,
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
    price: 98,
    onlineStatus: "ONLINE",
    voice: "可语音",
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
  { id: "MAY-240601", companion: "Nova", mode: "烽火地带", status: "待派单", amount: 236 },
  { id: "MAY-240528", companion: "Echo", mode: "娱乐双排", status: "已完成", amount: 196 }
];

export const walletTransactions = [
  { id: "W-001", type: "充值审核通过", amount: "+300.00", status: "已入账" },
  { id: "W-002", type: "订单支付", amount: "-196.00", status: "已完成" }
];
