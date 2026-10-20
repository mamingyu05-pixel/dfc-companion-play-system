import { dispatchReminder } from "./dispatch-reminder";

type Person = { displayName: string } | null;
type DateValue = Date | string | null;
export type QueueItem = { id: string; kind: "ORDER" | "DRAFT" | "COMPLAINT"; reference: string;
  stage: string; nextStep: string; owner: string; waitingSince: DateValue; priority: number; href: string;
  customer: string; summary: string; lastNote: string | null };
export type QueueOrder = { id: string; orderNo: string; status: string; mode: string; createdAt: DateValue;
  dispatchVersion: number; acceptedAt: DateValue; reportedCompletedAt: DateValue; acceptanceDeadline: DateValue;
  companionId: string | null; customer: Person; assignedBy: Person;
  statusLogs: Array<{ orderId: string; toStatus: string; createdAt: DateValue; reason: string | null }> };
export type QueueDraft = { id: string; draftNo: string; status: string; mode: string; updatedAt: DateValue;
  customerDisplayName: string | null; customer: Person; serviceAdmin: Person;
  candidates: Array<{ status: string }>; events: Array<{ content: string | null; createdAt: DateValue }> };
export type QueueComplaint = { id: string; status: string; createdAt: DateValue; updatedAt: DateValue;
  resolvedBy: Person; order: { orderNo: string; customer: Person }; reason: string };
const time = (value: DateValue) => value ? new Date(value).getTime() : NaN;

export function buildWorkQueue(orders: QueueOrder[], drafts: QueueDraft[], complaints: QueueComplaint[], now: Date) {
  const items: QueueItem[] = [];
  for (const order of orders) {
    const deadline = time(order.acceptanceDeadline);
    const activityAt = order.statusLogs[0]?.createdAt ?? order.createdAt;
    const assignment = order.status === "ASSIGNED" ? order.statusLogs
      .map(log => dispatchReminder(order, { ...log, createdAt: new Date(time(log.createdAt)) }, now))
      .find(result => result.assignedAt !== null) : undefined;
    const assignedAt = assignment?.assignedAt ?? null;
    const expired = order.acceptanceDeadline !== null && (!Number.isFinite(deadline) || deadline <= now.getTime());
    const reminder = assignment?.due ?? false;
    const waitingStep = order.companionId
      ? reminder ? "已等待至少 10 分钟，请联系核对；不会自动撤单" : "等待本人正式接单；需要时可联系或换人"
      : reminder ? "本轮招募已等待至少 10 分钟，请联系核对；报名不等于正式接单" : "公开招募中，等待陪玩本人正式接单；报名不等于正式接单";
    const stages: Record<string, [string, string, number]> = {
      PAID: [order.companionId ? "已选定 · 待客服派单" : "待客服选人", "核对需求与候选可接状态，再确认派单", 2],
      ASSIGNED: [expired ? "接单期限异常 / 已超时" : order.companionId ? "已选定 · 待陪玩接单" : "待招募 / 待报名", expired ? "核对本轮派单，联系陪玩或重新分配" : waitingStep, expired || reminder ? 1 : 3],
      ACCEPTED: ["待开始", "陪玩已正式接单，约定开始时间", 4],
      AWAITING_ACCEPTANCE: ["待完成确认", "客户核对服务后验收；有异议进入售后", 2],
      DISPUTED: ["争议处理中", "核对证据与处理记录，沿用现有退款和结算权限", 0],
      REFUND_REQUESTED: ["退款待处理", "由有权限的人员核对可退金额与原流水", 0]
    };
    const stage = stages[order.status];
    if (!stage) continue;
    items.push({ id: order.id, kind: "ORDER", reference: order.orderNo, stage: stage[0], nextStep: stage[1],
      owner: order.assignedBy?.displayName || "待客服接手", waitingSince: order.status === "ASSIGNED" ? assignedAt
        : order.status === "AWAITING_ACCEPTANCE" ? order.reportedCompletedAt : order.status === "ACCEPTED" ? order.acceptedAt : activityAt,
      priority: stage[2], href: ["PAID", "ASSIGNED"].includes(order.status)
        ? `/dispatch?orderId=${encodeURIComponent(order.id)}` : `/orders?orderId=${encodeURIComponent(order.id)}`,
      customer: order.customer?.displayName || "客户待核对", summary: order.mode, lastNote: order.statusLogs[0]?.reason || null });
  }
  for (const draft of drafts) {
    const candidates = draft.candidates.filter(c => c.status !== "REJECTED").length;
    const stages: Record<string, [string, string]> = {
      OPEN: [candidates ? "待客户选择" : "报名 / 推荐候选中", candidates ? "把候选交客户选择；报名不会占单" : "沟通需求，推荐合适陪玩或手动招募"],
      TRIALING: ["待客户选择 · 试音中", "试音结束后请客户选择；试音不是开始服务"],
      SELECTED: ["已选定 · 待报价确认", "核对人选、时长与报价，记录客户确认"],
      CUSTOMER_CONFIRMED: ["报价已确认 · 待转正式单", "核对已选人选，再转正式订单；保留原请求编号"]
    };
    const stage = stages[draft.status]; if (!stage) continue;
    items.push({ id: draft.id, kind: "DRAFT", reference: draft.draftNo, stage: stage[0], nextStep: stage[1],
      owner: draft.serviceAdmin?.displayName || "待客服接手", waitingSince: draft.events[0]?.createdAt || draft.updatedAt,
      priority: 2, href: `/order-drafts?draftId=${encodeURIComponent(draft.id)}`,
      customer: draft.customer?.displayName || draft.customerDisplayName || "客户待绑定", summary: `${draft.mode} · ${candidates} 位候选`,
      lastNote: draft.events[0]?.content || null });
  }
  for (const complaint of complaints) {
    if (!["OPEN", "IN_REVIEW"].includes(complaint.status)) continue;
    items.push({ id: complaint.id, kind: "COMPLAINT", reference: complaint.order.orderNo,
      stage: "售后待处理", nextStep: "查看投诉与订单记录，记录处理依据", owner: complaint.resolvedBy?.displayName || "待售后接手",
      waitingSince: complaint.status === "OPEN" ? complaint.createdAt : complaint.updatedAt, priority: 0,
      href: "/complaints", customer: complaint.order.customer?.displayName || "客户待核对", summary: "投诉 / 申诉", lastNote: complaint.reason });
  }
  return items.sort((a, b) => a.priority - b.priority ||
    (Number.isFinite(time(a.waitingSince)) ? time(a.waitingSince) : 0) - (Number.isFinite(time(b.waitingSince)) ? time(b.waitingSince) : 0) ||
    `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
}
