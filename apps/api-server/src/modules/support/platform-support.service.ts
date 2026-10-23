import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { BotEventStatus, BotPlatform, CompanionProfileStatus, GameCode, OrderSourcePlatform, Prisma, UserRole, UserStatus } from "@prisma/client";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { normalizeDisplayNameKey } from "../auth/display-name.util";
import { createPasswordHash } from "../auth/password.util";
import { PrismaService } from "../prisma/prisma.service";
import { OrderDraftsService } from "../orders/order-drafts.service";
import { extractiveAnswer, groundedInstruction, KnowledgeDoc, retrieveKnowledge } from "./knowledge";

const KNOWLEDGE_CACHE_MS = 60_000;

type SupportRule = {
  topic: string;
  keywords: string[];
  answer: string;
  handoffRequired?: boolean;
};

type SupportResult = {
  answer: string;
  matchedTopic: string;
  handoffRequired: boolean;
};

type SupportHistoryTurn = {
  id?: string;
  matchedTopic?: string | null;
  message: string;
  answer: string;
};

type DemandFacts = {
  hasOrderContext: boolean;
  game?: string;
  mode?: string;
  duration?: string;
  budget?: string;
  startTime?: string;
  trial?: string;
  missing: string[];
  summary: string;
};

type PlatformSupportMessage = {
  platform: BotPlatform;
  platformUserId: string;
  displayName?: string;
  guildId?: string;
  channelId?: string;
  messageId?: string;
  content: string;
  isDirect?: boolean;
};

type SupportScope = { userId?: string; platform?: BotPlatform; platformUserId?: string; guildId?: string; channelId?: string; isDirect?: boolean };

type PlatformCustomerIdentity = Pick<PlatformSupportMessage, "platform" | "platformUserId" | "displayName">;
type PlatformAccountWithUser = Prisma.UserExternalAccountGetPayload<{ include: { user: true } }>;

const SUPPORT_RULES: SupportRule[] = [
  {
    topic: "问候",
    keywords: ["你好", "您好", "在吗", "有人吗", "hi", "hello", "hey", "客服在吗"],
    answer:
      "你好，这里是 小小电竞客服。我可以帮你处理找陪玩、试音选人、充值说明、优惠码、退款投诉和陪玩入驻。你可以直接说需求，比如：想找陪玩、充值没到账、想先试音。"
  },
  {
    topic: "预算价格",
    keywords: ["没有预算", "不确定预算", "预算不清楚", "预算", "价格", "多少钱", "报价", "费用", "怎么收费", "可以先看看"],
    answer:
      "可以，不确定预算也能先下需求。你先告诉我游戏、模式、预计玩多久、是否需要试音；客服会先按陪玩报价和在线情况给你推荐候选人，确认陪玩和时长后再核算价格。"
  },
  {
    topic: "充值未到账",
    keywords: ["充值", "到账", "余额", "转账", "加钱", "未到账", "审核", "截图", "人工加余额"],
    answer:
      "充值目前是人工审核。请在充值页提交金额、转账截图和备注，管理员核对后余额才会入账。金额填错、截图不清楚、优惠码不确定时，可以先联系人工客服确认。",
    handoffRequired: true
  },
  {
    topic: "找陪玩",
    keywords: ["找陪玩", "下单", "派单", "预约", "试音", "上分", "带我", "陪打", "陪练", "来个", "安排"],
    answer:
      "可以，我先帮你排。请直接发：游戏、模式、大概玩多久、想现在开始还是预约、是否要试音。预算不确定也没关系，客服会按候选陪玩的报价给你确认。"
  },
  {
    topic: "试音选人",
    keywords: ["试音", "语音", "频道", "听声音", "选人", "人工派单"],
    answer:
      "可以先表达试音需求。试音、选择陪玩和正式接单是三个步骤；是否收费和何时能试，需要核对候选陪玩。"
  },
  {
    topic: "退款投诉",
    keywords: ["退款", "投诉", "不满意", "纠纷", "取消", "退钱", "售后"],
    answer:
      "退款和投诉需要人工处理。请提供订单号、陪玩昵称、问题说明和截图/录屏；平台会保留订单日志、派单记录和钱包流水，客服核实后给处理结果。",
    handoffRequired: true
  },
  {
    topic: "陪玩入驻",
    keywords: ["陪玩注册", "入驻", "成为陪玩", "考核", "陪玩端", "接单"],
    answer:
      "陪玩不能自行注册。请联系 VX、KOOK 或 Discord 客服提交资料并进行试音/考核；通过后由管理员创建陪玩账号、设置资料并上架。"
  },
  {
    topic: "提现",
    keywords: ["提现", "支付宝", "收款", "打款", "收益", "佣金"],
    answer:
      "陪玩收益会在订单完成结算后进入可提现收入。陪玩端可以设置支付宝收款姓名和账号，提交提现后由管理员人工审核并打款。AI 客服不能确认提现完成。"
  },
  {
    topic: "账号绑定",
    keywords: ["绑定", "kook", "discord", "dc", "频道", "客服", "登录", "私聊"],
    answer:
      "客户可以使用邮箱注册，也可以后续绑定 KOOK 或 Discord。KOOK/Discord 主要用于客服沟通、试音频道、人工派单和订单通知；绑定后后台可以追踪订单来源。"
  },
  {
    topic: "优惠推荐",
    keywords: ["优惠", "推荐", "邀请码", "老带新", "返利", "奖励", "首单", "首充", "优惠码", "充值码"],
    answer:
      "优惠是否可用要核对活动配置和你的订单。请在确认页查看实际优惠和总额；这里不能保证返利或赠送。"
  },
  {
    topic: "人工客服",
    keywords: ["人工", "客服", "微信", "vx", "联系", "二维码"],
    answer:
      "请从网站客服入口联系人工。目前没有人工接单回执，不能保证何时回复。"
  }
];

export const DEFAULT_SUPPORT_SUGGESTIONS = ["找陪玩", "预算价格", "充值未到账", "试音选人", "退款投诉"];

const MONEY_OR_DECISION_FALLBACK = "这类问题需要人工客服处理，请联系管理员或等待人工客服介入。";
const DANGEROUS_AI_PHRASES = [
  "已退款",
  "已经退款",
  "已加余额",
  "已经加余额",
  "已到账",
  "已经到账",
  "已处理",
  "已经处理",
  "已转账",
  "已经转账",
  "已提现",
  "已经提现",
  "退款成功",
  "余额已增加",
  "提现完成",
  "投诉成立",
  "帮您提交",
  "帮你提交",
  "帮您处理",
  "帮你处理",
  "帮您申请",
  "帮你申请",
  "正在处理",
  "正在审核",
  "很快到账",
  "马上到账",
  "24小时内到账",
  "保证",
  "一定会",
  "肯定可以",
  "系统会自动",
  "自动到账",
  "自动退款"
];
const GAME_NAME_BY_CODE: Partial<Record<GameCode, string>> = {
  [GameCode.DELTA_FORCE]: "三角洲行动",
  [GameCode.LEAGUE_OF_LEGENDS]: "英雄联盟",
  [GameCode.VALORANT]: "无畏契约",
  [GameCode.COUNTER_STRIKE_2]: "CS2",
  [GameCode.PUBG]: "PUBG 绝地求生",
  [GameCode.APEX_LEGENDS]: "Apex 英雄",
  [GameCode.NARAKA_BLADEPOINT]: "永劫无间",
  [GameCode.CALL_OF_DUTY]: "塔科夫 / COD"
};
const SUPPORTED_PRICE_LIST_GAMES = [
  GameCode.DELTA_FORCE,
  GameCode.LEAGUE_OF_LEGENDS,
  GameCode.VALORANT,
  GameCode.COUNTER_STRIKE_2,
  GameCode.PUBG,
  GameCode.APEX_LEGENDS,
  GameCode.NARAKA_BLADEPOINT,
  GameCode.CALL_OF_DUTY
] as const;
const SUPPORTED_PRICE_LIST_GAME_SET = new Set<GameCode>(SUPPORTED_PRICE_LIST_GAMES);

