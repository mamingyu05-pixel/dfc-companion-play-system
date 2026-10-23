import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { BotPlatform, CompanionProfileStatus, GameCode, Prisma, UserRole } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { OrdersService } from "../orders/orders.service";
import { parseOrderAcceptAction } from "@dfc/shared";
import { DispatchVersionException } from "../orders/dispatch-version";
import { OrderDraftsService } from "../orders/order-drafts.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { getCustomerMembershipLevel } from "../customer-membership";
import { requireKookActor } from "./kook-flow-identity";
import { kookOnboardingCard, parseKookOnboardingAction, createConfirmedKookCustomer } from "./kook-customer-onboarding";
import { entryButton, flowCard, FlowCard, FlowButton, orderFlowCard, parseEntryAction, parseFlowAction, parseOrderFlowAction, webButton } from "./kook-flow-card";
import { KOOK_FLOW_PORT, KookFlowPort } from "./kook-flow-port";

type Choice = { id: string; name: string; companionId?: string };
type FlowState = {
  step: "MODE" | "HOURS" | "ROUTE" | "COMPANION" | "QUOTE" | "DEMAND" | "DRAFT_QUOTE" | "DONE" | "CANCELLED";
  draftId?: string; draftNo?: string; draftVersion?: string;
  mode?: string; hours?: string; choices?: Choice[]; page?: number;
  companionId?: string; companionName?: string; unitPrice?: string; totalAmount?: string; orderId?: string;
};
type FlowRow = { id: string; draftId?: string | null; userId: string; platformUserId: string; version: number; expiresAt: Date; state: FlowState };
export type VerifiedKookAction = { userId: string; eventId: string; messageId: string; value: string };
const MODES: Record<string, string> = { casual: "娱乐陪玩", ranked: "排位上分" };
const HOURS = ["1", "2", "3", "4"];

@Injectable()
export class KookOrderFlowService {
  constructor(private readonly prisma: PrismaService, private readonly orders: OrdersService,
    private readonly drafts: OrderDraftsService, @Inject(KOOK_FLOW_PORT) private readonly port: KookFlowPort,
    private readonly auth: AuthService) {}

  acceptsCommand(content: string) { return /^(下单|我要下单|我的需求|我的订单|陪玩工作台|首次使用|建档|余额|我的余额|钱包)$/.test(content.trim()); }

  async applyDraft(input: VerifiedKookAction, channelId?: string) {
    let card: FlowCard;
    try {
      const match = /^order-draft\.apply\.([A-Za-z0-9_-]{1,80})$/.exec(input.value);
      if (!match || !input.messageId || !channelId || !(await this.port.wasIssuedInChannel(channelId, input.messageId, input.value))) {
        throw new BadRequestException("报名卡片已失效，请使用派单频道的最新需求卡片。");
      }
      const result = await this.drafts.companionApplyKookButton(match[1], input.userId, input.messageId);
      card = flowCard(`报名回执 ${result.draftNo}`, [result.replayed ? "之前的报名已记录，本次没有重复报名。" : "报名已记录，等待客户试音和选择。", "报名不等于正式接单，不会开始计时或结算。收到正式订单后还需点击“接单”。", "无需重复填写已有陪玩资料。"], [entryButton("orders", "打开陪玩工作台", true)]);
    } catch (error) { card = this.problemCard(error); }
    return this.port.send(input.userId, card, `kook-draft-application:${input.userId}:${input.eventId}`);
  }

  async acceptVerifiedDispatch(input: { userId: string; messageId?: string; value: string }) {
    // Dispatch cards predate private-flow delivery receipts. Trust only the verified
    // inbox here; OrdersService still checks binding, owner, version and deadline.
    // Do not swallow errors: rejected actors must not complete the inbox job.
    const action = parseOrderAcceptAction(input.value);
    if (!action) throw new DispatchVersionException();
    return this.orders.acceptOrderFromPlatform(BotPlatform.KOOK, action.orderId, input.userId, input.messageId, action.dispatchVersion);
  }

