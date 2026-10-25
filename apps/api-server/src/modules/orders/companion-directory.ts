import { BadRequestException } from "@nestjs/common";
import { GameCode, Prisma } from "@prisma/client";

export type CompanionListQuery = {
  page?: string | number;
  limit?: string | number;
  sort?: string;
  filter?: string;
  q?: string;
};

export type PublicCompanion = {
  id: string;
  displayName: string;
  nickname: string;
  avatarUrl: string | null;
  photoUrls: string[];
  voiceIntroUrl: string | null;
  verified: boolean;
  badges: string[];
  averageRating: number | null;
  rating: number | null;
  reviewCount: number;
  completedOrders: number;
  reviews: Array<{ stars: number; comment: string; createdAt: string }>;
  externalAccounts: Array<{ platform: string; displayName: string | null }>;
  game: GameCode;
  games: GameCode[];
  status: string;
  onlineStatus: string;
  activeServiceCount: number;
  availability: string;
  deltaForceRank: string;
  skillModes: string[];
  pricePerHour: string;
  kookPricePerHour: string | null;
  discordPricePerHour: string | null;
  entertainmentPricePerHour: string | null;
  rankedPricePerHour: string | null;
  highRankedPricePerHour: string | null;
  voicePreference: string;
  bio: string | null;
};

export type CompanionPage = { companions: PublicCompanion[]; total: number; page: number; limit: number };
export type CompanionLeaderboardEntry = Pick<PublicCompanion, "id" | "displayName" | "nickname" | "avatarUrl" | "verified" | "badges" | "averageRating" | "rating" | "reviewCount" | "completedOrders" | "onlineStatus">;
export type CompanionOption = Pick<PublicCompanion, "id" | "displayName" | "nickname" | "onlineStatus" | "pricePerHour">;

export type PaginatedCompanionListQuery = CompanionListQuery & ({ page: string | number } | { limit: string | number } | { sort: string });

type ListOptions = { paginated: boolean; page: number; limit: number; sort: string; filter: string; q: string };

export function companionListOptions(query: CompanionListQuery): ListOptions {
  const paginated = query.page !== undefined || query.limit !== undefined || query.sort !== undefined;
  const positiveInteger = (value: string | number | undefined, fallback: number, label: string) => {
    if (value === undefined) return fallback;
    if ((typeof value !== "string" && typeof value !== "number") || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
      throw new BadRequestException(`${label}必须为正整数`);
    }
    return Number(value);
  };
  const page = positiveInteger(query.page, 1, "页码");
  const limit = Math.min(positiveInteger(query.limit, 24, "每页数量"), 60);
  if (!Number.isSafeInteger((page - 1) * limit)) throw new BadRequestException("页码超出允许范围");
  const sort = query.sort ?? "recommended";
  if (!["recommended", "rating", "orders", "price"].includes(sort)) throw new BadRequestException("排序方式无效");
  const filter = query.filter ?? "all";
  if (!["all", "online", "voice", "recommended", "newbie", "high-rank"].includes(filter)) throw new BadRequestException("筛选方式无效");
  if (query.q !== undefined && typeof query.q !== "string") throw new BadRequestException("搜索内容格式无效");
  const q = query.q?.trim() ?? "";
  if (q.length > 80) throw new BadRequestException("搜索内容不能超过80个字符");
  return { paginated, page, limit, sort, filter, q };
}

