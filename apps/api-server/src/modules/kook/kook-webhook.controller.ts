import { BadRequestException, Body, Controller, HttpCode, Post, UnauthorizedException, UseGuards } from "@nestjs/common";
import { createDecipheriv } from "node:crypto";
import { BotEventStatus, BotPlatform, OrderSourcePlatform } from "@prisma/client";
import { AuthService } from "../auth/auth.service";
import { BotInternalGuard } from "../bot/bot-internal.guard";
import { BotNotificationService } from "../bot/bot-notification.service";
import { OrderDraftsService } from "../orders/order-drafts.service";
import { OrdersService } from "../orders/orders.service";
import { PlatformSupportService } from "../support/platform-support.service";

@Controller("kook")
export class KookWebhookController {
  constructor(
    private readonly orders: OrdersService,
    private readonly orderDrafts: OrderDraftsService,
    private readonly platformSupport: PlatformSupportService,
    private readonly botNotifications: BotNotificationService,
    private readonly auth: AuthService
  ) {}

  @Post("orders/accept")
  @UseGuards(BotInternalGuard)
  acceptOrder(@Body() body: { orderId: string; kookUserId: string; messageId?: string }) {
    return this.orders.acceptOrderFromPlatform(BotPlatform.KOOK, body.orderId, body.kookUserId, body.messageId);
  }

  @Post("order-drafts/apply")
  @UseGuards(BotInternalGuard)
  applyOrderDraft(@Body() body: { draftId: string; kookUserId: string; note?: string; quoteAmount?: string; messageId?: string }) {
    return this.orderDrafts.companionApplyFromPlatform(OrderSourcePlatform.KOOK, body.draftId, body.kookUserId, {
      note: body.note,
      quoteAmount: body.quoteAmount,
      messageId: body.messageId
    });
  }

  @Post("order-drafts/apply-by-draft-no")
  @UseGuards(BotInternalGuard)
  applyOrderDraftByDraftNo(@Body() body: { draftNo: string; kookUserId: string; note?: string; quoteAmount?: string; messageId?: string }) {
    return this.orderDrafts.companionApplyFromPlatformByDraftNo(OrderSourcePlatform.KOOK, body.draftNo, body.kookUserId, {
      note: body.note,
      quoteAmount: body.quoteAmount,
      messageId: body.messageId
    });
  }

  @Post("order-drafts/expire-stale")
  @UseGuards(BotInternalGuard)
  expireStaleOrderDrafts() {
    return this.orderDrafts.expireStaleDrafts();
  }

  @Post("webhook")
  @HttpCode(200)
  async webhook(@Body() body: KookWebhookBody) {
    const webhookBody = this.decodeWebhookBody(body);
    const challenge = this.extractChallenge(webhookBody);
    if (challenge) return { challenge };

    const expectedVerifyToken = process.env.KOOK_VERIFY_TOKEN;
    const actualVerifyToken = webhookBody.verify_token ?? webhookBody.d?.verify_token;

    if (expectedVerifyToken && actualVerifyToken !== expectedVerifyToken) {
      throw new UnauthorizedException("Invalid KOOK verify token");
    }

    const memberJoin = this.extractMemberJoin(webhookBody);
    if (memberJoin) {
      const account = await this.platformSupport.ensurePlatformCustomer({
        platform: BotPlatform.KOOK,
        platformUserId: memberJoin.kookUserId,
        displayName: memberJoin.displayName
      });

      const roleSync = account?.userId
        ? await this.botNotifications.syncKookCustomerMembershipLevel(account.userId).catch((error) => ({
            platform: BotPlatform.KOOK,
            status: BotEventStatus.FAILED,
            error: errorMessage(error)
          }))
        : null;

      return {
        registered: Boolean(account),
        platform: BotPlatform.KOOK,
        kookUserId: memberJoin.kookUserId,
        userId: account?.userId,
        displayName: account?.displayName ?? memberJoin.displayName,
        roleSync
      };
    }

    const actionValue = this.extractActionValue(webhookBody);
    if (actionValue?.startsWith("order-draft.apply.")) {
      const draftId = actionValue.replace("order-draft.apply.", "");
      const kookUserId = this.extractKookUserId(webhookBody);
      if (!draftId || !kookUserId) {
        throw new BadRequestException("Missing KOOK order draft apply payload");
      }
      const instruction = await this.orderDrafts.getDraftApplyInstruction(draftId);
      const channelId = this.extractChannelId(webhookBody);
      const notification = channelId
        ? await this.botNotifications.sendKookChannelText(channelId, `(met)${kookUserId}(met) ${instruction.text}`)
        : null;
      return { prompted: true, draftNo: instruction.draftNo, notification };
    }

    if (!actionValue?.startsWith("order.accept.")) {
      return this.handlePlatformTextMessage(webhookBody);
    }

    const orderId = actionValue.replace("order.accept.", "");
    const kookUserId = this.extractKookUserId(webhookBody);

    if (!orderId || !kookUserId) {
      throw new BadRequestException("Missing KOOK order accept payload");
    }

    return this.orders.acceptOrderFromPlatform(BotPlatform.KOOK, orderId, kookUserId, this.extractMessageId(webhookBody));
  }

