export const SUPPORTED_GAMES = [
  { code: "DELTA_FORCE", name: "三角洲行动", category: "射击" },
  { code: "LEAGUE_OF_LEGENDS", name: "英雄联盟", category: "MOBA" },
  { code: "VALORANT", name: "无畏契约", category: "射击" },
  { code: "COUNTER_STRIKE_2", name: "CS2", category: "射击" },
  { code: "PUBG", name: "PUBG 绝地求生", category: "吃鸡" },
  { code: "APEX_LEGENDS", name: "Apex 英雄", category: "射击" },
  { code: "NARAKA_BLADEPOINT", name: "永劫无间", category: "动作竞技" },
  { code: "CALL_OF_DUTY", name: "塔科夫 / COD", category: "战术射击" }
] as const;

export const SUPPORTED_GAME = "DELTA_FORCE" as const;
export type GameCode = (typeof SUPPORTED_GAMES)[number]["code"];

// Const objects instead of `enum`: services load this source file directly at runtime, and Node's
// built-in type stripping cannot execute enums. Values and type names stay the same for callers.
export const UserRole = {
  CUSTOMER: "CUSTOMER",
  COMPANION: "COMPANION",
  ADMIN: "ADMIN",
  SUPER_ADMIN: "SUPER_ADMIN"
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const OrderStatus = {
  PENDING_PAYMENT: "PENDING_PAYMENT",
  PAID: "PAID",
  ASSIGNED: "ASSIGNED",
  ACCEPTED: "ACCEPTED",
  IN_PROGRESS: "IN_PROGRESS",
  AWAITING_ACCEPTANCE: "AWAITING_ACCEPTANCE",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  REFUND_REQUESTED: "REFUND_REQUESTED",
  REFUNDED: "REFUNDED",
  DISPUTED: "DISPUTED"
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const ReviewStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED"
} as const;
export type ReviewStatus = (typeof ReviewStatus)[keyof typeof ReviewStatus];

export type Money = string;

export interface OrderNotificationPayload {
  dispatchVersion: number;
  orderId: string;
  orderNo: string;
  mode: string;
  hours: string;
  totalAmount: string;
  companionName?: string;
}

export interface BotAdapter {
  sendOrderNotification(order: OrderNotificationPayload): Promise<void>;
  sendAdminAlert(message: string): Promise<void>;
  sendDirectMessage(userId: string, message: string): Promise<void>;
  createVoiceRoom(orderId: string): Promise<string>;
  syncRole(userId: string, role: UserRole): Promise<void>;
}

export const DISPATCH_REFRESH_MESSAGE = "Dispatch changed; refresh the order. 派单卡片已失效，请刷新订单后重试。";

export function parseOrderAcceptAction(value: string): { orderId: string; dispatchVersion: number } | null {
  const match = /^order\.accept\.([A-Za-z0-9_-]+)\.(0|[1-9][0-9]*)$/.exec(value);
  if (!match || match[0] !== value) return null;
  const dispatchVersion = Number(match[2]);
  return Number.isSafeInteger(dispatchVersion) ? { orderId: match[1], dispatchVersion } : null;
}

export function buildOrderAcceptAction(orderId: string, dispatchVersion: number): string {
  if (typeof dispatchVersion !== "number" || !Number.isSafeInteger(dispatchVersion) || dispatchVersion < 0 || !/^[A-Za-z0-9_-]+$/.test(orderId)) throw new Error(DISPATCH_REFRESH_MESSAGE);
  return `order.accept.${orderId}.${dispatchVersion}`;
}