function eligibleCompanions(game?: GameCode, options?: ListOptions) {
  if (game !== undefined && !Object.values(GameCode).includes(game)) throw new BadRequestException("游戏类型无效");
  const filter = options?.filter ?? "all";
  const predicates = [Prisma.sql`cp.status = 'LISTED' AND u.status = 'ACTIVE'`];
  if (game) predicates.push(Prisma.sql`(cp.game = ${game}::"GameCode" OR ${game}::"GameCode" = ANY(cp.games))`);
  if (options?.q) predicates.push(Prisma.sql`POSITION(LOWER(${options.q}) IN LOWER(cp.nickname || ' ' || u."displayName")) > 0`);
  if (filter === "online") predicates.push(Prisma.sql`cp."onlineStatus" = 'ONLINE'`);
  if (filter === "voice") predicates.push(Prisma.sql`cp."voicePreference" <> 'TEXT_ONLY'`);
  if (filter === "recommended") predicates.push(Prisma.sql`cp."onlineStatus" = 'ONLINE' AND cp."pricePerHour" > 0`);
  if (filter === "newbie") predicates.push(Prisma.sql`(COALESCE(cp.bio, '') || ' ' || array_to_string(cp."skillModes", ' ') || ' ' || cp."deltaForceRank"::text) ~ '新手|教学|耐心|入门|陪练'`);
  if (filter === "high-rank") predicates.push(Prisma.sql`cp."deltaForceRank" IN ('DIAMOND', 'ASCENDANT', 'IMMORTAL', 'TOP')`);
  return Prisma.sql`SELECT cp.*, u."displayName" FROM companion_profiles cp JOIN users u ON u.id = cp."userId" WHERE ${Prisma.join(predicates, " AND ")}`;
}

function directoryOrder(sort: string) {
  if (sort === "rating") return Prisma.sql`a."averageRating" DESC NULLS LAST, a."completedOrders" DESC, a."userId" ASC`;
  if (sort === "orders") return Prisma.sql`a."completedOrders" DESC, a."averageRating" DESC NULLS LAST, a."userId" ASC`;
  if (sort === "price") return Prisma.sql`a."pricePerHour" ASC, a."userId" ASC`;
  return Prisma.sql`CASE WHEN a."onlineStatus" = 'ONLINE' THEN 0 ELSE 1 END ASC, a.verified DESC, a."averageRating" DESC NULLS LAST, a."completedOrders" DESC, a."userId" ASC`;
}

