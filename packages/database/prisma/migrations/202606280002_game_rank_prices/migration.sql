CREATE TABLE "game_rank_prices" (
  "id" TEXT NOT NULL,
  "game" "GameCode" NOT NULL,
  "tierKey" TEXT NOT NULL,
  "tierName" TEXT NOT NULL,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "game_rank_prices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "game_rank_prices_game_tierKey_key" ON "game_rank_prices"("game", "tierKey");
CREATE INDEX "game_rank_prices_game_sortOrder_idx" ON "game_rank_prices"("game", "sortOrder");

ALTER TABLE "orders"
  ADD COLUMN "rankTierKey" TEXT,
  ADD COLUMN "rankTierNameSnapshot" TEXT;

ALTER TABLE "order_groups"
  ADD COLUMN "rankTierKey" TEXT,
  ADD COLUMN "rankTierNameSnapshot" TEXT;

ALTER TABLE "order_drafts"
  ADD COLUMN "rankTierKey" TEXT,
  ADD COLUMN "rankTierNameSnapshot" TEXT;

INSERT INTO "game_rank_prices" ("id", "game", "tierKey", "tierName", "unitPrice", "sortOrder", "isActive", "updatedAt")
VALUES
  ('grp_delta_force_gold_below', 'DELTA_FORCE', 'gold_below', '黄金以下', 98, 10, true, CURRENT_TIMESTAMP),
  ('grp_delta_force_platinum', 'DELTA_FORCE', 'platinum', '铂金', 118, 20, true, CURRENT_TIMESTAMP),
  ('grp_delta_force_diamond', 'DELTA_FORCE', 'diamond', '钻石', 138, 30, true, CURRENT_TIMESTAMP),
  ('grp_delta_force_master', 'DELTA_FORCE', 'master', '大师', 168, 40, true, CURRENT_TIMESTAMP),
  ('grp_delta_force_ace', 'DELTA_FORCE', 'ace', '王牌', 198, 50, true, CURRENT_TIMESTAMP),
  ('grp_lol_gold_below', 'LEAGUE_OF_LEGENDS', 'gold_below', '黄金以下', 98, 10, true, CURRENT_TIMESTAMP),
  ('grp_lol_platinum', 'LEAGUE_OF_LEGENDS', 'platinum', '铂金', 118, 20, true, CURRENT_TIMESTAMP),
  ('grp_lol_emerald', 'LEAGUE_OF_LEGENDS', 'emerald', '翡翠', 138, 30, true, CURRENT_TIMESTAMP),
  ('grp_lol_diamond', 'LEAGUE_OF_LEGENDS', 'diamond', '钻石', 168, 40, true, CURRENT_TIMESTAMP),
  ('grp_lol_master', 'LEAGUE_OF_LEGENDS', 'master', '大师', 198, 50, true, CURRENT_TIMESTAMP),
  ('grp_lol_challenger', 'LEAGUE_OF_LEGENDS', 'challenger', '王者', 238, 60, true, CURRENT_TIMESTAMP),
  ('grp_valorant_gold_below', 'VALORANT', 'gold_below', '黄金以下', 98, 10, true, CURRENT_TIMESTAMP),
  ('grp_valorant_gold', 'VALORANT', 'gold', '黄金', 118, 20, true, CURRENT_TIMESTAMP),
  ('grp_valorant_platinum', 'VALORANT', 'platinum', '白金', 138, 30, true, CURRENT_TIMESTAMP),
  ('grp_valorant_diamond', 'VALORANT', 'diamond', '钻石', 158, 40, true, CURRENT_TIMESTAMP),
  ('grp_valorant_ascendant', 'VALORANT', 'ascendant', '超凡', 188, 50, true, CURRENT_TIMESTAMP),
  ('grp_valorant_radiant', 'VALORANT', 'radiant', '神话·辐能', 228, 60, true, CURRENT_TIMESTAMP),
  ('grp_cs2_below_10k', 'COUNTER_STRIKE_2', 'below_10k', '1万分以下', 98, 10, true, CURRENT_TIMESTAMP),
  ('grp_cs2_10k_15k', 'COUNTER_STRIKE_2', '10k_15k', '1万-1.5万', 118, 20, true, CURRENT_TIMESTAMP),
  ('grp_cs2_15k_20k', 'COUNTER_STRIKE_2', '15k_20k', '1.5万-2万', 138, 30, true, CURRENT_TIMESTAMP),
  ('grp_cs2_20k_25k', 'COUNTER_STRIKE_2', '20k_25k', '2万-2.5万', 168, 40, true, CURRENT_TIMESTAMP),
  ('grp_cs2_above_25k', 'COUNTER_STRIKE_2', 'above_25k', '2.5万以上', 198, 50, true, CURRENT_TIMESTAMP),
  ('grp_pubg_gold_below', 'PUBG', 'gold_below', '黄金以下', 98, 10, true, CURRENT_TIMESTAMP),
  ('grp_pubg_platinum', 'PUBG', 'platinum', '铂金', 118, 20, true, CURRENT_TIMESTAMP),
  ('grp_pubg_diamond', 'PUBG', 'diamond', '钻石', 138, 30, true, CURRENT_TIMESTAMP),
  ('grp_pubg_crown', 'PUBG', 'crown', '皇冠', 168, 40, true, CURRENT_TIMESTAMP),
  ('grp_pubg_master', 'PUBG', 'master', '大师', 198, 50, true, CURRENT_TIMESTAMP),
  ('grp_apex_gold_below', 'APEX_LEGENDS', 'gold_below', '黄金以下', 98, 10, true, CURRENT_TIMESTAMP),
  ('grp_apex_platinum', 'APEX_LEGENDS', 'platinum', '铂金', 118, 20, true, CURRENT_TIMESTAMP),
  ('grp_apex_diamond', 'APEX_LEGENDS', 'diamond', '钻石', 148, 30, true, CURRENT_TIMESTAMP),
  ('grp_apex_master', 'APEX_LEGENDS', 'master', '大师', 188, 40, true, CURRENT_TIMESTAMP),
  ('grp_apex_predator', 'APEX_LEGENDS', 'predator', '猎杀', 238, 50, true, CURRENT_TIMESTAMP),
  ('grp_naraka_brave_below', 'NARAKA_BLADEPOINT', 'brave_below', '勇者以下', 98, 10, true, CURRENT_TIMESTAMP),
  ('grp_naraka_elite', 'NARAKA_BLADEPOINT', 'elite', '精英', 118, 20, true, CURRENT_TIMESTAMP),
  ('grp_naraka_grandmaster', 'NARAKA_BLADEPOINT', 'grandmaster', '宗师', 138, 30, true, CURRENT_TIMESTAMP),
  ('grp_naraka_unrivaled', 'NARAKA_BLADEPOINT', 'unrivaled', '无双', 168, 40, true, CURRENT_TIMESTAMP),
  ('grp_cod_regular', 'CALL_OF_DUTY', 'regular', '常规', 118, 10, true, CURRENT_TIMESTAMP),
  ('grp_cod_hardcore_labs', 'CALL_OF_DUTY', 'hardcore_labs', '硬核·Labs', 138, 20, true, CURRENT_TIMESTAMP)
ON CONFLICT ("game", "tierKey") DO UPDATE SET
  "tierName" = EXCLUDED."tierName",
  "unitPrice" = EXCLUDED."unitPrice",
  "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = EXCLUDED."isActive",
  "updatedAt" = CURRENT_TIMESTAMP;
