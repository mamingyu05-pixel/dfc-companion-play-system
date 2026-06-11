export const companionProfile = {
  nickname: "Nova",
  game: "三角洲行动",
  rank: "高分段",
  price: 68,
  onlineStatus: "在线",
  listedStatus: "已上架",
  modes: ["烽火地带", "全面战场"],
  voice: "可语音",
  bio: "擅长资源路线规划和安全撤离，适合新手熟悉节奏。"
};

export const availableOrders = [
  { id: "MAY-240701", mode: "三角洲行动 / 烽火地带", hours: 2, amount: 136, customer: "客户A", status: "已派单" },
  { id: "MAY-240702", mode: "无畏契约 / 排位", hours: 1.5, amount: 132, customer: "客户B", status: "已派单" }
];

export const myOrders = [
  { id: "MAY-240699", mode: "三角洲行动 / 烽火地带", hours: 2, amount: 136, status: "进行中" },
  { id: "MAY-240688", mode: "英雄联盟 / 双排", hours: 1, amount: 68, status: "已完成" }
];

export const earnings = [
  { id: "E-001", type: "订单结算", amount: "+108.80", status: "可提现" },
  { id: "E-002", type: "提现冻结", amount: "-100.00", status: "处理中" }
];