  @Post("support/messages")
  @UseGuards(BotInternalGuard)
  async supportMessage(
    @Body()
    body: {
      kookUserId: string;
      displayName?: string;
      guildId?: string;
      channelId?: string;
      messageId?: string;
      content: string;
      isDirect?: boolean;
    }
  ) {
    return this.platformSupport.handlePlatformMessage({
      platform: BotPlatform.KOOK,
      platformUserId: body.kookUserId,
      displayName: body.displayName,
      guildId: body.guildId,
      channelId: body.channelId,
      messageId: body.messageId,
      content: body.content,
      isDirect: body.isDirect
    });
  }

  @Post("account-bindings/consume")
  @UseGuards(BotInternalGuard)
  consumeAccountBinding(@Body() body: { code: string; kookUserId: string; displayName?: string }) {
    return this.auth.consumePlatformBindingCode(BotPlatform.KOOK, {
      code: body.code,
      externalUserId: body.kookUserId,
      displayName: body.displayName
    });
  }

  private async handlePlatformTextMessage(body: KookWebhookBody) {
    const content = this.extractContent(body);
    const kookUserId = this.extractKookUserId(body);
    const channelId = this.extractChannelId(body);
    const supportChannelId = process.env.KOOK_SUPPORT_CHANNEL_ID;
    const dispatchChannelIds = [process.env.KOOK_AI_DISPATCH_CHANNEL_ID, process.env.KOOK_DISPATCH_CHANNEL_ID].filter(Boolean);
    const isDirect = body.d?.channel_type === "PERSON";

    if (!content || !kookUserId) return { ignored: true };
    if (body.d?.extra?.author?.bot) return { ignored: true };

    const bindingCode = parseBindingText(content);
    if (bindingCode) {
      return this.handleAccountBinding(body, bindingCode, kookUserId);
    }

    if (!isDirect && channelId && dispatchChannelIds.includes(channelId)) {
      return this.handleDispatchApplyText(body, content, kookUserId);
    }

    if (!isDirect && supportChannelId && channelId !== supportChannelId) return { ignored: true };
    if (!isDirect && !supportChannelId) return { ignored: true, reason: "KOOK_SUPPORT_CHANNEL_ID is not configured" };

    const result = await this.platformSupport.handlePlatformMessage({
      platform: BotPlatform.KOOK,
      platformUserId: kookUserId,
      displayName: this.extractAuthorName(body),
      guildId: body.d?.extra?.guild_id ?? process.env.KOOK_GUILD_ID,
      channelId,
      messageId: this.extractMessageId(body),
      content,
      isDirect
    });

    if ("duplicate" in result && result.duplicate) {
      return { ...result, notification: null };
    }

    const reply = result.reply;
    const notification = isDirect
      ? await this.botNotifications.sendKookDirectMessage(kookUserId, reply)
      : channelId
        ? await this.botNotifications.sendKookChannelText(channelId, reply)
        : null;

    await this.platformSupport.markReplyMessage(result.conversationId, notification?.messageId);

    return { ...result, notification };
  }