  async acceptLegacy(input: VerifiedKookAction, channelId?: string) {
    const match = /^order\.accept\.([A-Za-z0-9_-]{1,80})\.(0|[1-9]\d{0,8})$/.exec(input.value);
    let card: FlowCard;
    try {
      const issued = await this.port.wasIssuedTo(input.userId, input.messageId, input.value) ||
        (!!channelId && await this.port.wasIssuedInChannel(channelId, input.messageId, input.value));
      if (!match || !issued) throw new BadRequestException("接单卡片已失效，请打开“陪玩工作台”获取本人最新订单。");
      // Legacy cards carry dispatch version/deadline, not a new UI expiry field.
      card = await this.orderAction(input.userId, { action: "accept", id: match[1], version: Number(match[2]), expiresAt: Number.POSITIVE_INFINITY }, input.messageId);
    } catch (error) { card = this.problemCard(error); }
    return this.port.send(input.userId, card, `kook-order-accept:${input.userId}:${input.eventId}`);
  }

  async command(userId: string, eventId: string, content: string) {
    let card: FlowCard;
    try {
      card = ["首次使用", "建档"].includes(content.trim()) ? await this.onboarding(userId)
        : content.trim() === "下单" || content.trim() === "我要下单"
        ? await this.openCustomerFlow(userId, eventId)
        : content.trim() === "我的需求" ? await this.demandDesk(userId)
        : ["余额", "我的余额", "钱包"].includes(content.trim()) ? await this.balanceDesk(userId) : await this.orderDesk(userId);
    } catch (error) { card = this.problemCard(error); }
    return this.port.send(userId, card, `kook-flow-command:${userId}:${eventId}`);
  }

  async action(input: VerifiedKookAction) {
    // The verified webhook supplies user_id. A forwarded card or crafted value
    // is insufficient: match the exact issued private card, recipient and value.
    if (!input.messageId || !(await this.port.wasIssuedTo(input.userId, input.messageId, input.value))) {
      return this.port.send(input.userId, flowCard("请重新打开本人工作台", ["这张卡片不属于当前账号或尚未确认送达。请发送“我的订单”或“下单”。"]), `kook-flow-rejected:${input.eventId}`);
    }
    let card: FlowCard;
    try {
      const entry = parseEntryAction(input.value);
      const onboarding = parseKookOnboardingAction(input.value);
      const flow = parseFlowAction(input.value);
      const order = parseOrderFlowAction(input.value);
      if (entry) card = await this.openEntry(input.userId, input.eventId, entry);
      else if (onboarding) card = await this.confirmOnboarding(input.userId, onboarding);
      else if (flow) card = await this.advanceCustomerFlow(input.userId, flow);
      else if (order) card = await this.orderAction(input.userId, order, input.messageId);
      else throw new BadRequestException("按钮已失效，请重新打开工作台。");
    } catch (error) { card = this.problemCard(error); }
    // A delivery failure never rolls back, repeats or conceals a committed order.
    // Refresh reads the persisted flow/ledger. UNKNOWN remains with the delivery worker.
    return this.port.send(input.userId, card, `kook-flow-result:${input.userId}:${input.eventId}`);
  }

  private async openEntry(platformUserId: string, eventId: string, action: NonNullable<ReturnType<typeof parseEntryAction>>) {
    if (Date.now() >= action.expiresAt) throw new BadRequestException("入口按钮已过期，请重新发送“我的订单”、“我的需求”或“下单”。");
    // Reuse existing identity, ownership and idempotency checks; navigation never confirms an order.
    if (action.action === "order") return this.openCustomerFlow(platformUserId, eventId);
    if (action.action === "demands") return this.demandDesk(platformUserId);
    return this.orderDesk(platformUserId);
  }

  private async onboarding(platformUserId: string) {
    return this.prisma.$transaction(async tx => {
      const account = await tx.userExternalAccount.findUnique({ where: { platform_externalUserId: { platform: BotPlatform.KOOK, externalUserId: platformUserId } } });
      if (!account) return kookOnboardingCard();
      await requireKookActor(tx, platformUserId, account.userId, UserRole.CUSTOMER);
      return flowCard("客户档案已就绪", ["当前 KOOK 已关联客户档案，无需重复建档。点击下方按钮继续；也可发送“下单”或“我的订单”。"], [entryButton("order", "开始下单", true), entryButton("orders", "我的订单")]);
    });
  }

