"use strict";
function presentOrder(status) {
  const values = {
    PAID: ["待派单", "订单已创建，等待派单；请勿重复提交。"],
    ASSIGNED: ["待接单", "已派单，等待陪玩接受。"],
    ACCEPTED: ["已接单", "陪玩已接受，等待开始服务。"],
    IN_PROGRESS: ["服务中", "服务进行中，结束后再核对时长与完成情况。"],
    AWAITING_ACCEPTANCE: ["待验收", "请核对服务与时长，通过正式订单页确认验收；有异议联系管理员。"],
    COMPLETED: ["已完成", "服务已完成，结算以后台记录为准。"],
    DISPUTED: ["争议处理中", "请保留相关记录，等待管理员处理。"],
    REFUNDED: ["已退款", "退款去向与金额请核对钱包记录。"],
    CANCELLED: ["已取消", "此订单已取消，资金状态请核对钱包记录。"]
  };
  const value = values[status] || ["状态待核对", "请刷新核对，仍不明确时联系管理员，不重复下单。"];
  return { statusLabel: value[0], nextStep: value[1] };
}
module.exports = { presentOrder };
