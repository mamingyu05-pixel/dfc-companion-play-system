export type EscrowStepState = "done" | "current" | "todo";
export type EscrowStep = { label: string; state: EscrowStepState };
export type EscrowTone = "held" | "warning" | "settled" | "returned" | "neutral";
export type EscrowView = { tone: EscrowTone; headline: string; detail: string; steps: EscrowStep[] };
export type EscrowOrder = { status: string; totalAmount: string; refundAmount?: string | null };

const NORMAL_STEPS = ["资金托管", "陪玩接单", "服务中", "待你验收", "结算给陪玩"];
// Index of the step the order is waiting on; earlier steps are done.
const NORMAL_POSITION: Record<string, number> = {
  PENDING_PAYMENT: 0, PAID: 1, ASSIGNED: 1, ACCEPTED: 2, IN_PROGRESS: 2, AWAITING_ACCEPTANCE: 3
};

const cents = (value: string | null | undefined) => {
  const amount = Number(value ?? "0");
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
};
const yuan = (value: number) => `¥${(value / 100).toFixed(2)}`;
const steps = (labels: string[], current: number): EscrowStep[] =>
  labels.map((label, index) => ({ label, state: index < current ? "done" : index === current ? "current" : "todo" }));

/** Customer-facing escrow stage derived only from the order's own status and recorded amounts. */
export function orderEscrowView(order: EscrowOrder): EscrowView {
  const total = cents(order.totalAmount), refund = cents(order.refundAmount);
  const position = NORMAL_POSITION[order.status];
  if (order.status === "PENDING_PAYMENT")
    return { tone: "neutral", headline: "尚未冻结余额", detail: "订单还没有从钱包冻结金额，陪玩不会开始服务。", steps: steps(NORMAL_STEPS, 0) };
  if (position !== undefined)
    return { tone: "held", headline: `${yuan(total)} 由平台托管中`,
      detail: "这笔钱已从你的余额冻结，陪玩暂时拿不到。你确认验收，或到期无异议自动验收后，才会结算给陪玩；验收前有异议可提交投诉，资金继续冻结。",
      steps: steps(NORMAL_STEPS, position) };
  if (order.status === "DISPUTED" || order.status === "REFUND_REQUESTED")
    return { tone: "warning", headline: `${yuan(total)} 冻结中，等待客服裁决`,
      detail: "争议处理期间不会结算给陪玩。客服核对记录后会全额退回、部分退回或正常结算，退回金额进入站内余额。",
      steps: steps(["资金托管", "争议处理", "裁决后退回或结算"], 1) };
  if (order.status === "COMPLETED" && refund > 0)
    return { tone: "settled", headline: `已退回 ${yuan(refund)}，结算 ${yuan(total - refund)}`,
      detail: "争议已裁决：退回部分已进入你的站内余额，其余结算给陪玩。可到钱包核对流水。",
      steps: steps(["资金托管", "争议裁决", `退回 ${yuan(refund)}`, `结算 ${yuan(total - refund)}`], 4) };
  if (order.status === "COMPLETED")
    return { tone: "settled", headline: `已结算 ${yuan(total)}`,
      detail: "已完成验收，托管金额已结算给陪玩。",
      steps: steps(NORMAL_STEPS, NORMAL_STEPS.length) };
  if (order.status === "REFUNDED")
    return { tone: "returned", headline: refund > 0 ? `已退回站内余额 ${yuan(refund)}` : "已退回站内余额",
      detail: refund > 0 ? "冻结金额已解冻，没有结算给陪玩。可到钱包核对退款流水。" : "记录显示已退款，请到钱包核对退款流水与金额。",
      steps: steps(["资金托管", "已退回站内余额"], 2) };
  if (order.status === "CANCELLED")
    return { tone: "neutral", headline: "订单已取消", detail: "未结算给陪玩，请到钱包核对冻结金额是否已退回。", steps: steps(["已取消"], 1) };
  return { tone: "neutral", headline: "资金状态待核对", detail: "请刷新订单；仍不明确时联系客服，不要重复下单。", steps: [] };
}

export const ESCROW_PROMISE = {
  title: "平台托管，验收后才付给陪玩",
  points: [
    "下单只冻结你的余额，陪玩接单、服务期间都拿不到这笔钱",
    "服务结束由你确认验收；到期无异议才自动验收",
    "有异议在验收前提交投诉，资金继续冻结，由客服裁决退回或结算",
    "退回金额进入站内余额，每一笔都有钱包流水可查"
  ]
};
