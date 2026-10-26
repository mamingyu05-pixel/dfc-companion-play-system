export type MoneyIntentPurpose = "withdrawal" | "staff-recharge" | "quick-order";
export type MoneyIntentState = {
  subject: string | null;
  connected: boolean;
  busy: boolean;
  phase: "empty" | "unknown" | "confirmed" | "partial";
  targetId: string | null;
  targetLabel: string;
  body: Record<string, unknown> | null;
  receipt: Record<string, unknown> | null;
  error: string;
};
type Body = Record<string, unknown> & {
  requestId: string;
};
type Journal = {
  version: 1;
  purpose: MoneyIntentPurpose;
  subject: string;
  targetId: string;
  targetLabel: string;
  phase: "unknown" | "confirmed" | "partial";
  body: Body;
  receipt?: Record<string, unknown>;
};
type Identity = {
  subject: string;
  token: string;
};
type Transport = (
  path: string,
  init: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const amount = (v: unknown): v is string =>
  typeof v === "string" && /^\d+(?:\.\d{1,2})?$/.test(v) && Number(v) > 0 && Number.isFinite(Number(v));
const sameAmount = (a: unknown, b: unknown) =>
  amount(String(a ?? "")) && amount(String(b ?? "")) && Number(a) === Number(b);
const idValid = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9-]{16,56}$/.test(v);
export const emptyMoneyIntentState = (): MoneyIntentState => ({
  subject: null,
  connected: false,
  busy: false,
  phase: "empty",
  targetId: null,
  targetLabel: "",
  body: null,
  receipt: null,
  error: "",
});
/** A different target cannot replace the unresolved operation for this verified actor and purpose. */
export function createMoneyIntentClient({
  purpose,
  storage,
  fetcher,
  getToken,
  makeRequestId,
  scope,
  withLock,
}: {
  purpose: MoneyIntentPurpose;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  fetcher: Transport;
  getToken(): string | null;
  makeRequestId(): string;
  scope: string;
  withLock?: <T>(name: string, action: () => Promise<T>) => Promise<T>;
}) {
  let view = emptyMoneyIntentState(),
    identity: Identity | null = null,
    busy = false;
  const route = {
    withdrawal: "/api/wallet/withdrawal-requests",
    "staff-recharge": "/api/admin/recharges/staff-record",
    "quick-order": "/api/admin/quick-order",
  }[purpose];
  const key = (subject: string) =>
    "dfc.money-intent.v1:" + encodeURIComponent(scope) + ":" + encodeURIComponent(subject) + ":" + purpose;
  function state(): MoneyIntentState {
    try {
      if (identity && getToken() !== identity.token) {
        identity = null;
        view = emptyMoneyIntentState();
      }
    } catch {
      identity = null;
      view = emptyMoneyIntentState();
    }
    return {
      ...view,
      body: view.body ? clone(view.body) : null,
      receipt: view.receipt ? clone(view.receipt) : null,
      busy,
    };
  }
  function check(s: Identity) {
    if (getToken() !== s.token || identity?.subject !== s.subject) {
      identity = null;
      view = emptyMoneyIntentState();
      throw Error("登录身份已变化，请回原账号核对原申请。");
    }
  }
  async function fetchData(path: string, init: RequestInit) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetcher(path, { ...init, cache: "no-store", signal: controller.signal });
      return { response, data: await response.json() };
    } catch (error) {
      if (controller.signal.aborted) throw Error("连接超时，原申请仍需核对，请勿另建一笔。");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  async function authenticate() {
    const token = getToken();
    if (!token) {
      identity = null;
      view = emptyMoneyIntentState();
      throw Error("请先登录后核对原申请。");
    }
    if (identity?.token !== token) {
      identity = null;
      view = emptyMoneyIntentState();
    }
    const { response, data } = await fetchData("/api/auth/me", { headers: { Authorization: "Bearer " + token } });
    const info = object(data),
      user = object(info.user);
    const allowed =
      purpose === "withdrawal"
        ? ["CUSTOMER", "COMPANION", "ADMIN", "SUPER_ADMIN"].includes(String(user.role)) &&
          typeof object(info.companionProfile).status === "string" &&
          object(info.companionProfile).status !== "BANNED"
        : ["ADMIN", "SUPER_ADMIN"].includes(String(user.role));
    if (!response.ok || getToken() !== token || !allowed || typeof user.id !== "string" || !user.id) {
      identity = null;
      view = emptyMoneyIntentState();
      throw Error("当前身份未通过核对，没有发送新申请。");
    }
    identity = { token, subject: user.id };
    view.subject = user.id;
    view.connected = true;
    return identity;
  }
  function validBody(body: Record<string, unknown>, subject: string) {
    if (!idValid(body.requestId)) throw Error("原申请编号异常，暂不提交。");
    if (purpose === "withdrawal") {
      if (!amount(body.amount) || typeof body.payoutAccount !== "string" || !body.payoutAccount.trim())
        throw Error("请填写正确的提现金额和收款账户。");
      return subject;
    }
    if (typeof body.customerId !== "string" || !body.customerId) throw Error("请先选择有效客户。");
    if (purpose === "staff-recharge" && !amount(body.amount)) throw Error("请填写正确的入账金额。");
    if (purpose === "quick-order" && !amount(body.expectedTotalAmount)) throw Error("请先重新核对订单金额。");
    return body.customerId;
  }
  function validReceipt(data: unknown, j: Journal): "confirmed" | "partial" {
    const v = object(data),
      b = j.body;
    if (purpose === "withdrawal") {
      if (
        typeof v.id !== "string" ||
        !v.id ||
        v.companionId !== j.subject ||
        v.requestId !== b.requestId ||
        v.payoutAccount !== String(b.payoutAccount).trim() ||
        !sameAmount(v.amount, b.amount) ||
        !["PENDING", "APPROVED", "REJECTED", "PAID"].includes(String(v.status))
      )
        throw Error("未收到原提现申请的有效回执，请原编号核对。");
      return "confirmed";
    }
    if (purpose === "staff-recharge") {
      const r = object(v.recharge);
      if (
        v.requestId !== b.requestId ||
        typeof v.replayed !== "boolean" ||
        typeof r.id !== "string" ||
        !r.id ||
        r.customerId !== j.targetId ||
        r.status !== "APPROVED" ||
        !sameAmount(r.amount, b.amount)
      )
        throw Error("未收到原充值的有效回执，请原编号核对。");
      return "confirmed";
    }
    if (v.requestId !== b.requestId) throw Error("回执编号与原快捷单不符，请原编号核对。");
    const r = object(v.recharge),
      topUp = object(b.topUp);
    if (!b.topUp && v.recharge !== null) throw Error("代充回执与原快捷单不符，请原编号核对。");
    if (
      b.topUp &&
      (typeof r.id !== "string" ||
        !r.id ||
        r.requestId !== b.requestId + "-topup" ||
        !sameAmount(r.amount, topUp.amount))
    )
      throw Error("原代充回执待核对，请勿重新代充。");
    if (
      v.outcome === "RECHARGE_COMMITTED_ORDER_NOT_CREATED" &&
      v.order === null &&
      b.topUp &&
      object(v.error).orderOutcome === "NOT_COMMITTED"
    )
      return "partial";
    const order = object(v.order);
    if (
      v.outcome !== "ORDER_CREATED" ||
      typeof order.id !== "string" ||
      !order.id ||
      typeof order.orderNo !== "string" ||
      !order.orderNo ||
      typeof order.status !== "string" ||
      !sameAmount(order.totalAmount, b.expectedTotalAmount)
    )
      throw Error("原订单回执待核对，请勿另建订单。");
    return "confirmed";
  }
  function restore(s: Identity): Journal | null {
    let raw: string | null;
    try {
      raw = storage.getItem(key(s.subject));
    } catch {
      throw Error("无法读取原申请，暂不发送，请联系管理员核对。");
    }
    if (!raw) return null;
    let j: Journal;
    try {
      j = JSON.parse(raw) as Journal;
    } catch {
      throw Error("原申请记录损坏，请联系管理员核对，勿另建一笔。");
    }
    if (
      j.version !== 1 ||
      j.purpose !== purpose ||
      j.subject !== s.subject ||
      typeof j.targetLabel !== "string" ||
      !["unknown", "confirmed", "partial"].includes(j.phase) ||
      j.targetId !== validBody(object(j.body), s.subject)
    )
      throw Error("原申请记录不完整，请联系管理员核对。");
    if (j.receipt !== undefined) {
      const receiptPhase = validReceipt(j.receipt, j);
      if (j.phase !== "unknown" && receiptPhase !== j.phase) throw Error("原回执记录异常，请原编号核对。");
    } else if (j.phase !== "unknown") throw Error("原回执记录异常，请原编号核对。");
    return j;
  }
  function show(j: Journal | null) {
    view.phase = j?.phase ?? "empty";
    view.targetId = j?.targetId ?? null;
    view.targetLabel = j?.targetLabel ?? "";
    view.body = j ? clone(j.body) : null;
    view.receipt = j?.receipt ? clone(j.receipt) : null;
  }
  function save(s: Identity, j: Journal) {
    check(s);
    try {
      const current = restore(s);
      if (current && current.body.requestId !== j.body.requestId) throw Error("another intent");
      const raw = JSON.stringify(j);
      storage.setItem(key(s.subject), raw);
      if (storage.getItem(key(s.subject)) !== raw) throw Error("write not retained");
    } catch {
      throw Error("原申请无法可靠保存，暂不发送新请求；请核对原申请。");
    }
  }
  async function send(s: Identity, j: Journal, first: boolean) {
    const pending = { ...j, phase: "unknown" as const };
    save(s, pending);
    show(pending);
    const { response, data } = await fetchData(route, {
      method: "POST",
      headers: { Authorization: "Bearer " + s.token, "Content-Type": "application/json" },
      body: JSON.stringify(pending.body),
    });
    check(s);
    if (!response.ok) {
      // These endpoints roll a first validation rejection back in their own transaction; an earlier unknown attempt stays locked.
      if (first && purpose !== "quick-order" && response.status === 400) {
        const current = restore(s);
        if (current?.body.requestId === pending.body.requestId) {
          storage.removeItem(key(s.subject));
          show(null);
        }
      }
      throw Error(
        typeof object(data).message === "string"
          ? String(object(data).message)
          : "原申请结果待核对，请使用原编号核对，勿另建一笔。",
      );
    }
    const phase = validReceipt(data, pending),
      confirmed = { ...pending, phase, receipt: object(data) };
    save(s, confirmed);
    show(confirmed);
  }
  async function run(action: () => Promise<void>) {
    if (busy) return state();
    busy = true;
    view.error = "";
    try {
      await action();
    } catch (error) {
      view.error = error instanceof Error ? error.message : "结果待核对，请勿另建一笔。";
    } finally {
      busy = false;
    }
    return state();
  }
  function sameIdentity(before: Identity | null, s: Identity) {
    if (before && (before.token !== s.token || before.subject !== s.subject))
      throw Error("账号已变化，请刷新核对当前账号，未发送申请。");
  }
  async function atomic<T>(session: Identity, action: () => Promise<T>): Promise<T> {
    const lock =
      withLock ??
      (typeof navigator !== "undefined" && navigator.locks
        ? <U,>(name: string, work: () => Promise<U>) => navigator.locks.request(name, work)
        : null);
    if (!lock) {
      view.connected = false;
      throw Error("当前浏览器无法安全锁定原申请，暂不发送。请使用支持安全锁的浏览器核对。");
    }
    return lock(key(session.subject), async () => {
      check(session);
      return action();
    });
  }
  return {
    state,
    refresh: () =>
      run(async () => {
        const session = await authenticate();
        await atomic(session, async () => {
          show(restore(session));
        });
      }),
    submit: (input: Record<string, unknown>, targetLabel = "") =>
      run(async () => {
        const captured = clone(input),
          before = identity,
          session = await authenticate();
        sameIdentity(before, session);
        await atomic(session, async () => {
          const existing = restore(session);
          if (existing) {
            show(existing);
            throw Error("原申请尚未明确另开一笔，请先核对原申请。");
          }
          const body = { ...captured, requestId: makeRequestId() } as Body;
          const targetId = validBody(body, session.subject);
          await send(
            session,
            { version: 1, purpose, subject: session.subject, targetId, targetLabel, phase: "unknown", body },
            true,
          );
        });
      }),
    retry: () =>
      run(async () => {
        const before = identity,
          expected = String(view.body?.requestId ?? ""),
          session = await authenticate();
        sameIdentity(before, session);
        await atomic(session, async () => {
          const journal = restore(session);
          if (!journal || (expected && journal.body.requestId !== expected)) {
            show(journal);
            throw Error("原申请已由其他页面更新，请核对当前记录。");
          }
          await send(session, journal, false);
        });
      }),
    continueOrder: (input: Record<string, unknown>) =>
      run(async () => {
        const captured = clone(input),
          before = identity,
          expected = String(view.body?.requestId ?? ""),
          session = await authenticate();
        sameIdentity(before, session);
        await atomic(session, async () => {
          const journal = restore(session);
          if (
            purpose !== "quick-order" ||
            !journal ||
            journal.phase !== "partial" ||
            journal.body.requestId !== expected
          ) {
            show(journal);
            throw Error("请先核实原充值与订单结果。");
          }
          const body = { ...journal.body };
          for (const field of [
            "kind",
            "game",
            "mode",
            "hours",
            "companionId",
            "customUnitPrice",
            "packageId",
            "notes",
            "expectedTotalAmount",
          ]) {
            if (field in captured && captured[field] !== undefined) body[field] = clone(captured[field]);
          }
          validBody(body, session.subject);
          await send(session, { ...journal, body }, false);
        });
      }),
    beginNew: () =>
      run(async () => {
        const before = identity,
          expected = String(view.body?.requestId ?? ""),
          session = await authenticate();
        sameIdentity(before, session);
        await atomic(session, async () => {
          const journal = restore(session);
          if (!journal || journal.phase !== "confirmed" || journal.body.requestId !== expected) {
            show(journal);
            throw Error("原申请尚未确认，不能另建一笔。");
          }
          storage.removeItem(key(session.subject));
          if (storage.getItem(key(session.subject)) !== null) throw Error("原回执无法清理，暂不另建一笔。");
          show(null);
        });
      }),
  };
}