  private async confirmOnboarding(platformUserId: string, action: NonNullable<ReturnType<typeof parseKookOnboardingAction>>) {
    if (Date.now() >= action.expiresAt) throw new BadRequestException("建档确认已过期，请重新发送“首次使用”。");
    if (action.action === "bind") return flowCard("绑定已有网页账号", ["登录原网页账号，在个人设置生成 KOOK 绑定码，再在此私聊发送：绑定 你的绑定码。", "此按钮没有建立新档案。不要发送密码或邮箱验证码；原账号的余额和订单不会自动合并。"]);
    const result = await this.prisma.$transaction(tx => createConfirmedKookCustomer(tx, platformUserId, action.expiresAt));
    return flowCard(result.created ? "客户档案已建立" : "客户档案已就绪", [result.created ? "已关联当前 KOOK 身份，初始余额为零。没有充值或创建订单。" : "已找到当前 KOOK 对应的客户档案，没有重复创建或更改余额。", "点击“开始下单”选择模式、时长和陪玩；核对报价并确认后才会成单。"], [entryButton("order", "开始下单", true), entryButton("orders", "我的订单")]);
  }

  private async openCustomerFlow(platformUserId: string, eventId: string) {
    return this.prisma.$transaction(async tx => {
      const account = await tx.userExternalAccount.findUnique({ where: { platform_externalUserId: { platform: BotPlatform.KOOK, externalUserId: platformUserId } } });
      if (!account) return kookOnboardingCard();
      const user = await requireKookActor(tx, platformUserId, undefined, UserRole.CUSTOMER);
      const key = createHash("sha256").update(JSON.stringify([platformUserId, eventId])).digest("hex");
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`kook-flow:${platformUserId}`}, 0))::text`;
      const repeated = await tx.$queryRaw<FlowRow[]>`SELECT * FROM "kook_order_flows" WHERE "eventKey" = ${key} FOR UPDATE`;
      if (repeated[0]) {
        if (repeated[0].userId !== user.id) throw new BadRequestException("账号绑定已变化，请重新发送下单指令。");
        return this.render(tx, repeated[0]);
      }
      const active = await tx.$queryRaw<FlowRow[]>`SELECT * FROM "kook_order_flows" WHERE "userId" = ${user.id} AND "platformUserId" = ${platformUserId}
        AND "draftId" IS NULL AND "expiresAt" > NOW() AND "state"->>'step' NOT IN ('DONE', 'CANCELLED') ORDER BY "createdAt" DESC LIMIT 1 FOR UPDATE`;
      if (active[0]) return this.render(tx, active[0]);
      const id = randomUUID();
      const rows = await tx.$queryRaw<FlowRow[]>`INSERT INTO "kook_order_flows" ("id", "eventKey", "userId", "platformUserId", "state", "expiresAt")
        VALUES (${id}, ${key}, ${user.id}, ${platformUserId}, '{"step":"MODE"}'::jsonb, NOW() + INTERVAL '15 minutes') RETURNING *`;
      return this.render(tx, rows[0]);
    });
  }

  private async advanceCustomerFlow(platformUserId: string, action: NonNullable<ReturnType<typeof parseFlowAction>>) {
    return this.prisma.$transaction(async tx => {
      const user = await requireKookActor(tx, platformUserId, undefined, UserRole.CUSTOMER);
      const rows = await tx.$queryRaw<FlowRow[]>`SELECT * FROM "kook_order_flows" WHERE "id" = ${action.id} AND "userId" = ${user.id} AND "platformUserId" = ${platformUserId} FOR UPDATE`;
      const flow = rows[0];
      if (!flow) throw new BadRequestException("没有找到属于当前账号的下单记录，请重新发送“下单”。");
      if (flow.state.step === "DONE") return this.render(tx, flow);
      if (flow.version !== action.version) return this.render(tx, flow, "上一步已更新，请使用这张最新卡片。");
      const state = flow.state;
      if (action.choice === "refresh_demand" && flow.draftId) {
        flow.state = await this.demandState(tx, flow.userId, platformUserId, flow.draftId);
        flow.expiresAt = new Date(Date.now() + 900_000);
      } else if (action.choice === "restart") {
        if (flow.draftId) throw new BadRequestException("公开需求仍然保留，请发送“我的需求”处理原需求。新指定陪玩订单请单独发送“下单”。");
        flow.state = { step: "MODE" }; flow.expiresAt = new Date(Date.now() + 900_000);
      } else {
        if (flow.expiresAt.getTime() <= Date.now()) return this.render(tx, flow);
        if (action.choice === "cancel" && !flow.draftId) flow.state = { step: "CANCELLED" };
        else if (state.step === "MODE" && MODES[action.choice]) flow.state = { step: "HOURS", mode: MODES[action.choice] };
        else if (state.step === "HOURS" && HOURS.includes(action.choice)) {
          flow.state = { step: "ROUTE", mode: state.mode, hours: action.choice };
        } else if (state.step === "ROUTE" && action.choice === "direct") {
          flow.state = { ...state, step: "COMPANION", page: 0, choices: await this.companions(tx, 0) };
        } else if (state.step === "ROUTE" && action.choice === "publish") {
          const draft = await this.drafts.createKookCustomerDemand(tx, user.id, platformUserId, { requestId: `kook-demand-intent-${flow.id}`, mode: state.mode!, hours: state.hours! });
          flow.draftId = draft.id;
          flow.state = await this.demandState(tx, user.id, platformUserId, draft.id);
        } else if (state.step === "DEMAND" && (action.choice === "next" || action.choice === "previous")) {
          flow.state = await this.demandState(tx, user.id, platformUserId, state.draftId!, Math.max(0, (state.page ?? 0) + (action.choice === "next" ? 1 : -1)));
        } else if (state.step === "DEMAND" && state.choices?.some(item => item.id === action.choice) && !state.companionId) {
          const selected = await this.drafts.selectKookDemandCandidate(tx, user.id, platformUserId, { draftId: state.draftId!, candidateId: action.choice, expectedVersion: state.draftVersion! });
          flow.state = { step: "DRAFT_QUOTE", ...await this.drafts.quoteKookDemand(tx, user.id, platformUserId, selected.id, selected.selectedCompanionId!) };
        } else if (state.step === "DEMAND" && action.choice === "quote_selected" && state.companionId) {
          flow.state = { step: "DRAFT_QUOTE", ...await this.drafts.quoteKookDemand(tx, user.id, platformUserId, state.draftId!, state.companionId) };
        } else if ((state.step === "DEMAND" || state.step === "DRAFT_QUOTE") && action.choice === "reselect") {
          await this.drafts.reopenKookDemand(tx, user.id, platformUserId, state.draftId!, state.draftVersion!);
          flow.state = await this.demandState(tx, user.id, platformUserId, state.draftId!);
        } else if (state.step === "DRAFT_QUOTE" && action.choice === "refresh") {
          flow.state = { step: "DRAFT_QUOTE", ...await this.drafts.quoteKookDemand(tx, user.id, platformUserId, state.draftId!, state.companionId!) };
        } else if (state.step === "DRAFT_QUOTE" && action.choice === "confirm") {
          const order = await this.drafts.confirmKookDemand(tx, user.id, platformUserId, { draftId: state.draftId!, companionId: state.companionId!, expectedVersion: state.draftVersion!, expectedTotalAmount: state.totalAmount!, expiresAt: flow.expiresAt.getTime() });
          flow.state = { step: "DONE", orderId: order.id, draftId: state.draftId, draftNo: state.draftNo };
        } else if (state.step === "COMPANION" && (action.choice === "next" || action.choice === "previous")) {
          const page = Math.max(0, (state.page ?? 0) + (action.choice === "next" ? 1 : -1));
          const choices = await this.companions(tx, page);
          flow.state = { ...state, page: choices.length ? page : 0, choices: choices.length ? choices : await this.companions(tx, 0) };
        } else if (state.step === "COMPANION" && state.choices?.some(item => item.id === action.choice)) {
          const selected = state.choices.find(item => item.id === action.choice)!;
          const quote = await this.orders.previewKookCustomerOrder(tx, user.id, { mode: state.mode!, hours: state.hours!, companionId: selected.id });
          flow.state = { step: "QUOTE", ...quote, companionName: selected.name };
        } else if (state.step === "QUOTE" && action.choice === "refresh") {
          const quote = await this.orders.previewKookCustomerOrder(tx, user.id, { mode: state.mode!, hours: state.hours!, companionId: state.companionId! });
          flow.state = { step: "QUOTE", ...quote, companionName: state.companionName };
        } else if (state.step === "QUOTE" && action.choice === "confirm") {
          const order = await this.orders.createConfirmedKookOrder(tx, user.id, platformUserId, {
            requestId: `kook-flow-${flow.id}`, mode: state.mode!, hours: state.hours!, companionId: state.companionId!, expectedTotalAmount: state.totalAmount!, expiresAt: flow.expiresAt.getTime()
          });
          flow.state = { step: "DONE", orderId: order.id };
        } else throw new BadRequestException("当前步骤不能执行这个按钮，请重新打开下单卡片。");
      }
      flow.version++;
      await this.saveFlow(tx, flow);
      return this.render(tx, flow);
    });
  }

  private async saveFlow(tx: Prisma.TransactionClient, flow: FlowRow) {
    await tx.$executeRaw`UPDATE "kook_order_flows" SET "version" = ${flow.version}, "state" = ${JSON.stringify(flow.state)}::jsonb,
      "draftId" = COALESCE("draftId", ${flow.draftId ?? null}), "expiresAt" = ${flow.expiresAt}, "updatedAt" = NOW() WHERE "id" = ${flow.id}`;
  }

  private async demandState(tx: Prisma.TransactionClient, customerId: string, platformUserId: string, draftId: string, page = 0): Promise<FlowState> {
    let snapshot = await this.drafts.kookDemandSnapshot(tx, customerId, platformUserId, draftId, page);
    if (!snapshot.candidates.length && page) { page = 0; snapshot = await this.drafts.kookDemandSnapshot(tx, customerId, platformUserId, draftId, 0); }
    if (snapshot.order) return { step: "DONE", draftId, draftNo: snapshot.draft.draftNo, orderId: snapshot.order.id };
    return { step: "DEMAND", draftId, draftNo: snapshot.draft.draftNo, draftVersion: snapshot.version,
      mode: snapshot.draft.mode, hours: snapshot.draft.hours!.toString(), page, choices: snapshot.candidates,
      companionId: snapshot.draft.status === "SELECTED" ? snapshot.draft.selectedCompanionId ?? undefined : undefined };
  }

  private async demandDesk(platformUserId: string) {
    return this.prisma.$transaction(async tx => {
      const user = await requireKookActor(tx, platformUserId, undefined, UserRole.CUSTOMER);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`kook-flow:${platformUserId}`}, 0))::text`;
      const drafts = await tx.orderDraft.findMany({ where: { customerId: user.id, customerPlatformUserId: platformUserId, sourcePlatform: "KOOK",
        status: { in: ["OPEN", "TRIALING", "SELECTED", "CONVERTED"] } }, orderBy: { updatedAt: "desc" }, take: 4, select: { id: true } });
      if (!drafts.length) return flowCard("我的需求", ["暂时没有属于当前账号的需求。发送“下单”，选择模式、时长后点击“交给客服安排”。"]);
      const cards: FlowCard = flowCard("我的需求", ["本次显示最近四条需求；更早的需求可向客服提供原需求号核对。选择和确认均以本人最新卡片为准。"]);
      for (const draft of drafts) {
        let [flow] = await tx.$queryRaw<FlowRow[]>`SELECT * FROM "kook_order_flows" WHERE "draftId" = ${draft.id} FOR UPDATE`;
        if (!flow) {
          const id = randomUUID(), key = createHash("sha256").update(`kook-demand-flow:${draft.id}`).digest("hex");
          const state = { step: "DEMAND", draftId: draft.id };
          [flow] = await tx.$queryRaw<FlowRow[]>`INSERT INTO "kook_order_flows" ("id", "eventKey", "draftId", "userId", "platformUserId", "state", "expiresAt")
            VALUES (${id}, ${key}, ${draft.id}, ${user.id}, ${platformUserId}, ${JSON.stringify(state)}::jsonb, NOW() + INTERVAL '15 minutes') RETURNING *`;
        }
        if (flow.userId !== user.id || flow.platformUserId !== platformUserId) throw new BadRequestException("需求绑定已变化，请管理员核对原记录，勿重复付款。");
        flow.state = await this.demandState(tx, user.id, platformUserId, draft.id);
        flow.version++; flow.expiresAt = new Date(Date.now() + 900_000);
        await this.saveFlow(tx, flow);
        cards.push(...await this.render(tx, flow));
      }
      return cards;
    });
  }

  private async companions(tx: Prisma.TransactionClient, page: number): Promise<Choice[]> {
    const rows = await tx.companionProfile.findMany({ where: {
      status: CompanionProfileStatus.LISTED, user: { status: "ACTIVE", role: "COMPANION" },
      OR: [{ game: GameCode.DELTA_FORCE }, { games: { has: GameCode.DELTA_FORCE } }]
    }, orderBy: { userId: "asc" }, skip: page * 3, take: 3, select: { userId: true, nickname: true } });
    return rows.map(row => ({ id: row.userId, name: row.nickname }));
  }

  private async render(tx: Prisma.TransactionClient, flow: FlowRow, prefix?: string): Promise<FlowCard> {
    const button = (choice: string, label: string, primary = false): FlowButton => ({ label, primary, value: `dfc.flow.${flow.id}.${flow.version}.${choice}` });
    const state = flow.state;
    if (state.step === "DONE") {
      const order = await tx.order.findFirst({ where: { id: state.orderId, customerId: flow.userId } });
      if (!order) throw new BadRequestException("订单回执需要管理员核对，请不要重新付款。");
      return orderFlowCard(order, false, "已创建订单并冻结订单款。重复点击不会再次扣款。");
    }
    if (flow.draftId && flow.expiresAt.getTime() <= Date.now()) return flowCard(`需求 ${state.draftNo ?? ""}`, ["卡片已过期，原需求仍保留。请先刷新需求，不要重复发布或付款。"], [button("refresh_demand", "刷新需求")]);
    if (flow.expiresAt.getTime() <= Date.now()) return flowCard("报价步骤已过期", ["尚未创建订单或扣款。重新选择后再确认报价。"], [button("restart", "重新选择")]);
    if (state.step === "CANCELLED") return flowCard("已取消本次下单", ["本次没有创建订单或扣款。发送“下单”可重新开始。"]);
    const intro = prefix ? [prefix] : [];
    if (state.step === "MODE") return flowCard("选个模式", [...intro, "三角洲行动 · 先选模式和时长，最后核对报价。确认前不会扣款。"], Object.entries(MODES).map(([id, label]) => button(id, label)));
    if (state.step === "HOURS") return flowCard("玩多久", [...intro, `已选：${state.mode}`, "其他时长可联系管理员确认，不会替你提交。"], [...HOURS.map(hours => button(hours, `${hours} 小时`)), button("restart", "重新选择")]);
    if (state.step === "ROUTE") return flowCard("想怎么找陪玩", [...intro, `${state.mode} · ${state.hours} 小时`, "指定陪玩：查看所选陪玩的报价，付款后由客服安排。提交需求：先由客服找人，再核对报价；提交需求不会扣款。"], [button("direct", "指定陪玩"), button("publish", "交给客服安排"), button("restart", "重新选择")]);
    if (state.step === "DEMAND") return flowCard(`需求 ${state.draftNo}`, [...intro, `${state.mode} · ${state.hours} 小时`,
      state.companionId ? "已记录所选陪玩，还需你核对本次报价并确认；尚未扣款。" : state.choices?.length ? "以下为上次刷新的候选名单；选择不会扣款。" : "需求已交给客服安排，可刷新人选；有疑问请联系人工客服。",
      "报名和试音不等于正式接单。发送“我的需求”可以找回这条需求。"], state.companionId
      ? [button("quote_selected", "查看所选 TA 报价", true), button("reselect", "重新选人"), button("refresh_demand", "刷新需求")]
      : [...(state.choices ?? []).map(item => button(item.id, `选 TA：${item.name}`)), button("previous", "上一页"), button("next", "下一页"), button("refresh_demand", "刷新需求")]);
    if (state.step === "DRAFT_QUOTE") return flowCard(`需求 ${state.draftNo} · 确认成单`, [...intro, `陪玩：${state.companionName}`, `${state.mode} · ${state.hours} 小时`, `单价 ¥${state.unitPrice}/小时 · 本次合计 ¥${state.totalAmount}`,
      "试音选择已记录。只有点击确认成单才冻结本次订单款，再等待陪玩正式接单。价格变化需要重新确认；同一需求不会重复成单。"], [button("confirm", "确认成单", true), button("refresh", "刷新报价"), button("reselect", "重新选人"), button("refresh_demand", "返回需求")]);
    if (state.step === "COMPANION") return flowCard("选择陪玩", [...intro, `${state.mode} · ${state.hours} 小时`, state.choices?.length ? "选中后查看本次 KOOK 报价。在线标记不保证立即接单。" : "当前没有可选陪玩，请稍后刷新或联系管理员。"], [
      ...(state.choices ?? []).map(item => button(item.id, item.name)), button("previous", "上一页"), button("next", "下一页"), button("restart", "重新选择")
    ]);
    return flowCard("核对后确认下单", [...intro, `陪玩：${state.companionName}`, `${state.mode} · ${state.hours} 小时`, `单价 ¥${state.unitPrice}/小时 · 本次合计 ¥${state.totalAmount}`,
      "确认后从本人余额冻结订单款，并等待所选陪玩接单。余额不足不会创建订单；价格变化需重新确认。"], [button("confirm", "确认下单", true), button("refresh", "刷新报价"), button("restart", "重新选择"), button("cancel", "取消")]);
  }

  private async orderDesk(platformUserId: string) {
    return this.prisma.$transaction(async tx => {
      const user = await requireKookActor(tx, platformUserId);
      const companion = user.role === UserRole.COMPANION;
      if (!companion && user.role !== UserRole.CUSTOMER) throw new BadRequestException("管理员请使用管理后台处理异常。");
      const orders = await tx.order.findMany({ where: companion ? { companionId: user.id } : { customerId: user.id }, orderBy: { createdAt: "desc" }, take: 4 });
      return { user, companion, orders };
    }).then(async ({ user, companion, orders }) => {
      const web = webButton(await this.auth.issueWebLoginLink(user.id), companion ? "在网页打开工作台" : "在网页查看全部订单");
      if (!orders.length) return flowCard(companion ? "陪玩工作台" : "我的订单", [companion ? "暂时没有派给你的订单。报名/试音不等于接到正式订单。收到正式订单后，依次接单、开始服务、提交完成。" : "暂时没有订单。点击“开始下单”选择模式、时长和陪玩；公开报名中的需求可在“我的需求”查看。"], companion ? [entryButton("orders", "刷新工作台", true), web] : [entryButton("order", "开始下单", true), entryButton("demands", "我的需求"), web]);
      return [...orders.flatMap(order => orderFlowCard(order, companion)),
        ...flowCard("更多", ["点下面按钮直接打开网页，已自动登录，不用输入密码。链接 10 分钟内有效、只能用一次，不要转发给别人。"], [web])];
    });
  }

  private async balanceDesk(platformUserId: string) {
    const data = await this.prisma.$transaction(async tx => {
      const user = await requireKookActor(tx, platformUserId);
      if (user.role !== UserRole.CUSTOMER && user.role !== UserRole.COMPANION) throw new BadRequestException("管理员请使用管理后台。");
      const wallet = await tx.wallet.findUnique({ where: { userId: user.id } });
      const recharged = await tx.rechargeRequest.aggregate({ where: { customerId: user.id, status: "APPROVED" }, _sum: { amount: true } });
      return { user, wallet, totalRecharge: recharged._sum.amount ?? new Prisma.Decimal(0) };
    });
    const web = webButton(await this.auth.issueWebLoginLink(data.user.id));
    const yuan = (value?: Prisma.Decimal | null) => `¥${(value ?? new Prisma.Decimal(0)).toFixed(2)}`;
    if (data.user.role === UserRole.COMPANION) {
      return flowCard("我的收益", [`可提现 ${yuan(data.wallet?.availableIncome)} · 待结算 ${yuan(data.wallet?.pendingIncome)}`,
        "待结算的收益在客户验收后转为可提现。提现请在网页的陪玩端申请。"], [entryButton("orders", "陪玩工作台", true), web]);
    }
    const level = getCustomerMembershipLevel(data.totalRecharge);
    return flowCard("我的余额", [
      `可用余额 ${yuan(data.wallet?.availableBalance)}${data.wallet?.frozenBalance.gt(0) ? ` · 订单冻结中 ${yuan(data.wallet.frozenBalance)}` : ""}`,
      `累计充值 ${yuan(data.totalRecharge)} · 会员等级 ${level.name}${level.nextMinRecharge ? `（累计充值满 ¥${level.nextMinRecharge} 升下一级）` : ""}`,
      "充值请直接转账给客服，客服入账后余额立即更新。"
    ], [entryButton("order", "开始下单", true), entryButton("orders", "我的订单"), web]);
  }

  private async orderAction(platformUserId: string, action: NonNullable<ReturnType<typeof parseOrderFlowAction>>, messageId: string) {
    const actor = await this.prisma.$transaction(tx => requireKookActor(tx, platformUserId));
    const owned = await this.prisma.order.findFirst({ where: { id: action.id, ...(actor.role === UserRole.COMPANION ? { companionId: actor.id } : { customerId: actor.id }) } });
    if (!owned || ![UserRole.CUSTOMER, UserRole.COMPANION].includes(actor.role as "CUSTOMER" | "COMPANION")) throw new BadRequestException("没有找到属于当前账号的订单。");
    if (action.action !== "refresh" && action.expiresAt <= Date.now()) return orderFlowCard(owned, actor.role === UserRole.COMPANION, "按钮已过期，订单没有因这次点击改变。请使用最新按钮。");
    if (action.action !== "refresh" && actor.role !== UserRole.COMPANION) throw new BadRequestException("只有本单陪玩可以执行这个操作。");
    if (action.action === "accept") await this.orders.acceptOrderFromPlatform(BotPlatform.KOOK, action.id, platformUserId, messageId, action.version, action.expiresAt);
    if (["busy", "later", "unsuitable"].includes(action.action)) await this.orders.declineOrder(action.id, actor.id,
      ({ busy: "正在忙", later: "时间不合适", unsuitable: "不符合需求" } as Record<string, string>)[action.action], action.version, { platformUserId, expiresAt: action.expiresAt });
    if (action.action === "start") await this.orders.startOrder(action.id, actor.id, { platformUserId, dispatchVersion: action.version, expiresAt: action.expiresAt });
    if (action.action === "complete") await this.orders.completeOrder(action.id, actor.id, { platformUserId, dispatchVersion: action.version, expiresAt: action.expiresAt });
    // Re-check the binding after the mutation; no old account receipt on rebind.
    return this.prisma.$transaction(async tx => {
      await requireKookActor(tx, platformUserId, actor.id);
      const current = await tx.order.findUniqueOrThrow({ where: { id: action.id } });
      const decline = ["busy", "later", "unsuitable"].includes(action.action);
      if (current.customerId !== actor.id && current.companionId !== actor.id && !decline) throw new BadRequestException("订单归属已变化，请刷新本人工作台。");
      return decline ? flowCard(`订单 ${current.orderNo}`, ["已提交拒单原因，等待管理员处理。未替客户更换陪玩。", "点击下方按钮查看仍属于你的订单。"], [entryButton("orders", "返回陪玩工作台", true)])
        : orderFlowCard(current, actor.role === UserRole.COMPANION);
    });
  }

  private problemCard(error: unknown) {
    const raw = error instanceof Error ? error.message : "";
    const translated: Record<string, string> = {
      "Insufficient balance": "余额不足，本次未创建订单。请按现有充值流程处理后再刷新报价；管理员改余额不是支付到账。",
      "Agreed service duration has not elapsed; use a documented dispute resolution for early termination": "约定服务时长尚未达到，未提交完成。提前结束请联系管理员核对。",
      "An unresolved complaint blocks completion": "本单有待处理投诉，暂不能提交完成，请联系管理员。"
    };
    const known = error instanceof BadRequestException;
    return flowCard("本次操作回执", [translated[raw] ?? (known && /[\u4e00-\u9fff]/.test(raw) ? raw : "操作结果需要核对。请先发送“我的订单”、“我的需求”或“下单”刷新原记录，不要重复付款；仍无法确认请联系管理员。"), "回执仅发送到当前 KOOK 私聊。未完成绑定请在已登录网页的账号绑定入口生成绑定码，再私聊发送“绑定 绑定码”；没有网页账号可发送“首次使用”，由本人明确确认建立客户档案。"]);
  }
}