@Injectable()
export class PlatformSupportService {
  private readonly logger = new Logger(PlatformSupportService.name);
  private knowledgeCache: { loadedAt: number; docs: KnowledgeDoc[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderDrafts: OrderDraftsService
  ) {}

  async autoReplyForWeb(userId: string, message: string) {
    const normalizedMessage = this.normalizeMessage(message);
    const scope: SupportScope = { userId };
    const history = await this.loadConversationHistory(scope);
    const result = await this.resolveSupportAnswer(normalizedMessage, history, scope);
    const answer = this.identifyAssistant(result.answer, history);
    await this.prisma.aiSupportConversation.create({ data: { userId, message: normalizedMessage, ...result, answer } });
    return { ...result, answer, suggestions: DEFAULT_SUPPORT_SUGGESTIONS };
  }

  async handlePlatformMessage(input: PlatformSupportMessage) {
    const message = this.normalizeMessage(input.content);
    const duplicate = await this.findDuplicatePlatformMessage(input, message);
    if (duplicate) return {
      conversationId: duplicate.id, reply: duplicate.replyMessageId ? "" : duplicate.answer,
      matchedTopic: duplicate.matchedTopic ?? "duplicate", handoffRequired: duplicate.handoffRequired,
      draft: null, duplicate: Boolean(duplicate.replyMessageId)
    };

    let account = await this.prisma.userExternalAccount.findUnique({
      where: { platform_externalUserId: { platform: input.platform, externalUserId: input.platformUserId } },
      include: { user: true }
    });
    if (!account) account = await this.findOrCreatePlatformCustomer(input);
    else if (account.user.status === UserStatus.ACTIVE) account = await this.refreshPlatformAccountDisplayName(account, input);
    const scope: SupportScope = { ...input, userId: account?.userId };
    const history = await this.loadConversationHistory(scope);
    const customerId = account?.user.role === UserRole.CUSTOMER && account.user.status === UserStatus.ACTIVE ? account.userId : undefined;
    let result: SupportResult;
    let draft: { id: string; draftNo: string } | null = null;
    const escalation = this.handoffAnswer(message, history);
    const selectionCommand = /^(?:选择|选)\s+TRY/i.test(message.normalize("NFKC"));
    const dispatch = !escalation && !this.isOrderQuestion(message) && !this.isOrderContinuation(message, history) && !this.isPureConsultation(message) &&
      (this.isDispatchIntent(message) || this.isDemandContinuation(message, history));

    if (escalation) result = escalation;
    else if (selectionCommand && customerId) {
      try {
        const selected = await this.trySelectDraftCandidate(input, account, message);
        if (selected) {
          draft = { id: selected.draftId, draftNo: selected.draftNo };
          result = { answer: selected.reply, matchedTopic: "选择陪玩", handoffRequired: false };
        } else result = { answer: "没能确认这次选择。请使用当前候选卡上的需求号和陪玩姓名；同名时用候选编号。不会自动替你选其他人。", matchedTopic: "选择待确认", handoffRequired: false };
      } catch {
        result = { answer: "这次选人的结果暂时没确认，请让人工客服核对原需求；先不要重复操作。", matchedTopic: "选择结果待核", handoffRequired: true };
      }
    } else if (dispatch) {
      const facts = this.buildDemandFacts(message, history);
      const receipt = await this.maybeCreateDispatchDraft(input, customerId, message, facts, history);
      draft = receipt.draft;
      result = { answer: receipt.reply, matchedTopic: receipt.topic, handoffRequired: receipt.handoffRequired };
    } else result = await this.resolveSupportAnswer(message, history, scope);

    const firstUseGuide = !account && input.platform === BotPlatform.KOOK
      ? "\n首次使用请私聊发送“首次使用”，由本人确认建立客户档案；已有网页账号请先绑定原账号。普通咨询不会建立客户档案。" : "";
    const answer = this.identifyAssistant(result.answer + firstUseGuide, history);
    let conversation;
    try {
      conversation = await this.prisma.aiSupportConversation.create({ data: {
        userId: account?.userId, platform: input.platform, platformUserId: input.platformUserId,
        platformGuildId: input.guildId ?? null, platformChannelId: input.channelId ?? null,
        platformMessageId: input.messageId, message, ...result, answer
      } });
    } catch (error) {
      // Concurrent deliveries may race on the durable platform/message unique key.
      if (!input.messageId || (error as { code?: string }).code !== "P2002") throw error;
      const saved = await this.findDuplicatePlatformMessage(input, message);
      if (!saved) throw error;
      return { conversationId: saved.id, reply: "", matchedTopic: saved.matchedTopic ?? "duplicate",
        handoffRequired: saved.handoffRequired, draft: null, duplicate: true };
    }
    return { conversationId: conversation.id, reply: answer, matchedTopic: result.matchedTopic, handoffRequired: result.handoffRequired, draft };
  }

  async markReplyMessage(conversationId: string, replyMessageId?: string) {
    if (!replyMessageId) return;
    await this.prisma.aiSupportConversation.update({
      where: { id: conversationId },
      data: { replyMessageId }
    });
  }

  async ensurePlatformCustomer(input: PlatformCustomerIdentity) {
    const account = await this.findOrCreatePlatformCustomer(input);
    if (!account) return null;
    return this.refreshPlatformAccountDisplayName(account, input);
  }

  private async maybeCreateDispatchDraft(
    input: PlatformSupportMessage, customerId: string | undefined, message: string,
    facts: DemandFacts, history: SupportHistoryTurn[] = []
  ) {
    const collecting = { draft: null, reply: this.buildDispatchCollectionReply(facts),
      topic: facts.missing.length ? "需求收集" : "需求待确认", handoffRequired: false };
    const lastReset = history.reduce((index, turn, current) => /(重新开始|重新下单|新需求|再来一单|换一单)/.test(turn.message) ? current : index, -1);
    const currentHistory = /(重新开始|重新下单|新需求|再来一单|换一单)/.test(message) ? [] : history.slice(Math.max(0, lastReset));
    const priorReceipt = [...currentHistory].reverse().find(turn =>
      ["需求已记录", "需求结果待核", "需求修改待核"].includes(turn.matchedTopic ?? "") || /派单草稿.+已记录|已发布派单/.test(turn.answer));
    const anchor = [...currentHistory].reverse().find(turn => turn.matchedTopic === "需求待确认" && turn.answer.includes(facts.summary));
    if (priorReceipt && (!this.isExplicitDispatchPublish(message) || !anchor)) return {
      ...collecting, reply: "前面已有提交过的需求，这次补充不会另建一单，也还没有修改原需求。请让人工客服核对原需求后调整。", topic: "需求修改待核", handoffRequired: true
    };
    if (!this.shouldPublishDispatchDraft(message, facts)) return collecting;
    // Only a persisted, unchanged summary can authorize this particular demand.
    if (!anchor?.id) return collecting;
    if (!customerId) return { ...collecting, reply: "请先绑定有效的客户账号，再确认发布需求；当前还没有创建草稿。", topic: "身份待确认", handoffRequired: true };
    if (!input.messageId) return { ...collecting, reply: "这条消息缺少回执编号，暂时不能安全发布需求。请从客服入口重试。", topic: "消息待确认", handoffRequired: true };
    if (facts.game !== "三角洲行动") return { ...collecting, reply: "当前自动需求流程只支持三角洲行动。其他游戏请先向人工客服确认是否能接。", topic: "人工核实", handoffRequired: true };
    const sourcePlatform = input.platform === BotPlatform.DISCORD ? OrderSourcePlatform.DISCORD : OrderSourcePlatform.KOOK;
    // Stable across different confirmation messages, disconnects and process restarts.
    const sourceMessageId = `support:${input.platformUserId}:${anchor.id}`;
    const sourceBusinessKey = createHash("sha256").update(JSON.stringify([sourcePlatform, input.guildId, input.channelId, sourceMessageId])).digest("hex");
    try {
      const existing = await this.prisma.orderDraft.findUnique({ where: { sourceBusinessKey }, select: { id: true, draftNo: true, status: true } });
      if (existing) return { draft: { id: existing.id, draftNo: existing.draftNo },
        reply: `需求 ${existing.draftNo} 已记录，这次没有重复创建。${this.draftStatusText(existing.status)}`,
        topic: "需求已记录", handoffRequired: false };
      const anchorIndex = history.indexOf(anchor);
      if (history.slice(anchorIndex + 1).some(turn => turn.matchedTopic === "需求结果待核")) return {
        ...collecting, reply: "上一条需求的提交结果仍待核实，先不要重新发布。请让人工客服核对原记录。", topic: "需求结果待核", handoffRequired: true
      };
      const serviceAdmin = await this.findServiceAdmin();
      if (!serviceAdmin) return { ...collecting, reply: "当前没有可用的派单管理员，尚未创建草稿。请联系人工客服。", topic: "发布失败", handoffRequired: true };
      // Use the typed entry point: reparsing a summary can turn a start time into a budget.
      const result = await this.orderDrafts.createDraft(serviceAdmin.id, {
        customerId, sourcePlatform, customerPlatformUserId: input.platformUserId, customerDisplayName: input.displayName,
        sourceGuildId: input.guildId, sourceChannelId: input.channelId, sourceMessageId,
        game: GameCode.DELTA_FORCE, mode: facts.mode!, hours: facts.duration!.replace("小时", ""),
        budgetAmount: facts.budget?.startsWith("¥") && Number(facts.budget.slice(1)) > 0 ? facts.budget.slice(1) : undefined,
        note: `AI 客服需求确认：${facts.summary}`
      });
      return { draft: { id: result.id, draftNo: result.draftNo },
        reply: `需求 ${result.draftNo} 已记录，已交给客服安排，尚未生成正式订单或扣款；选好陪玩后还要核对时长、单价和总额。`,
        topic: "需求已记录", handoffRequired: false };
    } catch {
      return { ...collecting, reply: "这次提交的结果暂时无法确认，先不要重新发布或付款。请让人工客服核对这条需求。", topic: "需求结果待核", handoffRequired: true };
    }
  }

  private async trySelectDraftCandidate(input: PlatformSupportMessage, account: PlatformAccountWithUser | null, message: string) {
    // A name/ID is stable across recommendation reordering; a bare ordinal is not.
    const command = message.normalize("NFKC").trim().match(/^(?:选择|选)\s+(TRY[A-Z0-9]+)\s+(.{1,100})$/i);
    if (!command || !input.platformUserId) return null;
    const draftNo = command[1].toUpperCase();
    const selector = command[2].trim().toLowerCase();
    if (/^第?\s*\d+\s*号?$/.test(selector)) return null;
    const sourcePlatform = input.platform === BotPlatform.DISCORD ? OrderSourcePlatform.DISCORD : OrderSourcePlatform.KOOK;
    const draft = await this.prisma.orderDraft.findFirst({
      where: {
        sourcePlatform, draftNo,
        status: { in: ["OPEN", "TRIALING", "SELECTED"] },
        OR: [
          ...(account?.userId ? [{ customerId: account.userId }] : []),
          { customerPlatformUserId: input.platformUserId }
        ],
        ...(input.guildId ? { sourceGuildId: input.guildId } : {}),
        ...(input.channelId && !input.isDirect ? { sourceChannelId: input.channelId } : {})
      },
      include: { candidates: { include: { companion: { include: { companionProfile: true } } } } }
    });
    if (!draft) return null;
    const matches = draft.candidates.filter(candidate => candidate.status !== "REJECTED" &&
      (selector === `#${candidate.id}`.toLowerCase() ||
       [candidate.companion.companionProfile?.nickname, candidate.companion.displayName]
         .some(name => typeof name === "string" && name.normalize("NFKC").trim().toLowerCase() === selector)));
    // Duplicate display names must be resolved through the exact candidate ID.
    if (matches.length !== 1) return null;
    const selected = matches[0];

    const serviceAdmin = await this.findServiceAdmin();
    if (!serviceAdmin) return null;

    await this.orderDrafts.selectCompanion(serviceAdmin.id, draft.id, {
      companionId: selected.companionId,
      note: `Customer selected this companion from ${sourcePlatform}: ${message}`
    }, {
      draftNo, sourcePlatform, platformUserId: input.platformUserId,
      customerId: account?.userId, guildId: input.guildId,
      channelId: input.isDirect ? undefined : input.channelId, candidateId: selected.id
    });

    const companionName = selected.companion.companionProfile?.nickname ?? selected.companion.displayName;
    return {
      draftId: draft.id,
      draftNo: draft.draftNo,
      reply: `已记录你选择的陪玩：${companionName}。这还不是正式接单或扣款；请先核对游戏、模式、时长、开始时间、单价和总额，再确认正式订单。`
    };
  }

  private async resolveSupportAnswer(message: string, history: SupportHistoryTurn[] = [], scope: SupportScope = {}): Promise<SupportResult> {
    const handoff = this.handoffAnswer(message, history);
    if (handoff) return handoff;
    if (this.isOrderQuestion(message) || this.isOrderContinuation(message, history)) return this.orderAnswer(message, history, scope);
    if (/(我想接单|我要接单|怎么接单|如何接单|陪玩入驻|成为陪玩|应聘陪玩)/.test(message)) return {
      answer: "想成为陪玩接单，需要先联系人工提交资料和试音考核，通过后由管理员创建并上架陪玩账号。", matchedTopic: "陪玩入驻", handoffRequired: true
    };
    if (/(你是.*(真人|机器人|人工|AI)|你是谁|真人吗|人工吗|是不是机器人)/i.test(message)) return {
      answer: "我是小小电竞的 AI 客服，可以查订单状态、整理陪玩需求。退款、争议和异常需要人工处理。", matchedTopic: "客服身份", handoffRequired: false
    };
    if (/^(谢谢|谢了|好的|好|收到|ok|嗯|明白了)[！!。.]?$/i.test(message)) {
      const last = history.at(-1);
      return { answer: last?.matchedTopic === "需求待确认" ? "确认这些信息的话，回复“确认发布需求”就可以；目前还没发布。" : "好，有新的情况直接接着说就行。", matchedTopic: "简短回应", handoffRequired: false };
    }
    if (/^(你好|您好|在吗|有人吗|hi|hello|hey|客服在吗)[？?！!。.]?$/i.test(message)) return {
      answer: "在的，你想找陪玩，还是有订单需要我看一下？", matchedTopic: "问候", handoffRequired: false
    };
    if (!this.isPureConsultation(message) && (this.isDispatchIntent(message) || this.isDemandContinuation(message, history))) {
      const facts = this.buildDemandFacts(message, history);
      return { answer: `${this.buildDispatchCollectionReply(facts)}${scope.platform ? "" : " 网站聊天不会代你下单，请在下单页核对陪玩、时长和总额后提交。"}`,
        matchedTopic: facts.missing.length ? "需求收集" : "需求待确认", handoffRequired: false };
    }
    // Guarantee packages are priced per tier, so their questions go to the knowledge base before hourly pricing.
    if (/(保底|护航)/.test(message)) {
      const knowledge = await this.tryKnowledgeAnswer(message, history);
      if (knowledge) return knowledge;
    }
    try {
      if (this.isPriceQuestion(message)) {
        const game = this.buildDemandFacts(message, history).game;
        return { answer: await this.buildPricingAnswer(game ? `${game} ${message}` : message), matchedTopic: "价格咨询", handoffRequired: false };
      }
      const dynamic = await this.tryDynamicBusinessAnswer(message.toLowerCase());
      if (dynamic) return dynamic;
    } catch {
      return { answer: "当前查询没成功，暂时不能确认实时信息。可以稍后重试，急用的话请联系人工客服。", matchedTopic: "查询失败", handoffRequired: true };
    }
    const knowledge = await this.tryKnowledgeAnswer(message, history);
    if (knowledge) return knowledge;
    const matched = SUPPORT_RULES.find(rule => rule.keywords.some(word => message.toLowerCase().includes(word.toLowerCase())));
    return { answer: matched?.answer ?? this.buildContextualFallback(message), matchedTopic: matched?.topic ?? "继续确认", handoffRequired: matched?.handoffRequired ?? false };
  }

  /** RAG: retrieve operator knowledge, then let the model rephrase only that material; fall back to the text itself. */
  private async tryKnowledgeAnswer(message: string, history: SupportHistoryTurn[]): Promise<SupportResult | null> {
    let docs: KnowledgeDoc[];
    try { docs = await this.loadKnowledge(); }
    catch { return null; }
    const hits = retrieveKnowledge(message, docs);
    if (!hits.length) return null;
    const generated = await this.tryOpenAiSupportAnswer(message, history, undefined, groundedInstruction(hits));
    return { answer: generated ?? extractiveAnswer(hits[0]), matchedTopic: `知识库:${hits[0].doc.title}`, handoffRequired: false };
  }

  private async loadKnowledge(): Promise<KnowledgeDoc[]> {
    if (this.knowledgeCache && Date.now() - this.knowledgeCache.loadedAt < KNOWLEDGE_CACHE_MS) return this.knowledgeCache.docs;
    const [rows, packages] = await Promise.all([
      this.prisma.supportKnowledge.findMany({ where: { isActive: true }, select: { id: true, title: true, content: true, keywords: true } }),
      this.prisma.guaranteePackage.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { targetWan: "asc" }] })
    ]);
    // Live prices are generated from the price table so the assistant never quotes a stale number.
    const live: KnowledgeDoc[] = packages.length ? [{
      id: "live-guarantee-prices", title: "保底护航当前档位价格",
      content: `当前保底护航档位：${packages.map(p => `${p.platform === "MOBILE" ? "手游" : "端游"} ${p.targetWan}W ¥${p.price.toFixed(2)}`).join("；")}。以下单页核对的金额为准。`,
      keywords: ["保底价格", "护航价格", "档位", "多少钱", "几档"]
    }] : [];
    const docs = [...rows, ...live];
    this.knowledgeCache = { loadedAt: Date.now(), docs };
    return docs;
  }

  invalidateKnowledgeCache() {
    this.knowledgeCache = null;
  }

  private identifyAssistant(answer: string, history: SupportHistoryTurn[]) {
    return history.some(turn => /AI 客服/.test(turn.answer)) || /AI 客服/.test(answer) ? answer : `我是小小电竞的 AI 客服。${answer}`;
  }

  private handoffAnswer(message: string, history: SupportHistoryTurn[]): SupportResult | null {
    const issue = /(退款|退钱|投诉|纠纷|争议|不满意|取消订单|取消陪玩|重复扣|多扣|异常|失败|没反应|充值|到账|余额|转账|提现|人工|真人客服|撤销|先别|不要发|别发|不下单|不找了|不玩了)/.test(message);
    if (!issue) {
      if (history.at(-1)?.matchedTopic === "人工核实" && /(截图|凭证|补充|还是|怎么还|多久|有人处理|发了|已经提交)/.test(message)) return {
        answer: "补充说明会保留在这段对话里。附件是否提交成功，请看上传回执；处理结果仍要从客服入口请人工核对，目前没有人工接单回执。", matchedTopic: "人工核实", handoffRequired: true
      };
      return null;
    }
    if (/(先别|不要发|别发|不下单|不找了|不玩了)/.test(message)) return {
      answer: "好，先不继续发布。若已有需求或订单，请在对应页面取消；聊天这句不会自动撤销已提交的记录。", matchedTopic: "需求暂停", handoffRequired: false
    };
    const refund = /(退款|退钱|投诉|纠纷|争议|不满意|取消订单|取消陪玩|重复扣|多扣)/.test(message);
    const last = history.at(-1);
    const followup = last?.matchedTopic === "人工核实";
    const orderKnown = this.orderReferences([message, ...history.map(t => t.message)].join(" ")).numbers.length > 0;
    return { answer: followup ? "这条仍需要人工核实，前面的说明已在本段对话中。请从网站客服入口联系人工；这里还没有人工接单回执。" :
      refund ? `这类售后需要人工核实。${orderKnown ? "已有订单号，不用重复发；" : "请在私聊或网站提供订单号，"}补充具体问题和相关证据即可。我不能判定退款，也还没有人工接单回执。` :
      /(充值|到账|余额|转账)/.test(message) ? "充值需要管理员审核，我这里不能确认到账。请在充值记录查看审核状态；已转账但未到账的话，从网站客服入口提供充值记录和凭证给人工核对。" :
      /提现/.test(message) ? "提现要由管理员审核并核实打款。我不能确认已打款，请从提现记录联系人工核对。" :
      "这项需要人工处理。请从网站客服入口联系人工；本段对话会保留，但目前没有人工接单回执。", matchedTopic: "人工核实", handoffRequired: true };
  }

  private isOrderQuestion(message: string) {
    return this.orderReferences(message).specified || /(我的.*订单|订单.*(状态|进度|怎么样|到了|在哪|查询)|查.*订单|有人接|接单了吗|开始了吗|怎么还没|刚才那单|上一单|这单|那单|催单)/.test(message);
  }

  private orderReferences(message: string) {
    const text = message.normalize("NFKC");
    // OrdersService generates MAY..., draft numbers use TRY...; retain legacy IDs.
    // Keep unknown explicitly labelled IDs too: failing to parse must never select a different order.
    const prefixed = text.match(/\b(?:MAY|DFC|ORD|TRY)[A-Z0-9_-]{5,}\b/ig) ?? [];
    const labelled = [...text.matchAll(/(?:订单号|需求号|单号|(?:查|查询)(?:一下)?订单|订单)\s*(?:是|为)?\s*[:：#]?\s*([A-Z0-9][A-Z0-9_-]*)/ig)].map(match => match[1]);
    const numbers = [...new Set([...prefixed, ...labelled].map(value => value.toUpperCase()))];
    return { numbers, specified: numbers.length > 0 || /(订单号|需求号|单号)/.test(text) };
  }

  private isOrderContinuation(message: string, history: SupportHistoryTurn[]) {
    return history.at(-1)?.matchedTopic === "订单查询" && /(什么时候|还要多久|现在呢|有变化|还没开始|进度呢)/.test(message);
  }

  private async orderAnswer(message: string, history: SupportHistoryTurn[], scope: SupportScope): Promise<SupportResult> {
    const result = (answer: string, handoffRequired = false): SupportResult => ({ answer, matchedTopic: "订单查询", handoffRequired });
    if (scope.platform && scope.isDirect !== true) return result("订单信息请在私聊或登录网站后查询，避免在公共频道公开。这里不会展示订单和金额。");
    if (!scope.userId) return result("先绑定客户账号，再查自己的订单；订单号本身不能代替身份验证。");
    try {
      const user = await this.prisma.user.findUnique({ where: { id: scope.userId }, select: { role: true, status: true } });
      if (user?.role !== UserRole.CUSTOMER || user.status !== UserStatus.ACTIVE) return result("当前身份不能查询客户订单，请使用有效的客户账号。", true);
      const explicit = this.orderReferences(message);
      if (explicit.numbers.length > 1) return result("这次提到了多个订单，请指定要查的那一个订单号。");
      if (explicit.specified && !explicit.numbers.length) return result("请提供完整订单号，再核对这一笔；我不会替换成其他订单。");
      const previous = history.at(-1);
      const continuation = /(这单|那单|刚才那单|上一单)/.test(message) || this.isOrderContinuation(message, history);
      let ref = explicit.numbers[0];
      if (!ref && continuation) {
        if (previous?.matchedTopic === "订单查询") {
          const requested = this.orderReferences(previous.message);
          const inherited = requested.specified ? requested.numbers : this.orderReferences(previous.answer).numbers;
          if (inherited.length === 1) ref = inherited[0];
        }
        if (!ref) return result("还没确定你指的是哪一笔，请提供订单号；我不会自动选另一笔订单。");
      }
      if (ref?.startsWith("TRY")) {
        const draft = await this.prisma.orderDraft.findFirst({ where: { draftNo: ref, customerId: scope.userId }, select: { draftNo: true, status: true } });
        return result(draft ? `需求 ${draft.draftNo}：${this.draftStatusText(draft.status)}` : `没有查到属于当前账号的需求 ${ref}，请核对编号和绑定账号。`);
      }
      const orders = await this.prisma.order.findMany({ where: { customerId: scope.userId,
        ...(ref ? { orderNo: ref } : { status: { notIn: ["COMPLETED", "CANCELLED", "REFUNDED"] } }) },
        select: { orderNo: true, status: true, game: true, mode: true, hours: true, unitPrice: true, totalAmount: true, voiceTrialRequested: true },
        orderBy: { createdAt: "desc" }, take: 2 });
      if (!orders.length) return result(`没有查到属于当前账号的${ref ? `订单 ${ref}` : "这笔订单"}。可以从订单页复制订单号并核对绑定账号；我不会据此判断是否扣款或退款。`);
      if (orders.length > 1) return result("你有多笔进行中的订单，请指定订单号，免得查错。");
      const order = orders[0];
      const states: Record<string, string> = { PENDING_PAYMENT: "待支付，支付前请核对金额", PAID: "已支付，等待派单", ASSIGNED: "已派单，等待陪玩接单", ACCEPTED: "陪玩已接单，尚未开始服务", IN_PROGRESS: "服务进行中", AWAITING_ACCEPTANCE: "陪玩已报完成，等待你验收", COMPLETED: "已完成", CANCELLED: "已取消，资金情况请核对钱包流水", REFUND_REQUESTED: "退款申请待人工审核", REFUNDED: "订单标记为已退款，具体流水请在钱包核对", DISPUTED: "争议待人工处理" };
      return result(`订单 ${order.orderNo}：${states[order.status] ?? "状态待人工核实"}。${this.getGameName(order.game)}，${order.mode}，${order.hours}小时；订单单价 ¥${order.unitPrice}/时，总额 ¥${order.totalAmount}。${order.voiceTrialRequested ? "试音申请与正式服务状态分开，以这里的订单状态为准。" : ""}`,
        ["REFUND_REQUESTED", "DISPUTED"].includes(order.status) || !states[order.status]);
    } catch {
      return result("订单查询暂时失败，状态还不能确认。先别重复下单或付款，可稍后重查或联系人工核对。", true);
    }
  }

  private draftStatusText(status: string) {
    const states: Record<string, string> = { OPEN: "等待候选报名，尚未正式接单或扣款。", TRIALING: "试音中，尚未正式接单或扣款。", SELECTED: "已选陪玩，正式下单前仍需确认时长和金额。", CUSTOMER_CONFIRMED: "需求已确认，请在订单页核对是否已生成正式订单。", CONVERTED: "已转正式订单，请在订单页查看服务和金额。", CANCELLED: "需求已取消。", CLOSED: "需求已关闭。" };
    return states[status] ?? "状态暂时无法确认，请人工核对。";
  }

  private async tryDynamicBusinessAnswer(message: string): Promise<SupportResult | null> {
    if (this.isPersonalSettingsQuestion(message)) {
      return {
        matchedTopic: "个人设置",
        answer: "网站端个人设置在顶部导航或手机底部的“设置”，也可以直接打开 /customer/settings。里面能看账号、邀请码、钱包、KOOK/Discord 绑定和客服入口。",
        handoffRequired: false
      };
    }

    if (this.isCatalogQuestion(message)) {
      return {
        matchedTopic: "游戏咨询",
        answer: await this.buildGameCatalogAnswer(),
        handoffRequired: false
      };
    }

    if (this.isPriceQuestion(message)) {
      return {
        matchedTopic: "价格咨询",
        answer: await this.buildPricingAnswer(message),
        handoffRequired: false
      };
    }

    const shortGameName = this.matchShortGameName(message);
    if (shortGameName) {
      return {
        matchedTopic: "游戏确认",
        answer: `可以，${shortGameName}我先记下。你是想找陪玩、试音选人，还是先问价格？`,
        handoffRequired: false
      };
    }

    if (this.isCompanionCountQuestion(message)) {
      const [listedCount, totalCount, onlineCount] = await this.prisma.$transaction([
        this.prisma.companionProfile.count({ where: { status: CompanionProfileStatus.LISTED } }),
        this.prisma.companionProfile.count(),
        this.prisma.companionProfile.count({ where: { status: CompanionProfileStatus.LISTED, onlineStatus: "ONLINE" } })
      ]);

      const answer =
        listedCount > 0
          ? `目前后台正式上架的陪玩有 ${listedCount} 位，其中在线状态 ${onlineCount} 位；总陪玩档案 ${totalCount} 位，包含待审核、下架或测试账号。你如果要找人，可以直接说游戏、模式和大概时间，我帮你走人工派单。`
          : `目前还在测试和招募阶段，后台暂时没有正式上架的陪玩；如果你是在测试流程，可以继续发游戏、模式和预计时间，我会按派单流程帮你记录，后面接入真实陪玩后就能直接匹配。`;

      return {
        matchedTopic: "陪玩数量",
        answer,
        handoffRequired: false
      };
    }

    // Only questions about the assistant itself; "X怎么用" must reach the knowledge base instead.
    if (/(你能干什么|你能做什么|你是谁|客服能干嘛)/i.test(message) || /^(能做什么|怎么用|如何使用)[？?。!！]*$/.test(message)) {
      return {
        matchedTopic: "客服能力",
        answer:
          "我是小小电竞的 AI 客服，可以查订单、整理陪玩和试音需求。涉及退款、投诉和资金核实，需要人工处理。",
        handoffRequired: false
      };
    }

    return null;
  }

  private async findDuplicatePlatformMessage(input: PlatformSupportMessage, message: string) {
    if (!input.messageId) return null;
    return this.prisma.aiSupportConversation.findFirst({ where: {
      platform: input.platform, platformMessageId: input.messageId, platformUserId: input.platformUserId,
      platformGuildId: input.guildId ?? null, platformChannelId: input.channelId ?? null
    }, orderBy: { createdAt: "desc" }, select: { id: true, matchedTopic: true, handoffRequired: true, answer: true, replyMessageId: true } });
  }

  private async findOrCreatePlatformCustomer(input: PlatformCustomerIdentity) {
    if (process.env.PLATFORM_AUTO_CREATE_CUSTOMER_ENABLED === "false") return null;
    if (!isValidPlatformUserId(input.platform, input.platformUserId)) return null;

    const existing = await this.prisma.userExternalAccount.findUnique({
      where: {
        platform_externalUserId: {
          platform: input.platform,
          externalUserId: input.platformUserId
        }
      },
      include: { user: true }
    });
    if (existing) return this.refreshPlatformAccountDisplayName(existing, input);
    // KOOK customers are created only by their issued, explicit first-use confirmation.
    if (input.platform === BotPlatform.KOOK) return null;

    const resolvedDisplayName = (await this.resolvePlatformDisplayName(input)) ?? input.displayName;
    const realDisplayName = sanitizePlatformDisplayName(resolvedDisplayName);
    if (!realDisplayName) {
      this.logger.warn(`Skip auto-creating ${input.platform} customer ${input.platformUserId}: platform displayName is unavailable`);
      return null;
    }

    const displayName = await this.getAvailablePlatformCustomerDisplayName(input.platform, realDisplayName);
    const displayNameKey = normalizeDisplayNameKey(displayName);
    const email = buildPlatformCustomerEmail(input.platform, input.platformUserId);
    const passwordHash = await createPasswordHash(randomBytes(32).toString("hex"));

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            passwordHash,
            role: UserRole.CUSTOMER,
            displayName,
            displayNameKey,
            referralCode: await generateUniqueReferralCode(tx, "C")
          }
        });
        await tx.wallet.create({ data: { userId: created.id } });
        await tx.userExternalAccount.create({
          data: {
            userId: created.id,
            platform: input.platform,
            externalUserId: input.platformUserId,
            displayName: sanitizePlatformDisplayName(resolvedDisplayName)
          }
        });
        return created;
      });

      this.logger.log(`Auto-created ${input.platform} customer profile for ${input.platformUserId}`);
      return this.prisma.userExternalAccount.findUnique({
        where: {
          platform_externalUserId: {
            platform: input.platform,
            externalUserId: input.platformUserId
          }
        },
        include: { user: true }
      });
    } catch (error) {
      const raced = await this.prisma.userExternalAccount.findUnique({
        where: {
          platform_externalUserId: {
            platform: input.platform,
            externalUserId: input.platformUserId
          }
        },
        include: { user: true }
      });
      if (raced) return raced;
      throw error;
    }
  }

  private async refreshPlatformAccountDisplayName(account: PlatformAccountWithUser, input: PlatformCustomerIdentity) {
    const resolvedDisplayName = (await this.resolvePlatformDisplayName(input)) ?? input.displayName;
    const displayName = sanitizePlatformDisplayName(resolvedDisplayName);
    if (!displayName) return account;

    const shouldUpdateAccount = account.displayName !== displayName;
    const shouldRenameUser = isSyntheticPlatformCustomer(account.user, input.platform) && account.user.displayName !== displayName;
    if (!shouldUpdateAccount && !shouldRenameUser) return account;

    const userDisplayName = shouldRenameUser
      ? await this.getAvailablePlatformCustomerDisplayName(input.platform, displayName, account.userId)
      : undefined;

    await this.prisma.$transaction(async (tx) => {
      if (shouldUpdateAccount) {
        await tx.userExternalAccount.update({
          where: {
            platform_externalUserId: {
              platform: input.platform,
              externalUserId: input.platformUserId
            }
          },
          data: { displayName }
        });
      }

      if (userDisplayName) {
        await tx.user.update({
          where: { id: account.userId },
          data: {
            displayName: userDisplayName,
            displayNameKey: normalizeDisplayNameKey(userDisplayName)
          }
        });
      }
    });

    return this.prisma.userExternalAccount.findUniqueOrThrow({
      where: {
        platform_externalUserId: {
          platform: input.platform,
          externalUserId: input.platformUserId
        }
      },
      include: { user: true }
    });
  }

  private async resolvePlatformDisplayName(input: PlatformCustomerIdentity) {
    const directDisplayName = sanitizePlatformDisplayName(input.displayName);
    if (directDisplayName) return directDisplayName;
    if (input.platform === BotPlatform.KOOK) return this.fetchKookDisplayName(input.platformUserId);
    if (input.platform === BotPlatform.DISCORD) return this.fetchDiscordDisplayName(input.platformUserId);
    return undefined;
  }

  private async fetchKookDisplayName(kookUserId: string) {
    const token = process.env.KOOK_TOKEN;
    if (!token) return undefined;

    const query = new URLSearchParams({ user_id: kookUserId });
    if (process.env.KOOK_GUILD_ID) query.set("guild_id", process.env.KOOK_GUILD_ID);

    const fromView = await this.fetchKookUserView(token, query);
    if (fromView) return fromView;

    const guildId = process.env.KOOK_GUILD_ID;
    if (!guildId) return undefined;
    return this.fetchKookDisplayNameFromGuildList(token, guildId, kookUserId);
  }

  private async fetchKookUserView(token: string, query: URLSearchParams) {
    try {
      const response = await fetch(`https://www.kookapp.cn/api/v3/user/view?${query.toString()}`, {
        headers: { Authorization: `Bot ${token}` }
      });
      if (!response.ok) return undefined;
      const result = (await response.json()) as {
        code?: number;
        data?: { nickname?: string; username?: string; identify_num?: string };
      };
      if (result.code !== 0 || !result.data) return undefined;
      return formatKookPlatformDisplayName(result.data);
    } catch (error) {
      this.logger.warn(`KOOK nickname lookup failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private async fetchKookDisplayNameFromGuildList(token: string, guildId: string, kookUserId: string) {
    try {
      for (let page = 1; page <= 20; page += 1) {
        const query = new URLSearchParams({
          guild_id: guildId,
          page: String(page),
          page_size: "100"
        });
        const response = await fetch(`https://www.kookapp.cn/api/v3/guild/user-list?${query.toString()}`, {
          headers: { Authorization: `Bot ${token}` }
        });
        if (!response.ok) return undefined;
        const result = (await response.json()) as {
          code?: number;
          data?: {
            items?: Array<{ id?: string; nickname?: string; username?: string; identify_num?: string }>;
            meta?: { page_total?: number };
          };
        };
        if (result.code !== 0 || !result.data) return undefined;
        const member = result.data.items?.find((item) => item.id === kookUserId);
        if (member) return formatKookPlatformDisplayName(member);
        const pageTotal = Number(result.data.meta?.page_total ?? 1);
        if (page >= pageTotal) break;
      }
    } catch (error) {
      this.logger.warn(`KOOK guild nickname lookup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return undefined;
  }

  private async fetchDiscordDisplayName(discordUserId: string) {
    const token = process.env.DISCORD_TOKEN;
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!token || !guildId) return undefined;

    try {
      const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}`, {
        headers: { Authorization: `Bot ${token}` }
      });
      if (!response.ok) return undefined;
      const member = (await response.json()) as {
        nick?: string;
        user?: { global_name?: string; username?: string };
      };
      return sanitizePlatformDisplayName(member.nick || member.user?.global_name || member.user?.username);
    } catch (error) {
      this.logger.warn(`Discord nickname lookup failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private async getAvailablePlatformCustomerDisplayName(platform: BotPlatform, displayName?: string, currentUserId?: string) {
    const baseName = sanitizePlatformDisplayName(displayName);
    if (!baseName) throw new Error(`${platform} displayName is required before creating a platform customer`);

    for (let index = 0; index < 50; index += 1) {
      const candidate = index === 0 ? baseName : `${baseName}-${index + 1}`;
      const displayNameKey = normalizeDisplayNameKey(candidate);
      const existing = await this.prisma.user.findFirst({
        where: {
          role: UserRole.CUSTOMER,
          displayNameKey,
          ...(currentUserId ? { id: { not: currentUserId } } : {})
        },
        select: { id: true }
      });
      if (!existing) return candidate;
    }

    return `${baseName}-${randomBytes(2).toString("hex").toUpperCase()}`;
  }

  private async tryOpenAiSupportAnswer(message: string, history: SupportHistoryTurn[] = [], fallbackHint?: string, contextHint?: string) {
    const enabled = process.env.AI_SUPPORT_ENABLED === "true";
    const apiKey = process.env.AI_SUPPORT_API_KEY || process.env.OPENAI_API_KEY;
    if (!enabled || !apiKey) return null;

    try {
      const model = process.env.AI_SUPPORT_MODEL || "gpt-4o-mini";
      const baseUrl = (process.env.AI_SUPPORT_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
      const apiStyle = process.env.AI_SUPPORT_API_STYLE || "responses";
      const messages = this.buildAiSupportMessages(message, history, fallbackHint, contextHint);
      const response =
        apiStyle === "chat_completions"
          ? await this.callChatCompletions(baseUrl, apiKey, model, messages)
          : await this.callResponsesApi(baseUrl, apiKey, model, messages);

      if (!response.ok) {
        this.logger.warn(`AI support reply failed: HTTP ${response.status}`);
        return null;
      }
      const data = (await response.json()) as {
        output_text?: string;
        output?: Array<{ content?: Array<{ text?: string }> }>;
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text =
        data.output_text?.trim() ||
        data.choices?.[0]?.message?.content?.trim() ||
        data.output
          ?.flatMap((item) => item.content ?? [])
          .map((item) => item.text)
          .filter(Boolean)
          .join("\n")
          .trim() ||
        null;
      return text ? this.cleanAiSupportAnswer(text) : null;
    } catch (error) {
      this.logger.warn("AI support reply unavailable");
      return null;
    }
  }

  private callResponsesApi(baseUrl: string, apiKey: string, model: string, messages: Array<{ role: string; content: string }>) {
    return fetch(`${baseUrl}/responses`, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_output_tokens: 160,
        input: messages
      })
    });
  }

  private callChatCompletions(baseUrl: string, apiKey: string, model: string, messages: Array<{ role: string; content: string }>) {
    return fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_tokens: 160,
        temperature: 0.55,
        messages: messages.map((item) => ({
          role: item.role === "developer" ? "system" : item.role,
          content: item.content
        }))
      })
    });
  }

  private buildAiSupportMessages(message: string, history: SupportHistoryTurn[] = [], fallbackHint?: string, contextHint?: string) {
    return [
      {
        role: "developer",
        content:
          [
            "你是小小电竞的 AI 客服，不能自称真人。自然简短地说话，首次介绍身份，之后不用反复介绍。",
            "必须先理解客户当前这句话的意图，再回答；不要把所有问题都套成下单表单。",
            "客户问价格、有哪些游戏、陪玩数量、怎么下单时，先直接回答问题，再最多追问 1 个自然的问题。",
            "只有客户明确说要下单、找人、安排、派单、开始、发布招募时，才进入派单信息收集。",
            "价格不能编固定价；只能说按已上架陪玩、游戏、平台和时长报价，最终以后台订单和客服确认为准。",
            "当前产品是网站，不是 APP；不要编造“APP右下角我的”“齿轮图标”“头像下拉菜单”等不存在入口。",
            "个人设置路径是 /customer/settings；网站顶部导航或手机底部可进入设置。",
            "严禁声称已完成退款、加余额、提现、转账、到账、投诉处理；严禁承诺到账时间、优惠结果或一定能接。",
            "涉及充值、退款、提现、投诉、后台改余额，只能让人工客服处理。",
            "回复要短、自然、像人聊天；最多 120 个中文字。不要复述客户原话，不要道歉式自我解释，不要连续模板。"
          ].join("\n")
      },
      ...history.flatMap((turn) => [
        { role: "user", content: turn.message },
        { role: "assistant", content: turn.answer }
      ]),
      ...(contextHint
        ? [
            {
              role: "developer",
              content: contextHint
            }
          ]
        : []),
      ...(fallbackHint
        ? [
            {
              role: "developer",
              content: `如果用户问题很简单，可以参考这个业务答案，但请换成更自然、贴合上下文的表达：${fallbackHint}`
            }
          ]
        : []),
      {
        role: "user",
        content: message
      }
    ];
  }

  private async tryAiDispatchReply(
    message: string,
    history: SupportHistoryTurn[],
    facts: DemandFacts,
    stage: "collecting" | "published",
    fallbackReply: string,
    draftNo?: string
  ) {
    const contextHint =
      stage === "published"
        ? [
            "当前是陪玩派单流程：系统已经创建派单草稿并尝试发到 KOOK/Discord 派单频道。",
            draftNo ? `派单号：${draftNo}` : undefined,
            `已识别需求：${facts.summary || "暂无"}`,
            "只使用已验证的动作回执，创建草稿不等于通知送达、正式接单或扣款。",
            "不要承诺一定有人接，不要承诺价格，不要再追问多个问题。"
          ]
            .filter(Boolean)
            .join("\n")
        : [
            "当前是陪玩下单信息收集流程。客户在 KOOK/Discord 里随口说需求，你要像真人客服一样顺着聊。",
            `已识别需求：${facts.summary || "暂无"}`,
            `还缺字段：${facts.missing.length ? facts.missing.join("、") : "无"}`,
            "一次问齐缺少的必要信息，已经提供的不要再问；预算不确定不能当成零元或报价。",
            "不要机械复述“游戏/模式/时长/预算/试音/还差”，不要像表单。"
          ].join("\n");

    return this.tryOpenAiSupportAnswer(message, history, fallbackReply, contextHint);
  }

  private cleanAiSupportAnswer(answer: string) {
    const cleaned = answer
      .replace(/^(明白了|好的|收到)[，,。]\s*(是我.*?。|我刚才.*?。|抱歉.*?。)?/u, "")
      .replace(/现在直接说[:：]?\s*/u, "")
      .trim();

    if (this.containsDangerousAiPhrase(cleaned)) return MONEY_OR_DECISION_FALLBACK;

    const firstLines = cleaned
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join("\n");

    if (firstLines.length <= 180) return firstLines;
    return `${firstLines.slice(0, 177)}...`;
  }

  private containsDangerousAiPhrase(answer: string) {
    const normalized = answer.replace(/\s+/g, "");
    return DANGEROUS_AI_PHRASES.some((phrase) => normalized.includes(phrase));
  }

  private async loadConversationHistory(input: SupportScope) {
    if (!input.userId && !(input.platform && input.platformUserId)) return [];
    // Never merge private web/DM history into a public channel, even for a bound user.
    if (input.platform && !input.channelId && !input.isDirect) return [];
    const where: Prisma.AiSupportConversationWhereInput = input.platform ? {
      platform: input.platform, platformUserId: input.platformUserId,
      userId: input.userId ?? null, platformGuildId: input.guildId ?? null, platformChannelId: input.channelId ?? null
    } : { userId: input.userId, platform: null, platformUserId: null, platformGuildId: null, platformChannelId: null };
    const rows = await this.prisma.aiSupportConversation.findMany({ where: { ...where, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      orderBy: { createdAt: "desc" }, take: 30, select: { id: true, message: true, answer: true, matchedTopic: true } });
    return rows.reverse();
  }

  private isDispatchIntent(message: string) {
    if (/(我想接单|我要接单|怎么接单|如何接单|陪玩入驻|成为陪玩|应聘陪玩)/.test(message)) return false;
    if (this.isPureConsultation(message)) return false;
    return this.hasExplicitDispatchAction(message) || /(want.*play|need.*companion|boost|rank)/i.test(message);
  }

  private isDemandContinuation(message: string, history: SupportHistoryTurn[] = []) {
    if (this.isPureConsultation(message) || this.handoffAnswer(message, []) || this.isOrderQuestion(message)) return false;
    const last = history.at(-1);
    if (!last || !["需求收集", "需求待确认", "需求已记录", "需求结果待核", "需求修改待核", "简短回应", "找陪玩", "游戏确认"].includes(last.matchedTopic ?? "")) return false;
    return this.buildDemandFacts(message, history).hasOrderContext && Boolean(this.extractGame(message) || this.extractMode(message) || this.extractDuration(message) || this.extractBudget(message) || this.extractStartTime(message) || this.extractTrialPreference(message) || this.isExplicitDispatchPublish(message));
  }

  private buildDemandFacts(message: string, history: SupportHistoryTurn[] = []): DemandFacts {
    const facts: DemandFacts = { hasOrderContext: false, missing: [], summary: "" };
    // Fold chronologically: corrections replace one field; only an explicit new demand resets it.
    for (const text of [...history.map(turn => turn.message), message]) {
      if (/(重新开始|重新下单|新需求|再来一单|换一单|不找了|不玩了|不要发|先别发)/.test(text)) {
        for (const key of ["game", "mode", "duration", "budget", "startTime", "trial"] as const) facts[key] = undefined;
        facts.hasOrderContext = false;
      }
      if (this.handoffAnswer(text, []) || this.isOrderQuestion(text) || this.isPureConsultation(text)) continue;
      if (this.isDispatchIntent(text)) facts.hasOrderContext = true;
      const game = this.extractGame(text);
      if (game && facts.game && game !== facts.game) facts.mode = undefined;
      const values = { game, mode: this.extractMode(text), duration: this.extractDuration(text), budget: this.extractBudget(text), startTime: this.extractStartTime(text), trial: this.extractTrialPreference(text) };
      if (/(?:\d|[一二两三四五六七八九十])(?:个)?(?:半)?(?:小时|分钟|h)/i.test(text) && !values.duration) facts.duration = undefined;
      if (/\d{1,2}(?:点|[:：])/.test(text) && !values.startTime) facts.startTime = undefined;
      for (const key of Object.keys(values) as Array<keyof typeof values>) if (values[key]) facts[key] = values[key];
    }
    if (!facts.game) facts.missing.push("游戏");
    if (!facts.mode) facts.missing.push("模式");
    if (!facts.duration) facts.missing.push("预计时长");
    if (!facts.startTime || facts.startTime === "预约时间") facts.missing.push("开始时间（预约请给具体时间）");
    if (!facts.trial) facts.missing.push("是否先试音");
    facts.summary = this.buildDemandSummary(facts);
    return facts;
  }

  private withExplicitPublishDefaults(_message: string, facts: DemandFacts): DemandFacts {
    return facts;
  }

  private buildDemandSummary(facts: DemandFacts) {
    return [
      facts.game ? `游戏：${facts.game}` : undefined,
      facts.mode ? `模式：${facts.mode}` : undefined,
      facts.duration ? `时长：${facts.duration}` : undefined,
      facts.budget ? `预算：${facts.budget}` : "预算：按陪玩报价确认",
      facts.trial ? `试音：${facts.trial}` : undefined,
      facts.startTime ? `时间：${facts.startTime}` : undefined
    ]
      .filter(Boolean)
      .join("，");
  }

  private isExplicitDispatchPublish(message: string) {
    return /^(确认发布需求|确认发布招募|直接发布招募|发布招募|确认发布|确认，发布需求)[。！!]?$/u.test(message.replace(/\s+/g, ""));
  }

  private shouldPublishDispatchDraft(message: string, facts: DemandFacts) {
    return facts.missing.length === 0 && this.isExplicitDispatchPublish(message);
  }

  private buildDispatchPublishedReply(draftNo: string, facts: DemandFacts, notifications: Array<{ platform: BotPlatform; status: BotEventStatus; error?: string }>) {
    const sentPlatforms = notifications.filter((item) => item.status === BotEventStatus.SENT).map((item) => (item.platform === BotPlatform.DISCORD ? "Discord" : "KOOK"));
    const failedPlatforms = notifications
      .filter((item) => item.status !== BotEventStatus.SENT)
      .map((item) => `${item.platform === BotPlatform.DISCORD ? "Discord" : "KOOK"}${item.error ? `：${item.error}` : ""}`);

    if (sentPlatforms.length > 0) {
      return `已发布派单 ${draftNo} 到 ${sentPlatforms.join("、")} 派单频道。需求：${facts.summary}。陪玩报名后，客服会继续给你确认候选人和报价。`;
    }

    return `派单草稿 ${draftNo} 已生成，但暂时没有成功发到派单频道${failedPlatforms.length ? `（${failedPlatforms.join("、")} 通知失败）` : ""}。我已记录需求：${facts.summary}，请人工客服检查 Bot 频道权限或环境变量。`;
  }

  private buildDispatchCollectionReply(facts: DemandFacts) {
    if (!facts.missing.length) return `请核对：${facts.summary}。这里只发布需求，不是正式订单，也不会扣款；报价和总额尚未确定。信息没问题就回复“确认发布需求”。`;
    const known = [facts.game, facts.mode, facts.duration, facts.startTime, facts.trial ? `试音${facts.trial}` : undefined].filter(Boolean).join("、");
    return `${known ? `${known}，记下了。` : "可以。"}还需要${facts.missing.join("、")}，可以一次告诉我。预算不确定也没关系。`;
  }

  private extractGame(message: string) {
    const gameCode = this.extractGameCode(message);
    if (gameCode) return this.getGameName(gameCode);
    return undefined;
  }

  private extractGameCode(message: string) {
    const lower = message.toLowerCase();
    const games: Array<[RegExp, GameCode]> = [
      [/(三角洲行动|三角洲|delta force|df)/i, GameCode.DELTA_FORCE],
      [/(apex|apex legends|派派)/i, GameCode.APEX_LEGENDS],
      [/(无畏契约|瓦罗兰特|valorant|瓦\b)/i, GameCode.VALORANT],
      [/(英雄联盟|lol|联盟)/i, GameCode.LEAGUE_OF_LEGENDS],
      [/(pubg|绝地求生|吃鸡)/i, GameCode.PUBG],
      [/(永劫无间|永劫)/i, GameCode.NARAKA_BLADEPOINT],
      [/(cs2|counter-strike|反恐精英)/i, GameCode.COUNTER_STRIKE_2],
      [/(塔科夫|tarkov|cod|使命召唤|call of duty)/i, GameCode.CALL_OF_DUTY]
    ];

    return games.find(([pattern]) => pattern.test(lower))?.[1];
  }

  private extractMode(message: string) {
    const normalized = message.replace(/\s+/g, "");
    if (/(模式随意|模式不限|模式都行|模式任意|随便模式|模式无所谓|模式没要求)/.test(normalized)) return "随意";
    const explicit = normalized.match(/(?:模式|玩法)[:：]([^，。；,;\n]{1,20})/);
    if (explicit?.[1]) return explicit[1];
    if (/(烽火|摸金|撤离)/.test(normalized)) return "烽火地带";
    if (/全面战场/.test(normalized)) return "全面战场";
    if (/(排位|上分|天梯|rank)/i.test(normalized)) return "排位/上分";
    if (/(匹配|娱乐|休闲)/.test(normalized)) return "匹配/娱乐";
    return undefined;
  }

  private extractDuration(message: string) {
    const normalized = message.replace(/\s+/g, "");
    if (/半(?:个)?小时/.test(normalized) && !/[一二两三四五六七八九十\d]个?半/.test(normalized)) return "0.5小时";
    const match = [...normalized.matchAll(/(\d+(?:\.\d+)?|[一二两三四五六七八九十])(?:个)?(半)?(?:小时|h)/ig)].at(-1);
    const value = match ? Number(chineseNumberToDigit(match[1]) ?? match[1]) + (match[2] ? 0.5 : 0) : NaN;
    if (Number.isFinite(value) && value > 0 && value <= 24) return `${value}小时`;
    const minutes = normalized.match(/(\d+)分钟/);
    if (minutes && Number(minutes[1]) > 0 && Number(minutes[1]) <= 1440) return `${Number((Number(minutes[1]) / 60).toFixed(2))}小时`;
    return undefined;
  }

  private extractBudget(message: string) {
    if (/(预算不确定|没预算|没有预算|预算随意|预算无所谓|按报价|看报价|报价确认)/.test(message)) return "按陪玩报价确认";
    const money = message.match(/(?:预算|不超过)\s*[:：]?\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)(?![\d.])/) ?? message.match(/(\d+(?:\.\d{1,2})?)(?:元|块)以内/);
    return money ? `¥${money[1]}` : undefined;
  }

  private extractStartTime(message: string) {
    const normalized = message.replace(/\s+/g, "");
    const time = normalized.match(/((?:今天|今晚|明天|后天)?(?:上午|下午|晚上)?)(\d{1,2})(?:点|[:：])(\d{1,2}|半)?/);
    if (time && Number(time[2]) < 24 && (time[3] === "半" || Number(time[3] ?? 0) < 60)) return `${time[1]}${time[2]}点${time[3] ?? ""}`;
    if (/(现在|马上|立刻|这会儿)/.test(normalized)) return "现在开始";
    if (/(今晚|晚上|明天|后天|预约|预定)/.test(normalized)) return "预约时间";
    return undefined;
  }

  private extractTrialPreference(message: string) {
    if (/(不用|不要|不需要|不想|不)试音/.test(message)) return "不需要";
    if (/(试音|声音|语音).*(无所谓|都行|随意)/.test(message)) return "无所谓";
    if (/(试音|听声音|语音看看)/.test(message)) return "需要";
    return undefined;
  }

  private isCompanionCountQuestion(message: string) {
    return (
      /(多少|几位|几个|人数|数量|规模|多吗|有多少|目前有|现在有)/i.test(message) &&
      /(陪玩|陪练|公会|工会|俱乐部|club|成员|人)/i.test(message)
    );
  }

  private isCatalogQuestion(message: string) {
    const normalized = message.replace(/\s+/g, "");
    return (
      /(有什么游戏|有哪些游戏|支持哪些游戏|支持什么游戏|能打什么游戏|能接什么游戏|游戏列表|游戏都有|都有什么游戏|都能玩什么|有什么项目|有哪些项目)/i.test(
        normalized
      ) ||
      (/(游戏|项目|品类)/i.test(normalized) && /(有什么|有哪些|支持|能打|能接|列表|都有|什么)/i.test(normalized))
    );
  }

  private isPriceQuestion(message: string) {
    const normalized = message.replace(/\s+/g, "").replace(/(按陪玩报价确认|按报价|看报价|报价确认|价格随意|价格无所谓)/g, "");
    return /(价格|多少钱|怎么收费|收费|报价|单价|费用|价位|没说价格|没说价)/i.test(normalized);
  }

  private isPureConsultation(message: string) {
    return this.isCatalogQuestion(message) || this.isPriceQuestion(message) || this.isCompanionCountQuestion(message) || /(怎么下单|如何下单|怎么试音|如何试音)/.test(message);
  }

  private hasExplicitDispatchAction(message: string) {
    const normalized = message.replace(/\s+/g, "");
    return /(找陪玩|找陪练|下单|派单|预约|试音|上分|带我|陪打|陪练|来个|安排|找人|接单|发布招募|直接发|开始招募|发派单|我要.*(陪玩|陪练|下单|找人|找个|来个|安排|试音|接单|打)|我想.*(找|下单|陪玩|陪练|试音|上分|接单)|帮我.*(找|安排|派单|下单))/i.test(
      normalized
    );
  }

  private isPersonalSettingsQuestion(message: string) {
    return /(个人设置|账号设置|账户设置|资料设置|我的设置|设置在哪|哪里.*设置|怎么.*设置|绑定账号|绑定.*kook|绑定.*discord|改资料|修改资料)/i.test(message);
  }

  private matchShortGameName(message: string) {
    const value = message.trim().toLowerCase();
    if (/^(瓦|瓦罗兰特|无畏契约|valorant|val)$/.test(value)) return "无畏契约";
    if (/^(lol|联盟|英雄联盟)$/.test(value)) return "英雄联盟";
    if (/^(三角洲|三角洲行动|delta force|df)$/.test(value)) return "三角洲行动";
    if (/^(吃鸡|绝地求生|pubg)$/.test(value)) return "PUBG 绝地求生";
    if (/^(永劫|永劫无间)$/.test(value)) return "永劫无间";
    if (/^(塔科夫|tarkov|cod|使命召唤)$/.test(value)) return "塔科夫 / COD";
    return null;
  }

  private async buildGameCatalogAnswer() {
    const profiles = await this.prisma.companionProfile.findMany({
      where: {
        status: CompanionProfileStatus.LISTED,
        user: { is: { status: UserStatus.ACTIVE } }
      },
      select: { game: true, games: true }
    });
    const listedCodes = new Set<GameCode>();
    for (const profile of profiles) {
      if (SUPPORTED_PRICE_LIST_GAME_SET.has(profile.game)) listedCodes.add(profile.game);
      for (const game of profile.games) {
        if (SUPPORTED_PRICE_LIST_GAME_SET.has(game)) listedCodes.add(game);
      }
    }
    const listedNames = [...listedCodes].map((code) => this.getGameName(code)).filter(Boolean);
    if (!listedNames.length) return "暂时没有查到已上架陪玩的游戏范围。当前自动需求流程支持三角洲行动，实际是否有人能接仍需人工核对。";
    return `已上架资料中登记了：${listedNames.slice(0, 8).join("、")}。登记不代表现在能接单，当前自动需求流程支持三角洲行动。`;
  }

  private async buildPricingAnswer(message: string) {
    const gameCode = this.extractGameCode(message);
    if (!gameCode) return "价格要按游戏、陪玩和服务类型核对。你想问哪个游戏？";
    const profiles = await this.prisma.companionProfile.findMany({ where: {
      status: CompanionProfileStatus.LISTED, user: { is: { status: UserStatus.ACTIVE } }, OR: [{ game: gameCode }, { games: { has: gameCode } }]
    }, select: { pricePerHour: true }, take: 50 });
    const prices = profiles.map(profile => Number(profile.pricePerHour)).filter(price => Number.isFinite(price) && price > 0);
    if (!prices.length) return `${this.getGameName(gameCode)}暂时没有查到可核实的上架报价。请让人工客服确认；试音是否收费、优惠和最终总额也要一起核对。`;
    const low = Math.min(...prices).toFixed(2), high = Math.max(...prices).toFixed(2);
    return `${this.getGameName(gameCode)}查到的上架基础价是 ¥${low}${low === high ? "" : `—${high}`}/时。平台和服务类型可能影响报价，这不是最终订单价；确定陪玩、时长后再核对单价、优惠和总额。`;
  }

  private buildAiBusinessContextHint(message: string) {
    if (this.isCatalogQuestion(message)) {
      return "当前用户在问平台有哪些游戏。请直接回答游戏范围，不要要求用户补齐下单字段。";
    }
    if (this.isPriceQuestion(message)) {
      return "当前用户在问陪玩价格。请直接说明价格按陪玩、游戏、平台和时长不同，最终以后台订单和客服确认为准；不要把回答变成下单表单。";
    }
    if (this.isCompanionCountQuestion(message)) {
      return "当前用户在问陪玩数量。请直接回答数量口径，不要强行进入下单流程。";
    }
    return undefined;
  }

  private getGameName(code: GameCode | string) {
    return GAME_NAME_BY_CODE[code as GameCode] ?? code;
  }

  private buildContextualFallback(_message: string) {
    return "这句我还没确定你的意思。你是想继续刚才的需求，还是查一笔订单？";
  }

  private async findServiceAdmin() {
    return this.prisma.user.findFirst({
      where: {
        status: UserStatus.ACTIVE,
        role: { in: [UserRole.SUPER_ADMIN, UserRole.ADMIN] }
      },
      orderBy: [{ role: "desc" }, { createdAt: "asc" }],
      select: { id: true }
    });
  }

  private normalizeMessage(message: string) {
    const value = message.replace(/<@!?\d+>/g, "").trim();
    if (!value) throw new BadRequestException("message is required");
    if (value.length > 1000) throw new BadRequestException("message is too long");
    return value;
  }
}

function chineseNumberToDigit(value: string) {
  const map: Record<string, string> = {
    一: "1",
    二: "2",
    两: "2",
    三: "3",
    四: "4",
    五: "5",
    六: "6",
    七: "7",
    八: "8",
    九: "9",
    十: "10"
  };
  return map[value];
}

function sanitizePlatformDisplayName(displayName?: string) {
  const normalized = displayName?.normalize("NFKC").trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, 32) : undefined;
}

function buildPlatformCustomerEmail(platform: BotPlatform, externalUserId: string) {
  const platformKey = platform === BotPlatform.KOOK ? "kook" : "discord";
  return `customer-${platformKey}-${externalUserId}@platform.maycatplay.local`.toLowerCase();
}

function isValidPlatformUserId(platform: BotPlatform, value: string) {
  if (platform === BotPlatform.KOOK) return /^\d{6,}$/.test(value);
  if (platform === BotPlatform.DISCORD) return /^\d{15,22}$/.test(value);
  return false;
}

function formatKookPlatformDisplayName(user: { nickname?: string; username?: string; identify_num?: string }) {
  const name = sanitizePlatformDisplayName(user.nickname || user.username);
  const identifyNum = sanitizePlatformDisplayName(user.identify_num);
  if (name && identifyNum) return `${name}#${identifyNum}`;
  return name;
}

function isSyntheticPlatformCustomer(user: { role: UserRole; email: string }, platform: BotPlatform) {
  const platformKey = platform === BotPlatform.KOOK ? "kook" : "discord";
  return (
    user.role === UserRole.CUSTOMER &&
    user.email.toLowerCase().startsWith(`customer-${platformKey}-`) &&
    user.email.toLowerCase().endsWith("@platform.maycatplay.local")
  );
}

async function generateUniqueReferralCode(tx: Prisma.TransactionClient, prefix: string) {
  for (let index = 0; index < 20; index += 1) {
    const code = `${prefix}${randomInt(100000, 999999)}`;
    const existing = await tx.user.findUnique({
      where: { referralCode: code },
      select: { id: true }
    });
    if (!existing) return code;
  }
  return `${prefix}${randomBytes(4).toString("hex").toUpperCase()}`;
}
