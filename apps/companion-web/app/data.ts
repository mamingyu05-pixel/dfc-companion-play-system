export const companionProfile = {
  nickname: "Nova",
  rank: "烽火钻石",
  price: 68,
  onlineStatus: "在线",
  listedStatus: "已上架",
  modes: ["烽火地带", "全面战场"],
  voice: "可语音",
  bio: "擅长资源路线规划和安全撤离，适合新手熟悉节奏。"
};

export const availableOrders = [
  { id: "DFC-240701", mode: "烽火地带", hours: 2, amount: 136, customer: "客户A", status: "已派单" },
  { id: "DFC-240702", mode: "全面战场", hours: 1.5, amount: 102, customer: "客户B", status: "已派单" }
];

export const myOrders = [
  { id: "DFC-240699", mode: "烽火地带", hours: 2, amount: 136, status: "进行中" },
  { id: "DFC-240688", mode: "烽火地带", hours: 1, amount: 68, status: "已完成" }
];

export const earnings = [
  { id: "E-001", type: "订单结算", amount: "+108.80", status: "可提现" },
  { id: "E-002", type: "提现冻结", amount: "-100.00", status: "处理中" }
];
