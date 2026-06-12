ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'PROMOTION_BONUS';
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'REFERRAL_REWARD';

ALTER TABLE "companion_profiles"
  ADD COLUMN "commissionRate" DECIMAL(5,4) NOT NULL DEFAULT 0.2;

CREATE TABLE "platform_settings" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "description" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_settings_key_key" ON "platform_settings"("key");

ALTER TABLE "platform_settings"
  ADD CONSTRAINT "platform_settings_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "platform_settings" ("id", "key", "value", "description", "createdAt", "updatedAt")
VALUES
  ('setting_new_customer_first_recharge_bonus_rate', 'NEW_CUSTOMER_FIRST_RECHARGE_BONUS_RATE', '0.1', 'New customer first approved recharge bonus rate. 0.1 means 10%.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('setting_new_customer_first_recharge_bonus_amount', 'NEW_CUSTOMER_FIRST_RECHARGE_BONUS_AMOUNT', '0', 'Fixed bonus amount for new customer first approved recharge.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('setting_customer_referrer_reward_amount', 'CUSTOMER_REFERRER_REWARD_AMOUNT', '10', 'Reward amount for existing customer inviting a new customer. Requires referral binding.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('setting_customer_invitee_bonus_amount', 'CUSTOMER_INVITEE_BONUS_AMOUNT', '10', 'Bonus amount for invited new customer. Requires referral binding.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('setting_companion_referral_reward_amount', 'COMPANION_REFERRAL_REWARD_AMOUNT', '20', 'Reward amount when a companion brings a new customer. Requires referral binding.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
