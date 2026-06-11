CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'COMPANION', 'ADMIN', 'SUPER_ADMIN');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BANNED');
CREATE TYPE "GameCode" AS ENUM ('DELTA_FORCE');
CREATE TYPE "DeltaForceRank" AS ENUM ('UNRANKED', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'ASCENDANT', 'IMMORTAL', 'TOP');
CREATE TYPE "CompanionProfileStatus" AS ENUM ('PENDING_REVIEW', 'LISTED', 'UNLISTED', 'BANNED');
CREATE TYPE "OnlineStatus" AS ENUM ('ONLINE', 'BUSY', 'OFFLINE');
CREATE TYPE "VoicePreference" AS ENUM ('REQUIRED', 'OPTIONAL', 'TEXT_ONLY');
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REFUND_REQUESTED', 'REFUNDED', 'DISPUTED');
CREATE TYPE "OrderAssignmentType" AS ENUM ('DIRECT_COMPANION', 'PLATFORM_MATCH');
CREATE TYPE "WalletTransactionType" AS ENUM ('RECHARGE_APPROVED', 'ORDER_PAYMENT', 'ORDER_REFUND', 'ORDER_SETTLEMENT', 'WITHDRAWAL_FREEZE', 'WITHDRAWAL_COMPLETED', 'WITHDRAWAL_REJECTED', 'ADMIN_ADJUSTMENT');
CREATE TYPE "TransactionDirection" AS ENUM ('CREDIT', 'DEBIT');
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAID');
CREATE TYPE "ComplaintStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED');
CREATE TYPE "BotEventType" AS ENUM ('ORDER_NOTIFICATION_SENT', 'ORDER_ACCEPT_CLICKED', 'RECHARGE_NOTIFICATION_SENT', 'WITHDRAWAL_NOTIFICATION_SENT', 'COMPLAINT_NOTIFICATION_SENT', 'ADMIN_ALERT_SENT');
CREATE TYPE "BotPlatform" AS ENUM ('DISCORD', 'KOOK');
CREATE TYPE "BotEventStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "displayName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_external_accounts" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "platform" "BotPlatform" NOT NULL,
  "externalUserId" TEXT NOT NULL,
  "displayName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_external_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "companion_profiles" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "nickname" TEXT NOT NULL,
  "avatarUrl" TEXT,
  "gender" TEXT,
  "game" "GameCode" NOT NULL DEFAULT 'DELTA_FORCE',
  "deltaForceRank" "DeltaForceRank" NOT NULL DEFAULT 'UNRANKED',
  "skillModes" TEXT[],
  "pricePerHour" DECIMAL(12,2) NOT NULL,
  "onlineStatus" "OnlineStatus" NOT NULL DEFAULT 'OFFLINE',
  "bio" TEXT,
  "voicePreference" "VoicePreference" NOT NULL DEFAULT 'OPTIONAL',
  "status" "CompanionProfileStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "companion_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wallets" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "availableBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "frozenBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "availableIncome" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "pendingIncome" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "frozenIncome" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orders" (
  "id" TEXT NOT NULL,
  "orderNo" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "companionId" TEXT,
  "assignedById" TEXT,
  "assignmentType" "OrderAssignmentType" NOT NULL DEFAULT 'DIRECT_COMPANION',
  "game" "GameCode" NOT NULL DEFAULT 'DELTA_FORCE',
  "mode" TEXT NOT NULL,
  "hours" DECIMAL(6,2) NOT NULL,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "totalAmount" DECIMAL(12,2) NOT NULL,
  "platformFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "companionIncome" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "notes" TEXT,
  "voiceTrialRequested" BOOLEAN NOT NULL DEFAULT false,
  "voiceRoomId" TEXT,
  "discordMessageId" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_status_logs" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "fromStatus" "OrderStatus",
  "toStatus" "OrderStatus" NOT NULL,
  "actorId" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_status_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wallet_transactions" (
  "id" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "operatorId" TEXT,
  "type" "WalletTransactionType" NOT NULL,
  "direction" "TransactionDirection" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "balanceAfter" DECIMAL(12,2) NOT NULL,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recharge_requests" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "screenshotUrl" TEXT NOT NULL,
  "note" TEXT,
  "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recharge_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "withdrawal_requests" (
  "id" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "payoutAccount" TEXT NOT NULL,
  "note" TEXT,
  "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "paidAt" TIMESTAMP(3),
  "payoutReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "complaints" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "resolvedById" TEXT,
  "reason" TEXT NOT NULL,
  "status" "ComplaintStatus" NOT NULL DEFAULT 'OPEN',
  "resolution" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_logs" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "targetUserId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "detail" JSONB,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bot_events" (
  "id" TEXT NOT NULL,
  "platform" "BotPlatform" NOT NULL,
  "status" "BotEventStatus" NOT NULL DEFAULT 'PENDING',
  "type" "BotEventType" NOT NULL,
  "actorId" TEXT,
  "orderId" TEXT,
  "discordGuildId" TEXT,
  "discordChannelId" TEXT,
  "discordMessageId" TEXT,
  "platformGuildId" TEXT,
  "platformChannelId" TEXT,
  "platformMessageId" TEXT,
  "platformUserId" TEXT,
  "payload" JSONB,
  "error" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bot_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "user_external_accounts_platform_externalUserId_key" ON "user_external_accounts"("platform", "externalUserId");
CREATE UNIQUE INDEX "user_external_accounts_userId_platform_key" ON "user_external_accounts"("userId", "platform");
CREATE INDEX "user_external_accounts_userId_idx" ON "user_external_accounts"("userId");
CREATE UNIQUE INDEX "companion_profiles_userId_key" ON "companion_profiles"("userId");
CREATE UNIQUE INDEX "wallets_userId_key" ON "wallets"("userId");
CREATE UNIQUE INDEX "orders_orderNo_key" ON "orders"("orderNo");
CREATE INDEX "orders_status_idx" ON "orders"("status");
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");
CREATE INDEX "orders_companionId_idx" ON "orders"("companionId");
CREATE INDEX "order_status_logs_orderId_idx" ON "order_status_logs"("orderId");
CREATE INDEX "wallet_transactions_userId_idx" ON "wallet_transactions"("userId");
CREATE INDEX "wallet_transactions_referenceType_referenceId_idx" ON "wallet_transactions"("referenceType", "referenceId");
CREATE INDEX "recharge_requests_status_idx" ON "recharge_requests"("status");
CREATE INDEX "withdrawal_requests_status_idx" ON "withdrawal_requests"("status");
CREATE INDEX "complaints_status_idx" ON "complaints"("status");
CREATE INDEX "admin_logs_actorId_idx" ON "admin_logs"("actorId");
CREATE INDEX "admin_logs_entityType_entityId_idx" ON "admin_logs"("entityType", "entityId");
CREATE INDEX "bot_events_type_idx" ON "bot_events"("type");
CREATE INDEX "bot_events_orderId_idx" ON "bot_events"("orderId");

ALTER TABLE "user_external_accounts" ADD CONSTRAINT "user_external_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "companion_profiles" ADD CONSTRAINT "companion_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_status_logs" ADD CONSTRAINT "order_status_logs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_status_logs" ADD CONSTRAINT "order_status_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recharge_requests" ADD CONSTRAINT "recharge_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recharge_requests" ADD CONSTRAINT "recharge_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "admin_logs" ADD CONSTRAINT "admin_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admin_logs" ADD CONSTRAINT "admin_logs_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bot_events" ADD CONSTRAINT "bot_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