  private async handleAccountBinding(body: KookWebhookBody, code: string, kookUserId: string) {
    const channelId = this.extractChannelId(body);
    const isDirect = body.d?.channel_type === "PERSON";

    try {
      const result = await this.auth.consumePlatformBindingCode(BotPlatform.KOOK, {
        code,
        externalUserId: kookUserId,
        displayName: this.extractAuthorName(body)
      });
      const reply = `绑定成功：${result.user.displayName}。以后 KOOK 里的客服、派单和订单记录会关联到你的网站账号。`;
      const notification = isDirect
        ? await this.botNotifications.sendKookDirectMessage(kookUserId, reply)
        : channelId
          ? await this.botNotifications.sendKookChannelText(channelId, `(met)${kookUserId}(met) ${reply}`)
          : null;
      return { bound: true, notification };
    } catch (error) {
      const reply = `绑定失败：${errorMessage(error)}。请回网站个人设置重新生成绑定码，10 分钟内使用。`;
      const notification = isDirect
        ? await this.botNotifications.sendKookDirectMessage(kookUserId, reply)
        : channelId
          ? await this.botNotifications.sendKookChannelText(channelId, `(met)${kookUserId}(met) ${reply}`)
          : null;
      return { bound: false, notification };
    }
  }

  private async handleDispatchApplyText(body: KookWebhookBody, content: string, kookUserId: string) {
    const parsed = this.parseApplyText(content);
    const channelId = this.extractChannelId(body);
    if (!parsed) {
      if (/报名|我要|接|可|来/i.test(content)) {
        const notification = channelId
          ? await this.botNotifications.sendKookChannelText(channelId, "报名请按格式发送：报名 TRY编号 段位/水平/报价/可服务时间/性格优势/是否可试音")
          : null;
        return { ignored: true, notification };
      }
      return { ignored: true };
    }

    const result = await this.orderDrafts.companionApplyFromPlatformByDraftNo(OrderSourcePlatform.KOOK, parsed.draftNo, kookUserId, {
      note: parsed.note,
      messageId: this.extractMessageId(body)
    });
    const notification = channelId
      ? await this.botNotifications.sendKookChannelText(channelId, `报名已记录：${result.companionName}。客服会把你的段位、报价、性格和优势给老板挑选。`)
      : null;
    return { ...result, notification };
  }

  private parseApplyText(content: string) {
    const normalized = content.replace(/\s+/g, " ").trim();
    const match = normalized.match(/(?:报名|我要报名|接单|我来)?\s*(TRY[0-9A-Z]+)\s*(.*)/i);
    if (!match) return null;
    const note = match[2]?.trim();
    return {
      draftNo: match[1].toUpperCase(),
      note: note || "按钮/文字报名，待补充段位、报价、性格和服务优势"
    };
  }

  private extractActionValue(body: KookWebhookBody): string | undefined {
    return (
      body.d?.extra?.body?.value ??
      body.d?.extra?.body?.data?.value ??
      body.d?.extra?.value ??
      body.d?.content
    );
  }

  private extractChallenge(body: KookWebhookBody): string | undefined {
    return body.challenge ?? body.d?.challenge ?? body.d?.extra?.challenge;
  }

  private decodeWebhookBody(body: KookWebhookBody): KookWebhookBody {
    const encryptedPayload = body.encrypt?.trim();
    if (!encryptedPayload) return body;

    const encryptKey = process.env.KOOK_ENCRYPT_KEY;
    if (!encryptKey) {
      throw new BadRequestException("KOOK encrypted webhook requires KOOK_ENCRYPT_KEY");
    }

    const key = Buffer.from(encryptKey.padEnd(32, "\0").slice(0, 32), "utf8");
    const encryptedBuffer = Buffer.from(encryptedPayload, "base64");

    const attempts = [
      () => {
        const iv = encryptedBuffer.subarray(0, 16);
        const cipherText = encryptedBuffer.subarray(16);
        return this.decryptKookPayload(key, iv, cipherText);
      },
      () => {
        const decoded = encryptedBuffer.toString("utf8");
        const iv = Buffer.from(decoded.slice(0, 16), "utf8");
        const cipherText = Buffer.from(decoded.slice(16), "base64");
        return this.decryptKookPayload(key, iv, cipherText);
      }
    ];

    for (const attempt of attempts) {
      try {
        return JSON.parse(attempt()) as KookWebhookBody;
      } catch {
        // Try the next documented KOOK encryption payload shape.
      }
    }

    throw new BadRequestException("Invalid KOOK encrypted webhook payload");
  }

