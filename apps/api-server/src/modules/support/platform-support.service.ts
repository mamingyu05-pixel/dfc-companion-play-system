import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { BotEventStatus, BotPlatform, CompanionProfileStatus, OrderSourcePlatform, UserRole, UserStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { OrderDraftsService } from "../orders/order-drafts.service";

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

const SUPPORT_RULES: SupportRule[] = [
  {
    topic: "问候",
    keywords: ["你好", "您好", "在吗", "有人吗", "hi", "hello", "hey", "客服在吗"],
    answer:
      "你好，这里是 May猫饼电竞客服。我可以帮你处理找陪玩、试音选人、充值说明、优惠码、退款投诉和陪玩入驻。你可以直接说需求，比如：想找陪玩、充值没到账、想先试音。"
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
      "可以先试音选人。流程是：你说需求 -> 客服整理派单 -> 有空的陪玩报名 -> 客服把候选人发给你 -> 你确认后再转正式订单。"
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
      "平台支持首充赠送、老带新、陪玩带客奖励、优惠码和充值码。具体能否使用、是否已使用、奖励金额，以后台活动配置和人工客服确认结果为准。"
  },
  {
    topic: "人工客服",
    keywords: ["人工", "客服", "微信", "vx", "联系", "二维码"],
    answer:
      "你可以通过充值页的 VX 二维码、KOOK 客服入口或 Discord 客服入口联系人工客服。请不要把后台 Token、验证码、密码发给任何人。"
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

@Injectable()
export class PlatformSupportService {
  private readonly logger = new Logger(PlatformSupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderDrafts: OrderDraftsService
  ) {}

  async autoReplyForWeb(userId: string, message: string) {
    const normalizedMessage = this.normalizeMessage(message);
    const history = await this.loadConversationHistory({ userId });
    const result = await this.resolveSupportAnswer(normalizedMessage, history);
    await this.prisma.aiSupportConversation.create({
      data: {
        userId,
        message: normalizedMessage,
        answer: result.answer,
        matchedTopic: result.matchedTopic,
        handoffRequired: result.handoffRequired
      }
    });

    return {
      answer: result.answer,
      matchedTopic: result.matchedTopic,
      handoffRequired: result.handoffRequired,
      suggestions: DEFAULT_SUPPORT_SUGGESTIONS
    };
  }

  async handlePlatformMessage(input: PlatformSupportMessage) {
    const message = this.normalizeMessage(input.content);
    const duplicate = await this.findDuplicatePlatformMessage(input, message);
    if (duplicate) {
      return {
        conversationId: duplicate.id,
        reply: "",
        matchedTopic: duplicate.matchedTopic ?? "duplicate",
        handoffRequired: duplicate.handoffRequired,
        draft: null,
        duplicate: true
      };
    }

    const account = await this.prisma.userExternalAccount.findUnique({
      where: {
        platform_externalUserId: {
          platform: input.platform,
          externalUserId: input.platformUserId
        }
      },
      include: { user: true }
    });

    const history = await this.loadConversationHistory({
      userId: account?.userId,
      platform: input.platform,
      platformUserId: input.platformUserId
    });
    const result = await this.resolveSupportAnswer(message, history);
    const dispatchIntent = this.isDispatchIntent(message) || this.isDemandContinuation(message, history);
    const customerId = account?.user?.role === UserRole.CUSTOMER && account.user.status === UserStatus.ACTIVE ? account.userId : undefined;
    let finalAnswer = result.answer;
    let draft: { id: string; draftNo: string } | null = null;

    if (dispatchIntent) {
      const facts = this.withExplicitPublishDefaults(message, this.buildDemandFacts(message, history));
      const dispatchResult = await this.maybeCreateDispatchDraft(input, customerId, message, facts);
      draft = dispatchResult.draft;
      finalAnswer = dispatchResult.reply;
    }

    const conversation = await this.prisma.aiSupportConversation.create({
      data: {
        userId: account?.userId,
        platform: input.platform,
        platformUserId: input.platformUserId,
        platformGuildId: input.guildId,
        platformChannelId: input.channelId,
        platformMessageId: input.messageId,
        message,
        answer: finalAnswer,
        matchedTopic: dispatchIntent ? "找陪玩" : result.matchedTopic,
        handoffRequired: dispatchIntent || result.handoffRequired
      }
    });

    return {
      conversationId: conversation.id,
      reply: finalAnswer,
      matchedTopic: dispatchIntent ? "找陪玩" : result.matchedTopic,
      handoffRequired: dispatchIntent || result.handoffRequired,
      draft
    };
  }

  async markReplyMessage(conversationId: string, replyMessageId?: string) {
    if (!replyMessageId) return;
    await this.prisma.aiSupportConversation.update({
      where: { id: conversationId },
      data: { replyMessageId }
    });
  }

  private async maybeCreateDispatchDraft(input: PlatformSupportMessage, customerId: string | undefined, message: string, facts: DemandFacts) {
    const shouldPublish = process.env.AI_AUTO_DISPATCH_ENABLED === "true" || this.shouldPublishDispatchDraft(message, facts);
    if (!shouldPublish) {
      return {
        draft: null,
        reply: this.buildDispatchCollectionReply(facts)
      };
    }

    if (!facts.game || !facts.duration) {
      return {
        draft: null,
        reply: this.buildDispatchCollectionReply(facts)
      };
    }

    const serviceAdmin = await this.findServiceAdmin();
    if (!serviceAdmin) {
      return {
        draft: null,
        reply: "我已记录你的需求，但后台暂时没有可用管理员账号。请人工客服先处理这条派单。"
      };
    }

    const sourcePlatform = input.platform === BotPlatform.DISCORD ? OrderSourcePlatform.DISCORD : OrderSourcePlatform.KOOK;
    const result = await this.orderDrafts.createDraftFromDemand(serviceAdmin.id, {
      customerId,
      sourcePlatform,
      customerPlatformUserId: input.platformUserId,
      customerDisplayName: input.displayName,
      sourceGuildId: input.guildId,
      sourceChannelId: input.channelId,
      sourceMessageId: input.messageId,
      demandText: facts.summary || message
    });

    return {
      draft: { id: result.draft.id, draftNo: result.draft.draftNo },
      reply: this.buildDispatchPublishedReply(result.draft.draftNo, facts, result.notifications)
    };
  }

  private async resolveSupportAnswer(message: string, history: SupportHistoryTurn[] = []): Promise<SupportResult> {
    const normalized = this.normalizeMessage(message).toLowerCase();

    const dynamicAnswer = await this.tryDynamicBusinessAnswer(normalized);
    if (dynamicAnswer) return dynamicAnswer;

    const matched = SUPPORT_RULES.find((rule) => rule.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())));

    if (matched?.handoffRequired) {
      return {
        matchedTopic: matched.topic,
        answer: matched.answer,
        handoffRequired: true
      };
    }

    const aiAnswer = await this.tryOpenAiSupportAnswer(message, history, matched?.answer);
    if (aiAnswer) {
      return {
        matchedTopic: matched?.topic ?? "AI客服",
        answer: aiAnswer,
        handoffRequired: false
      };
    }

    if (matched) {
      return {
        matchedTopic: matched.topic,
        answer: matched.answer,
        handoffRequired: false
      };
    }

    return {
      matchedTopic: "继续确认",
      answer: this.buildContextualFallback(message),
      handoffRequired: false
    };
  }

  private async tryDynamicBusinessAnswer(message: string): Promise<SupportResult | null> {
    if (this.isPersonalSettingsQuestion(message)) {
      return {
        matchedTopic: "个人设置",
        answer: "网站端个人设置在顶部导航或手机底部的“设置”，也可以直接打开 /customer/settings。里面能看账号、邀请码、钱包、KOOK/Discord 绑定和客服入口。",
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

    if (/(你能干什么|能做什么|怎么用|如何使用|你是谁|客服能干嘛)/i.test(message)) {
      return {
        matchedTopic: "客服能力",
        answer:
          "我可以先帮你处理找陪玩、试音选人、充值说明、优惠码、订单问题、投诉退款和陪玩入驻咨询。涉及加余额、退款结论、提现完成这类要改后台数据的事，我会提醒转人工处理。你可以直接像聊天一样说需求，不用按固定格式发。",
        handoffRequired: false
      };
    }

    return null;
  }

  private async findDuplicatePlatformMessage(input: PlatformSupportMessage, message: string) {
    if (input.messageId) {
      const existing = await this.prisma.aiSupportConversation.findFirst({
        where: {
          platform: input.platform,
          platformMessageId: input.messageId
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, matchedTopic: true, handoffRequired: true }
      });
      if (existing) return existing;
    }

    const recentSameMessage = await this.prisma.aiSupportConversation.findFirst({
      where: {
        platform: input.platform,
        platformUserId: input.platformUserId,
        platformChannelId: input.channelId,
        message,
        createdAt: { gte: new Date(Date.now() - 8000) }
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, matchedTopic: true, handoffRequired: true }
    });

    return recentSameMessage;
  }

  private async tryOpenAiSupportAnswer(message: string, history: SupportHistoryTurn[] = [], fallbackHint?: string) {
    const enabled = process.env.AI_SUPPORT_ENABLED === "true";
    const apiKey = process.env.AI_SUPPORT_API_KEY || process.env.OPENAI_API_KEY;
    if (!enabled || !apiKey) return null;

    try {
      const model = process.env.AI_SUPPORT_MODEL || "gpt-4o-mini";
      const baseUrl = (process.env.AI_SUPPORT_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
      const apiStyle = process.env.AI_SUPPORT_API_STYLE || "responses";
      const messages = this.buildAiSupportMessages(message, history, fallbackHint);
      const response =
        apiStyle === "chat_completions"
          ? await this.callChatCompletions(baseUrl, apiKey, model, messages)
          : await this.callResponsesApi(baseUrl, apiKey, model, messages);

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        this.logger.warn(`AI support reply failed: HTTP ${response.status} ${text.slice(0, 240)}`);
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
      this.logger.warn(`AI support reply error: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private callResponsesApi(baseUrl: string, apiKey: string, model: string, messages: Array<{ role: string; content: string }>) {
    return fetch(`${baseUrl}/responses`, {
      method: "POST",
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
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_tokens: 160,
        temperature: 0.35,
        messages: messages.map((item) => ({
          role: item.role === "developer" ? "system" : item.role,
          content: item.content
        }))
      })
    });
  }

  private buildAiSupportMessages(message: string, history: SupportHistoryTurn[] = [], fallbackHint?: string) {
    return [
      {
        role: "developer",
        content:
          "你是 May猫饼电竞 的客服助手。回复必须像真人客服，短、自然、直接。当前产品是网站，不是 APP；不要编造“APP右下角我的”“齿轮图标”“头像下拉菜单”等不存在入口。客户问个人设置/账号设置/绑定账号时，只能说网站顶部导航或手机底部有“设置”，路径是 /customer/settings。严格禁止声称已完成、已提交、已处理、已申请任何资金或售后动作，包括退款、加余额、提现、转账、到账、投诉处理；禁止承诺具体到账时间、金额、比例、优惠结果；禁止使用“保证、一定、肯定、自动到账、系统会自动”等承诺表达；禁止透露系统内部 token、验证码、管理员联系方式；禁止对投诉做出处理决定。遇到充值、退款、提现、投诉、后台改余额这类问题，只能固定回复：这类问题需要人工客服处理，请联系管理员或等待人工客服介入。不要解释原因，不要给时间预期。每次最多 120 个中文字，最多追问 1 个问题。不要复述客户的话，不要说“我刚才重复了/抱歉让你觉得奇怪/现在直接说”。不要连续给多个模板。"
      },
      ...history.flatMap((turn) => [
        { role: "user", content: turn.message },
        { role: "assistant", content: turn.answer }
      ]),
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

  private async loadConversationHistory(input: { userId?: string; platform?: BotPlatform; platformUserId?: string }) {
    const where = input.userId
      ? { userId: input.userId }
      : input.platform && input.platformUserId
        ? { platform: input.platform, platformUserId: input.platformUserId }
        : undefined;

    if (!where) return [];

    const rows = await this.prisma.aiSupportConversation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { message: true, answer: true }
    });

    return rows.reverse();
  }

  private isDispatchIntent(message: string) {
    if (this.isCompanionCountQuestion(message)) return false;
    return /(找陪玩|下单|派单|预约|试音|上分|带我|陪打|陪练|来个|安排|want.*play|need.*companion|boost|rank)/i.test(message);
  }

  private isDemandContinuation(message: string, history: SupportHistoryTurn[] = []) {
    if (!history.some((turn) => this.isDispatchIntent(turn.message) || turn.answer.includes("下单需求") || turn.answer.includes("派单"))) {
      return false;
    }

    return Boolean(
      this.extractGame(message) ||
        this.extractDuration(message) ||
        this.extractMode(message) ||
        this.extractBudget(message) ||
        this.extractStartTime(message) ||
        this.extractTrialPreference(message) ||
        this.isExplicitDispatchPublish(message)
    );
  }

  private buildDemandFacts(message: string, history: SupportHistoryTurn[] = []): DemandFacts {
    const messages = [...history.map((turn) => turn.message), message].map((item) => this.normalizeMessage(item));
    const combined = messages.join("，");
    const facts = {
      hasOrderContext: messages.some((item) => this.isDispatchIntent(item)),
      game: this.extractGame(combined),
      mode: this.extractMode(combined),
      duration: this.extractDuration(combined),
      budget: this.extractBudget(combined),
      startTime: this.extractStartTime(combined),
      trial: this.extractTrialPreference(combined)
    };

    const missing: string[] = [];
    if (!facts.game) missing.push("游戏");
    if (!facts.mode) missing.push("模式");
    if (!facts.duration) missing.push("预计时长");
    if (!facts.trial) missing.push("是否试音");
    if (!facts.startTime) missing.push("现在开始还是预约");

    const summary = [
      facts.game ? `游戏：${facts.game}` : undefined,
      facts.mode ? `模式：${facts.mode}` : undefined,
      facts.duration ? `时长：${facts.duration}` : undefined,
      facts.budget ? `预算：${facts.budget}` : "预算：按陪玩报价确认",
      facts.trial ? `试音：${facts.trial}` : undefined,
      facts.startTime ? `时间：${facts.startTime}` : undefined
    ]
      .filter(Boolean)
      .join("，");

    return { ...facts, missing, summary };
  }

  private withExplicitPublishDefaults(message: string, facts: DemandFacts): DemandFacts {
    if (!this.isExplicitDispatchPublish(message)) return facts;

    const next: DemandFacts = {
      ...facts,
      mode: facts.mode ?? "随意",
      trial: facts.trial ?? (/(不用|不要|不需要|免试|直接)/i.test(message) ? "不需要" : "待确认"),
      startTime: facts.startTime ?? "现在/待确认"
    };
    next.missing = [];
    if (!next.game) next.missing.push("游戏");
    if (!next.duration) next.missing.push("预计时长");
    next.summary = this.buildDemandSummary(next);
    return next;
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
    const normalized = message.replace(/\s+/g, "");
    return /^(开始|发布|发吧|可以发|直接发|确认发|派吧)$/.test(normalized) || /(发布招募|发招募|直接招募|开始招募|直接发布|派单吧|直接派单|发派单|发布派单|发到派单|推到派单)/i.test(normalized);
  }

  private shouldPublishDispatchDraft(message: string, facts: DemandFacts) {
    return facts.missing.length === 0 || (this.isExplicitDispatchPublish(message) && Boolean(facts.game && facts.duration));
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
    if (facts.missing.length === 0) {
      return `收到，需求够了：${facts.summary}。你可以回复“直接发布招募”，我会发到派单频道；价格以候选陪玩报价和后台订单为准。`;
    }

    if (facts.game && facts.duration && facts.mode) {
      const nextQuestion = facts.missing.includes("是否试音") ? "要不要先试音？" : `还差：${facts.missing.slice(0, 2).join("、")}。`;
      return `收到，先记下：${facts.summary}。${nextQuestion}`;
    }

    const ask = facts.missing.slice(0, 3).join("、");
    return `可以，我先帮你记录下单需求。${facts.summary ? `已记下：${facts.summary}。` : ""}还差：${ask}。预算不确定也没关系，可以按陪玩报价确认。`;
  }

  private extractGame(message: string) {
    const lower = message.toLowerCase();
    const games: Array<[RegExp, string]> = [
      [/(三角洲行动|三角洲|delta force|df)/i, "三角洲行动"],
      [/(apex|apex legends|派派)/i, "Apex Legends"],
      [/(无畏契约|瓦罗兰特|valorant|瓦\b)/i, "无畏契约"],
      [/(英雄联盟|lol|联盟)/i, "英雄联盟"],
      [/(王者荣耀|王者)/i, "王者荣耀"],
      [/(和平精英|pubg mobile)/i, "和平精英"],
      [/(pubg|绝地求生|吃鸡)/i, "PUBG"],
      [/(永劫无间|永劫)/i, "永劫无间"],
      [/(cs2|counter-strike|反恐精英)/i, "CS2"],
      [/(dota2|dota)/i, "DOTA 2"],
      [/(我的世界|minecraft)/i, "Minecraft"],
      [/(原神|genshin)/i, "原神"]
    ];

    return games.find(([pattern]) => pattern.test(lower))?.[1];
  }

  private extractMode(message: string) {
    const normalized = message.replace(/\s+/g, "");
    if (/(模式随意|模式不限|模式都行|模式任意|随便模式|模式无所谓|模式没要求|没有模式|没模式|无模式)/i.test(normalized)) return "随意";
    const explicit = normalized.match(/(?:模式|玩法)[:：]?([\u4e00-\u9fa5A-Za-z0-9]{1,12})/i);
    if (explicit?.[1] && !/(随便|随意|不限|都行|任意|无所谓)/i.test(explicit[1])) return explicit[1];
    if (/(排位|排位赛|上分|天梯|rank)/i.test(normalized)) return "排位/上分";
    if (/(匹配|娱乐|休闲|快速|普通)/i.test(normalized)) return "匹配/娱乐";
    return undefined;
  }

  private extractDuration(message: string) {
    const normalized = message.replace(/\s+/g, "");
    const match = normalized.match(/(\d+(?:\.\d+)?)(?:个)?(?:小时|h|H)/);
    if (match?.[1]) return `${match[1]}小时`;
    const chineseHour = normalized.match(/([一二两三四五六七八九十])(?:个)?小时/);
    const number = chineseHour?.[1] ? chineseNumberToDigit(chineseHour[1]) : undefined;
    return number ? `${number}小时` : undefined;
  }

  private extractBudget(message: string) {
    const normalized = message.replace(/\s+/g, "");
    if (/(预算不确定|没预算|没有预算|预算随意|预算无所谓|价格随意|客服报价|按报价|看报价|报价确认)/i.test(normalized)) {
      return "按陪玩报价确认";
    }
    const money = normalized.match(/(?:预算|价格|价位|费用)?(?:¥|￥)?(\d{2,5})(?:元|块)?/);
    return money?.[1] ? `¥${money[1]}` : undefined;
  }

  private extractStartTime(message: string) {
    const normalized = message.replace(/\s+/g, "");
    if (/^(开始|现在开始)$/.test(normalized) || /(现在|马上|立刻|直接开始|现在开始|这会儿)/i.test(normalized)) return "现在开始";
    if (/(今晚|晚上)/i.test(normalized)) return "今晚/晚上";
    if (/(明天|后天|预约|预定|约)/i.test(normalized)) return "预约时间";
    const time = normalized.match(/(\d{1,2})[点:：](\d{2})?/);
    return time ? `${time[1]}点${time[2] ?? ""}` : undefined;
  }

  private extractTrialPreference(message: string) {
    const normalized = message.replace(/\s+/g, "");
    if (/(不用试音|不要试音|不试音|直接下单)/i.test(normalized)) return "不需要";
    if (/(要试音|先试音|试音|听声音|语音看看)/i.test(normalized)) return "需要";
    if (/(无所谓|都行|随意)/i.test(normalized) && /(声音|语音|试音)/i.test(normalized)) return "无所谓";
    return undefined;
  }

  private isCompanionCountQuestion(message: string) {
    return (
      /(多少|几位|几个|人数|数量|规模|多吗|有多少|目前有|现在有)/i.test(message) &&
      /(陪玩|陪练|公会|工会|俱乐部|club|成员|人)/i.test(message)
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
    if (/^(王者|王者荣耀)$/.test(value)) return "王者荣耀";
    if (/^(吃鸡|和平精英|pubg)$/.test(value)) return "和平精英/PUBG";
    if (/^(永劫|永劫无间)$/.test(value)) return "永劫无间";
    return null;
  }

  private buildContextualFallback(message: string) {
    const normalized = message.toLowerCase();

    if (/(吗|么|多少|怎么|如何|什么|啥|？|\?)/.test(normalized)) {
      return "这个问题我先按客服口径回答：我现在没有足够信息给你下最终结论，但可以继续帮你判断。你可以直接把具体问题说完整一点，比如是问价格、陪玩数量、充值、订单、试音还是入驻，我会按对应流程回复；需要改余额或处理售后的地方会转人工。";
    }

    if (/(想|要|需要|找|来|安排|下单|陪玩|陪练|试音)/i.test(normalized)) {
      return "可以，我先理解成你有找陪玩或试音需求。你不用填表，直接告诉我游戏、模式、大概什么时候玩、想男声女声还是无所谓，我会继续帮你整理给人工派单。";
    }

    return "收到。我会按 May猫饼客服流程继续跟进。你可以直接补充下一句，不用按模板发；如果涉及充值、退款、提现、投诉或后台改余额，我会提醒你转人工确认。";
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
