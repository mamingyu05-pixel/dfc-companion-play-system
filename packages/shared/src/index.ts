export const SUPPORTED_GAMES = [
  { code: "DELTA_FORCE", name: "三角洲行动", category: "射击" },
  { code: "LEAGUE_OF_LEGENDS", name: "英雄联盟", category: "MOBA" },
  { code: "VALORANT", name: "无畏契约", category: "射击" },
  { code: "COUNTER_STRIKE_2", name: "CS2", category: "射击" },
  { code: "PUBG", name: "PUBG 绝地求生", category: "吃鸡" },
  { code: "PUBG_MOBILE", name: "PUBG Mobile", category: "手游" },
  { code: "APEX_LEGENDS", name: "Apex 英雄", category: "射击" },
  { code: "NARAKA_BLADEPOINT", name: "永劫无间", category: "动作竞技" },
  { code: "HONOR_OF_KINGS", name: "王者荣耀", category: "手游 MOBA" },
  { code: "PEACEKEEPER_ELITE", name: "和平精英", category: "手游吃鸡" },
  { code: "DOTA_2", name: "Dota 2", category: "MOBA" },
  { code: "OVERWATCH_2", name: "守望先锋 2", category: "射击" },
  { code: "RAINBOW_SIX_SIEGE", name: "彩虹六号：围攻", category: "战术射击" },
  { code: "ROCKET_LEAGUE", name: "火箭联盟", category: "体育竞技" },
  { code: "EA_SPORTS_FC", name: "EA Sports FC", category: "体育" },
  { code: "STREET_FIGHTER_6", name: "街头霸王 6", category: "格斗" },
  { code: "CALL_OF_DUTY", name: "使命召唤", category: "射击" },
  { code: "WILD_RIFT", name: "英雄联盟手游", category: "手游 MOBA" },
  { code: "MOBILE_LEGENDS", name: "Mobile Legends", category: "手游 MOBA" },
  { code: "MINECRAFT", name: "我的世界", category: "沙盒" },
  { code: "GENSHIN_IMPACT", name: "原神", category: "开放世界" },
  { code: "STEAM", name: "Steam 综合游戏", category: "综合平台" }
] as const;

export const SUPPORTED_GAME = "DELTA_FORCE" as const;
export type GameCode = (typeof SUPPORTED_GAMES)[number]["code"];

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