  private decryptKookPayload(key: Buffer, iv: Buffer, cipherText: Buffer): string {
    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString("utf8");
  }

  private extractKookUserId(body: KookWebhookBody): string | undefined {
    return body.d?.author_id ?? body.d?.extra?.user_id ?? body.d?.extra?.body?.user_id;
  }

  private extractMessageId(body: KookWebhookBody): string | undefined {
    return body.d?.msg_id ?? body.d?.extra?.body?.msg_id;
  }

  private extractChannelId(body: KookWebhookBody): string | undefined {
    return body.d?.target_id ?? body.d?.channel_id ?? body.d?.extra?.channel_id ?? body.d?.extra?.body?.channel_id;
  }

  private extractContent(body: KookWebhookBody): string | undefined {
    return body.d?.content?.trim();
  }

  private extractAuthorName(body: KookWebhookBody): string | undefined {
    return body.d?.extra?.author?.nickname ?? body.d?.extra?.author?.username;
  }

  private extractMemberJoin(body: KookWebhookBody) {
    const eventType = [
      body.type,
      body.event_type,
      body.d?.event_type,
      body.d?.extra?.type,
      body.d?.extra?.body?.type,
      typeof body.d?.type === "string" ? body.d.type : undefined
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    const isMemberJoin = eventType.some((value) =>
      ["guild_member_add", "guild_member_added", "joined_guild", "member_join", "member_joined"].includes(value)
    );
    if (!isMemberJoin) return null;

    const member = body.d?.extra?.body?.user ?? body.d?.extra?.user ?? body.d?.extra?.author;
    const kookUserId =
      body.d?.extra?.body?.user_id ??
      body.d?.extra?.body?.user?.id ??
      body.d?.extra?.user?.id ??
      body.d?.extra?.author?.id ??
      body.d?.author_id;

    if (!kookUserId || !/^\d{6,}$/.test(kookUserId)) return null;
    if (member?.bot) return null;

    const displayName = [
      member?.nickname,
      member?.username,
      body.d?.extra?.body?.nickname,
      body.d?.extra?.body?.username
    ].find((value) => typeof value === "string" && value.trim().length > 0);

    return {
      kookUserId,
      displayName
    };
  }
}

function parseBindingText(content: string) {
  const normalized = content.trim();
  const bareCode = normalized.match(/^[A-Z0-9]{8}$/i);
  if (bareCode) return bareCode[0].toUpperCase();

  const directMatch = normalized.match(/^(?:\u7ed1\u5b9a|\u7d81\u5b9a|bind|\u7ed1\u5b9a\u7801|\u7d81\u5b9a\u78bc)\s*[:：]?\s*([A-Z0-9]{8})$/i);
  if (directMatch) return directMatch[1].toUpperCase();

  const match = content.trim().match(/^(?:绑定|綁定|bind|绑定码|綁定碼)\s*[:：]?\s*([A-Z0-9]{6,12})$/i);
  return match?.[1]?.toUpperCase();
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

interface KookWebhookBody {
  s?: number;
  type?: string;
  event_type?: string;
  challenge?: string;
  encrypt?: string;
  verify_token?: string;
  d?: {
    type?: number | string;
    event_type?: string;
    channel_type?: string;
    challenge?: string;
    verify_token?: string;
    author_id?: string;
    msg_id?: string;
    target_id?: string;
    channel_id?: string;
    content?: string;
    extra?: {
      challenge?: string;
      value?: string;
      user_id?: string;
      guild_id?: string;
      channel_id?: string;
      type?: string;
      user?: KookWebhookUser;
      author?: {
        id?: string;
        username?: string;
        nickname?: string;
        bot?: boolean;
      };
      body?: {
        type?: string;
        value?: string;
        user_id?: string;
        username?: string;
        nickname?: string;
        user?: KookWebhookUser;
        msg_id?: string;
        channel_id?: string;
        data?: {
          value?: string;
        };
      };
    };
  };
}

interface KookWebhookUser {
  id?: string;
  username?: string;
  nickname?: string;
  bot?: boolean;
}
