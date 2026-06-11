export const companions = [
  {
    id: "nova",
    nickname: "Nova",
    rank: "烽火钻石",
    modes: ["烽火地带", "全面战场"],
    price: 68,
    onlineStatus: "在线",
    voice: "可语音",
    voiceStyle: "教学型 / 路线讲解",
    trial: "支持试音",
    tags: ["推荐", "控图", "稳定上分"],
    intro: "擅长资源路线规划和安全撤离，适合新手熟悉节奏。",
    rating: "4.9",
    orders: 312,
    accent: "gold"
  },
  {
    id: "viper",
    nickname: "Viper",
    rank: "全面战场王牌",
    modes: ["全面战场"],
    price: 58,
    onlineStatus: "忙碌",
    voice: "可语音",
    voiceStyle: "指挥型 / 快节奏",
    trial: "支持试音",
    tags: ["枪法", "突破", "指挥"],
    intro: "主打高强度战场推进和小队指挥，适合追求效率的玩家。",
    rating: "4.8",
    orders: 246,
    accent: "blue"
  },
  {
    id: "echo",
    nickname: "Echo",
    rank: "烽火铂金",
    modes: ["烽火地带"],
    price: 45,
    onlineStatus: "在线",
    voice: "文字/语音",
    voiceStyle: "耐心型 / 新手友好",
    trial: "支持试音",
    tags: ["耐心", "教学", "路线"],
    intro: "适合新手陪练，讲解清楚，节奏稳。",
    rating: "4.7",
    orders: 178,
    accent: "violet"
  }
];

export const recentOrders = [
  { id: "DFC-240601", companion: "Nova", mode: "烽火地带", status: "待派单", amount: 136 },
  { id: "DFC-240528", companion: "Echo", mode: "烽火地带", status: "已完成", amount: 90 }
];

export const walletTransactions = [
  { id: "W-001", type: "充值审核通过", amount: "+300.00", status: "已入账" },
  { id: "W-002", type: "订单支付", amount: "-136.00", status: "已完成" }
];
