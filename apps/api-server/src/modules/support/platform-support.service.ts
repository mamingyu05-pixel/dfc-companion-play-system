import { BadRequestException, Injectable } from "@nestjs/common";
import { BotPlatform, OrderSourcePlatform, UserRole, UserStatus } from "@prisma/client";
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
    topic: "充值未到账",
    keywords: ["充值", "到账", "余额", "转账", "加钱", "未到账", "审核", "截图", "人工加余额"],
    answer:
      "充值目前是人工审核。请在充值页提交金额、转账截图和备注，管理员核对后余额才会入账。金额填错、截图不清楚、优惠码不确定时，请先联系人工客服确认。",
    handoffRequired: true
  },
  {
    topic: "找陪玩",
    keywords: ["找陪玩", "下单", "派单", "预约", "试音", "上分", "带我", "陪打", "陪练", "来个", "安排"],
    answer:
      "可以，我先帮你记录需求。请补充：游戏、模式、预计时长、预算、是否要试音、语音偏好、希望什么时候开始。确认后客服会安排候选陪玩给你选择。",
    handoffRequired: true
  },
  {
    topic: "试音选人",
    keywords: ["试音", "语音", "频道", "听声音", "选人", "人工派单"],
    answer:
      "如果你想先试音选人，客服会把需求整理成试音派单，让有空的陪玩报名，再把候选人发给你挑选。确认陪玩后才会转成正式订单。",
    handoffRequired: true
  },
  {
    topic: "退款投诉",
    keywords: ["退款", "投诉", "不满意", "纠纷", "取消", "退钱", "售后"],
    answer:
      "退款和投诉必须人工处理。请提供订单号、陪玩昵称、问题说明和截图/录屏。平台会保留订单日志、派单记录和钱包流水，处理完成后后台会记录结果。",
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

export const DEFAULT_SUPPORT_SUGGESTIONS = ["充值未到账", "如何下单", "试音选人", "退款投诉", "陪玩入驻"];

@Injectable()
export class PlatformSupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderDrafts: OrderDraftsService
  ) {}

  async autoReplyForWeb(userId: string, message: string) {
    const result = await this.resolveSupportAnswer(message);
    await this.prisma.aiSupportConversation.create({
      data: {
        userId,
        message: this.normalizeMessage(message),
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
    const account = await this.prisma.userExternalAccount.findUnique({
      where: {
        platform_externalUserId: {
          platform: input.platform,
          externalUserId: input.platformUserId
        }
      },
      include: { user: true }
    });

    const result = await this.resolveSupportAnswer(message);
    const dispatchIntent = this.isDispatchIntent(message);
    let finalAnswer = result.answer;
    let draft: { id: string; draftNo: string } | null = null;

    if (dispatchIntent) {
      const dispatchResult = await this.maybeCreateDispatchDraft(input, account?.userId ?? undefined, message);
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

  private async maybeCreateDispatchDraft(input: PlatformSupportMessage, customerId: string | undefined, message: string) {
    if (process.env.AI_AUTO_DISPATCH_ENABLED !== "true") {
      return {
        draft: null,
        reply:
          "我已记录你的陪玩需求。请继续补充游戏、模式、时长、预算和语音偏好；人工客服确认后会安排试音或派单。"
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
      demandText: message
    });

    return {
      draft: { id: result.draft.id, draftNo: result.draft.draftNo },
      reply: `已为你生成试音派单 ${result.draft.draftNo}，系统会通知陪玩频道报名。稍后客服会把候选陪玩发给你选择；充值、退款和余额问题仍由人工客服确认。`
    };
  }

  private async resolveSupportAnswer(message: string): Promise<SupportResult> {
    const normalized = this.normalizeMessage(message).toLowerCase();
    const matched = SUPPORT_RULES.find((rule) => rule.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())));
    if (matched) {
      return {
        matchedTopic: matched.topic,
        answer: matched.answer,
        handoffRequired: Boolean(matched.handoffRequired)
      };
    }

    const aiAnswer = await this.tryOpenAiSupportAnswer(message);
    if (aiAnswer) {
      return {
        matchedTopic: "AI客服",
        answer: aiAnswer,
        handoffRequired: false
      };
    }

    return {
      matchedTopic: "转人工",
      answer:
        "这个问题需要人工确认。请把账号邮箱、订单号、充值截图或具体需求发给客服；如果是试音选人、退款投诉、充值异常，客服会在 KOOK、Discord 或 VX 继续处理。",
      handoffRequired: true
    };
  }

  private async tryOpenAiSupportAnswer(message: string) {
    const enabled = process.env.AI_SUPPORT_ENABLED === "true";
    const apiKey = process.env.OPENAI_API_KEY;
    if (!enabled || !apiKey) return null;

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: process.env.AI_SUPPORT_MODEL || "gpt-4o-mini",
          max_output_tokens: 260,
          input: [
            {
              role: "developer",
              content:
                "你是 May猫饼电竞陪玩俱乐部客服。只回答平台流程、下单、试音、充值说明、账号绑定、陪玩入驻、提现规则、优惠说明。涉及余额修改、退款、提现完成、封号、投诉结论、订单强制改价时必须提示转人工，不能承诺已经处理。回答要中文、简洁、可靠，提醒用户不要泄露验证码、密码、后台 Token。"
            },
            {
              role: "user",
              content: message
            }
          ]
        })
      });
      if (!response.ok) return null;
      const data = (await response.json()) as {
        output_text?: string;
        output?: Array<{ content?: Array<{ text?: string }> }>;
      };
      return (
        data.output_text?.trim() ||
        data.output
          ?.flatMap((item) => item.content ?? [])
          .map((item) => item.text)
          .filter(Boolean)
          .join("\n")
          .trim() ||
        null
      );
    } catch {
      return null;
    }
  }

  private isDispatchIntent(message: string) {
    return /(找陪玩|下单|派单|预约|试音|上分|带我|陪打|陪练|来个|安排|want.*play|need.*companion|boost|rank)/i.test(message);
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