export function companionDirectorySql(game: GameCode | undefined, options: ListOptions, leaderboard = false) {
  const order = directoryOrder(leaderboard ? "orders" : options.sort);
  const paging = leaderboard ? Prisma.sql`LIMIT 5` : options.paginated ? Prisma.sql`LIMIT ${options.limit} OFFSET ${(options.page - 1) * options.limit}` : Prisma.empty;
  const summary = Prisma.sql`
    WITH eligible AS (${eligibleCompanions(game, options)}),
    review_summary AS (
      SELECT o."companionId", AVG(r.stars)::double precision AS "averageRating", COUNT(*)::integer AS "reviewCount"
      FROM order_reviews r JOIN orders o ON o.id = r."orderId" JOIN eligible e ON e."userId" = o."companionId"
      WHERE r.hidden = false GROUP BY o."companionId"
    ), order_summary AS (
      SELECT o."companionId", COUNT(*) FILTER (WHERE o.status = 'COMPLETED' AND o."isTest" = false)::integer AS "completedOrders",
        COUNT(*) FILTER (WHERE o.status IN ('ACCEPTED', 'IN_PROGRESS'))::integer AS "activeServiceCount"
      FROM orders o JOIN eligible e ON e."userId" = o."companionId" GROUP BY o."companionId"
    ), aggregated AS (
      SELECT e.*, r."averageRating", COALESCE(r."reviewCount", 0) AS "reviewCount",
        COALESCE(o."completedOrders", 0) AS "completedOrders", COALESCE(o."activeServiceCount", 0) AS "activeServiceCount"
      FROM eligible e LEFT JOIN review_summary r ON r."companionId" = e."userId" LEFT JOIN order_summary o ON o."companionId" = e."userId"
    ), selected AS (
      SELECT a.*, ROW_NUMBER() OVER (ORDER BY ${order}) AS position FROM aggregated a ORDER BY ${order} ${paging}
    )`;
  const commonFields = Prisma.sql`
    'id', s."userId", 'displayName', s."displayName", 'nickname', s.nickname, 'avatarUrl', s."avatarUrl",
    'verified', s.verified, 'badges', s.badges, 'averageRating', s."averageRating", 'rating', s."averageRating",
    'reviewCount', s."reviewCount", 'completedOrders', s."completedOrders", 'onlineStatus', s."onlineStatus"`;
  if (leaderboard) return Prisma.sql`${summary}
    SELECT COALESCE(jsonb_agg(jsonb_build_object(${commonFields}) ORDER BY s.position), '[]'::jsonb) AS companions FROM selected s`;
  // Preview rows are bounded in SQL after selecting the page, so review history never crosses the API boundary in full.
  return Prisma.sql`${summary}, preview_rows AS (
      SELECT o."companionId", r.stars, r.comment, r."createdAt", ROW_NUMBER() OVER (
        PARTITION BY o."companionId" ORDER BY r."createdAt" DESC, r.id DESC) AS position
      FROM order_reviews r JOIN orders o ON o.id = r."orderId" JOIN selected s ON s."userId" = o."companionId" WHERE r.hidden = false
    ), previews AS (
      SELECT "companionId", jsonb_agg(jsonb_build_object('stars', stars, 'comment', comment, 'createdAt', to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY position) AS reviews
      FROM preview_rows WHERE position <= 20 GROUP BY "companionId"
    ), accounts AS (
      SELECT e."userId", jsonb_agg(jsonb_build_object('platform', e.platform, 'displayName', e."displayName") ORDER BY e.platform) AS accounts
      FROM user_external_accounts e JOIN selected s ON s."userId" = e."userId" GROUP BY e."userId"
    )
    SELECT (SELECT COUNT(*)::integer FROM eligible) AS total,
      COALESCE(jsonb_agg(jsonb_build_object(${commonFields},
        'photoUrls', s."photoUrls", 'voiceIntroUrl', s."voiceIntroUrl", 'game', s.game,
        'games', CASE WHEN cardinality(s.games) > 0 THEN s.games ELSE ARRAY[s.game] END,
        'status', s.status, 'activeServiceCount', s."activeServiceCount",
        'availability', CASE WHEN s."onlineStatus" = 'BUSY' THEN 'PAUSED' WHEN s."activeServiceCount" > 0 THEN 'IN_SERVICE'
          WHEN s."onlineStatus" = 'ONLINE' THEN 'AVAILABLE' ELSE 'CONTACT_FIRST' END,
        'deltaForceRank', s."deltaForceRank", 'skillModes', s."skillModes", 'pricePerHour', s."pricePerHour"::text,
        'kookPricePerHour', s."kookPricePerHour"::text, 'discordPricePerHour', s."discordPricePerHour"::text,
        'entertainmentPricePerHour', s."entertainmentPricePerHour"::text, 'rankedPricePerHour', s."rankedPricePerHour"::text,
        'highRankedPricePerHour', s."highRankedPricePerHour"::text, 'voicePreference', s."voicePreference", 'bio', s.bio,
        'reviews', COALESCE(p.reviews, '[]'::jsonb), 'externalAccounts', COALESCE(e.accounts, '[]'::jsonb)
      ) ORDER BY s.position), '[]'::jsonb) AS companions
    FROM selected s LEFT JOIN previews p ON p."companionId" = s."userId" LEFT JOIN accounts e ON e."userId" = s."userId"`;
}

export function companionOptionsSql(game?: GameCode) {
  return Prisma.sql`WITH eligible AS (${eligibleCompanions(game)})
    SELECT e."userId" AS id, e.nickname, e."displayName", e."onlineStatus", e."pricePerHour"::text AS "pricePerHour"
    FROM eligible e WHERE e."onlineStatus" = 'ONLINE' AND NOT EXISTS (
      SELECT 1 FROM orders o WHERE o."companionId" = e."userId" AND (o.status IN ('ACCEPTED', 'IN_PROGRESS') OR
        (o.status = 'DISPUTED' AND o."disputeFromStatus" IN ('ACCEPTED', 'IN_PROGRESS')))
    ) ORDER BY e.nickname ASC, e."userId" ASC`;
}
