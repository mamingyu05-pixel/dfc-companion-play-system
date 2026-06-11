export const SUPPORTED_GAME = "DELTA_FORCE" as const;

export enum UserRole {
  CUSTOMER = "CUSTOMER",
  COMPANION = "COMPANION",
  ADMIN = "ADMIN",
  SUPER_ADMIN = "SUPER_ADMIN"
}

export enum OrderStatus {
  PENDING_PAYMENT = "PENDING_PAYMENT",
  PAID = "PAID",
  ASSIGNED = "ASSIGNED",
  ACCEPTED = "ACCEPTED",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
  REFUND_REQUESTED = "REFUND_REQUESTED",
  REFUNDED = "REFUNDED",
  DISPUTED = "DISPUTED"
}

export enum ReviewStatus {
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED"
}

export type Money = string;

export interface OrderNotificationPayload {
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
