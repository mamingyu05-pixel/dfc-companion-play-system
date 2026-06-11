export const metrics = [
  { label: "今日订单", value: "18", hint: "3 个待派单" },
  { label: "待充值审核", value: "6", hint: "需要核对截图" },
  { label: "待提现审核", value: "4", hint: "人工打款" },
  { label: "投诉处理中", value: "2", hint: "需要管理员介入" }
];

export const companions = [
  { id: "U-1001", nickname: "Nova", game: "三角洲行动", status: "已上架", rank: "高分段", price: "¥68", kook: "已绑定", discord: "已绑定" },
  { id: "U-1002", nickname: "Viper", game: "无畏契约", status: "已上架", rank: "高分段", price: "¥88", kook: "未绑定", discord: "已绑定" },
  { id: "U-1003", nickname: "Echo", game: "英雄联盟", status: "待审核", rank: "钻石+", price: "¥58", kook: "已绑定", discord: "未绑定" }
];

export const orders = [
  { id: "MAY-240701", customer: "客户A", companion: "Nova", status: "待派单", amount: "¥136", bot: "未发送" },
  { id: "MAY-240699", customer: "客户B", companion: "Viper", status: "进行中", amount: "¥176", bot: "Discord/KOOK 已发送" },
  { id: "MAY-240688", customer: "客户C", companion: "Echo", status: "已完成", amount: "¥90", bot: "已完成" }
];

export const recharges = [
  { id: "R-001", customer: "客户A", amount: "¥300", status: "待审核", screenshot: "已上传" },
  { id: "R-002", customer: "客户B", amount: "¥500", status: "待审核", screenshot: "已上传" }
];

export const withdrawals = [
  { id: "W-001", companion: "Nova", amount: "¥200", status: "待审核", account: "已填写" },
  { id: "W-002", companion: "Viper", amount: "¥150", status: "待打款", account: "已填写" }
];

export const complaints = [
  { id: "C-001", order: "MAY-240688", reporter: "客户C", status: "处理中", reason: "服务时长争议" },
  { id: "C-002", order: "MAY-240699", reporter: "Nova", status: "新投诉", reason: "客户未配合语音" }
];

export const adminLogs = [
  { id: "L-001", actor: "admin@maycatplay.com", action: "审核充值", target: "R-001", time: "10:24" },
  { id: "L-002", actor: "admin@maycatplay.com", action: "派单", target: "MAY-240701", time: "10:41" }
];
