export type FixedOrderKind = "guarantee" | "package";
export type FixedPreview = { customerId: string; packageId: string; companionId: string | null; totalAmount: string; mode: string;
  originalTotalAmount?: string; memberDiscount?: { level: number; name: string; rate: string } | null };
export type FixedReceipt = { id: string; orderNo: string; status: string; totalAmount: string };
export type FixedOrderState = { subject: string | null; connected: boolean; busy: boolean; pending: boolean;
  pendingKind: FixedOrderKind | null; preview: FixedPreview | null; receipt: FixedReceipt | null; error: string };
type Body = { requestId: string; packageId: string; companionId?: string; expectedTotalAmount: string; notes?: string };
type Journal = { version: 1; subject: string; kind: FixedOrderKind; body: Body; preview: FixedPreview; receipt?: FixedReceipt };
type Identity = { token: string; subject: string };
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Transport = (path: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
type Fault = Error & { notCommitted?: boolean };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const amount = (value: unknown): value is string => typeof value === "string" && /^\d+(?:\.\d{1,2})?$/.test(value) && Number(value) > 0 && Number.isFinite(Number(value));
const idValid = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{16,96}$/.test(value);
const empty = (): FixedOrderState => ({ subject: null, connected: false, busy: false, pending: false, pendingKind: null, preview: null, receipt: null, error: "" });

/** A single unresolved fixed-price order per verified customer, shared by the two fixed-price pages. */
export function createFixedOrderClient({ kind, storage, fetcher, getToken, makeRequestId, scope }: {
  kind: FixedOrderKind; storage: StorageLike; fetcher: Transport; getToken(): string | null; makeRequestId(): string; scope: string;
}) {
  let view = empty(), identity: Identity | null = null, busy = false, lastJournal: Journal | null = null;
  const state = (): FixedOrderState => ({ ...view, busy });
  const key = (subject: string) => `dfc.web-fixed-order.v1:${encodeURIComponent(scope)}:${encodeURIComponent(subject)}`;
  const current = (session: Identity) => getToken() === session.token && identity?.subject === session.subject;
  function check(session: Identity) {
    if (!current(session)) { identity = null; view = empty(); throw new Error("登录身份已变化，请回原账号核对原申请。"); }
  }
  async function fetchData(path: string, init: RequestInit) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    try { const response = await fetcher(path, { ...init, signal: controller.signal }); return { response, data: await response.json() }; }
    catch (error) { if (controller.signal.aborted) throw new Error("连接超时，原申请仍需核对，请勿重新下单。"); throw error; }
    finally { clearTimeout(timer); }
  }
  async function request(session: Identity, method: string, route: string, body?: Body | { packageId: string; companionId?: string }) {
    check(session);
    const { response, data } = await fetchData(`/api${route}`, { method, cache: "no-store",
      headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    check(session);
    if (!response.ok) {
      const value = object(data);
      const error: Fault = new Error(response.status === 400 && typeof value.message === "string" ? value.message
        : "服务未返回可靠结果，请核对原申请，不要重新下单。");
      error.notCommitted = response.status === 400 && value.requestOutcome === "NOT_COMMITTED";
      if ([401, 403].includes(response.status)) { identity = null; view = empty(); error.message = "客户身份验证未通过，请重新登录后核对原申请。"; }
      throw error;
    }
    return data;
  }
  async function authenticate() {
    const token = getToken();
    if (!token) { identity = null; view = empty(); throw new Error("请先登录客户账号。"); }
    if (identity?.token !== token) { identity = null; view = empty(); }
    const { response, data } = await fetchData("/api/auth/me", { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
    const user = object(object(data).user);
    if (getToken() !== token || !response.ok || user.role !== "CUSTOMER" || typeof user.id !== "string" || !user.id) {
      identity = null; view = empty(); throw new Error("客户身份验证未通过，请重新登录后核对原申请。");
    }
    if (identity && identity.subject !== user.id) view = empty();
    identity = { token, subject: user.id };
    view.subject = user.id; view.connected = true;
    return identity;
  }
  function restore(session: Identity): Journal | null {
    let raw: string | null;
    try { raw = storage.getItem(key(session.subject)); }
    catch { throw new Error("无法读取原申请记录，暂不提交新订单，请联系管理员核对。"); }
    if (!raw) return null;
    let journal: Journal;
    try { journal = JSON.parse(raw) as Journal; } catch { throw new Error("原申请记录异常，请联系管理员核对，勿重新下单。"); }
    const body = journal?.body, preview = journal?.preview;
    if (journal.version !== 1 || journal.subject !== session.subject || !["guarantee", "package"].includes(journal.kind)
      || !body || !idValid(body.requestId) || typeof body.packageId !== "string" || !body.packageId || !amount(body.expectedTotalAmount)
      || (body.companionId !== undefined && (typeof body.companionId !== "string" || !body.companionId))
      || (body.notes !== undefined && typeof body.notes !== "string") || !preview || preview.customerId !== session.subject
      || preview.packageId !== body.packageId || preview.companionId !== (body.companionId ?? null)
      || preview.totalAmount !== body.expectedTotalAmount || typeof preview.mode !== "string") {
      throw new Error("原申请记录异常，请联系管理员核对，勿重新下单。");
    }
    if (journal.receipt !== undefined) validReceipt(journal.receipt, journal);
    return journal;
  }
  function hold(journal: Journal) {
    lastJournal = journal;
    view.pending = true; view.pendingKind = journal.kind; view.preview = journal.preview; view.receipt = null;
  }
  function save(session: Identity, journal: Journal) {
    check(session);
    try {
      const raw = JSON.stringify(journal); storage.setItem(key(session.subject), raw);
      if (storage.getItem(key(session.subject)) !== raw) throw new Error("Write not retained");
    } catch { throw new Error(journal.receipt ? "已取得有效订单回执，但保存未完成，请刷新核对，暂不创建新订单。"
      : "原申请无法可靠保存，本次尚未发送，请勿提交新订单。"); }
  }
  function validReceipt(data: unknown, journal: Journal): FixedReceipt {
    const value = object(data);
    if (typeof value.id !== "string" || !value.id || typeof value.orderNo !== "string" || !value.orderNo || typeof value.status !== "string" || !value.status
      || !amount(String(value.totalAmount ?? "")) || Number(value.totalAmount) !== Number(journal.body.expectedTotalAmount)
      || (value.customerId !== undefined && value.customerId !== journal.subject)) throw new Error("尚未取得原申请的有效回执，请继续核对。");
    return { id: value.id, orderNo: value.orderNo, status: value.status, totalAmount: String(value.totalAmount) };
  }
  function finish(session: Identity, journal: Journal, data: unknown) {
    check(session); const receipt = validReceipt(data, journal);
    const saved = restore(session);
    if (!saved || saved.body.requestId !== journal.body.requestId) throw new Error("申请记录已变化，请刷新核对，勿重新下单。");
    save(session, { ...journal, receipt }); lastJournal = { ...journal, receipt };
    view.receipt = receipt; view.pending = false; view.pendingKind = null; view.preview = null;
  }
  async function recover(session: Identity, journal: Journal) {
    // This confirms the original submission, while the order-record page provides its latest service state.
    // Retain the acknowledgement so another tab/reload can reconcile without losing the original receipt.
    if (journal.receipt) {
      check(session); lastJournal = journal; view.receipt = validReceipt(journal.receipt, journal); view.pending = false; view.pendingKind = null; view.preview = null;
      return true;
    }
    hold(journal);
    const result = object(await request(session, "GET", `/orders/requests/${encodeURIComponent(journal.body.requestId)}`));
    if (result.requestId !== journal.body.requestId) throw new Error("原申请回执编号不匹配，请联系管理员核对。");
    if (result.outcome === "CONFIRMED") { finish(session, journal, result.order); return true; }
    if (result.outcome !== "UNRESOLVED") throw new Error("原申请结果仍不明确，请联系管理员核对。");
    view.error = "原申请尚未确认。可以继续核对，或用原编号重试；当前不能修改服务或另建订单。";
    return false;
  }
  async function post(session: Identity, journal: Journal, firstAttempt: boolean) {
    try { finish(session, journal, await request(session, "POST", `/orders/${journal.kind}`, journal.body)); }
    catch (error) {
      // A later rejection cannot prove an earlier lost response did not commit (for example after an environment change).
      if (firstAttempt && (error as Fault).notCommitted && current(session)) {
        storage.removeItem(key(session.subject)); view.pending = false; view.pendingKind = null; view.preview = null;
      }
      throw error;
    }
  }
  async function run(action: () => Promise<void>) {
    if (busy) return state();
    busy = true; view.error = "";
    try { await action(); } catch (error) { view.error = error instanceof Error ? error.message : "原申请结果待核对，请勿重新下单。"; }
    finally {
      busy = false;
      if (identity && !current(identity)) { identity = null; view = { ...empty(), error: "登录身份已变化，请回原账号核对原申请。" }; }
    }
    return state();
  }
  function canEdit() {
    if (identity && !current(identity)) { identity = null; view = { ...empty(), error: "登录身份已变化，请刷新核对。" }; return false; }
    if (busy || !identity || !view.connected || view.pending || view.receipt) return false;
    try { const journal = restore(identity); if (journal) {
      if (journal.receipt) { view.receipt = journal.receipt; view.pending = false; view.pendingKind = null; view.preview = null; }
      else hold(journal);
      return false;
    } }
    catch (error) { view.error = (error as Error).message; return false; }
    return true;
  }
  return {
    state, canEdit,
    change() { if (!canEdit()) return false; view.preview = null; view.error = ""; return true; },
    refresh() { return run(async () => {
      const session = await authenticate(), journal = restore(session);
      if (journal) await recover(session, journal);
      else if (view.pending && lastJournal?.subject === session.subject) {
        // Another tab may explicitly begin a new order after confirming this one. Reconcile the old
        // in-memory request without resurrecting the journal that the operator already cleared.
        const old = lastJournal, result = object(await request(session, "GET", `/orders/requests/${encodeURIComponent(old.body.requestId)}`));
        if (result.requestId !== old.body.requestId || result.outcome !== "CONFIRMED") throw new Error("原申请仍待核对，请联系管理员，勿重新下单。");
        const receipt = validReceipt(result.order, old); lastJournal = { ...old, receipt };
        view.receipt = receipt; view.pending = false; view.pendingKind = null; view.preview = null;
      }
    }); },
    beginNew() { return run(async () => {
      const session = await authenticate(), journal = restore(session);
      const confirmed = journal ?? (lastJournal?.subject === session.subject && lastJournal.receipt ? lastJournal : null);
      if (!confirmed?.receipt) throw new Error("原申请尚未确认，不能另建订单，请先刷新核对。");
      validReceipt(confirmed.receipt, confirmed);
      try {
        storage.removeItem(key(session.subject));
        if (storage.getItem(key(session.subject)) !== null) throw new Error("Removal not retained");
      } catch { throw new Error("原单回执尚未清理，暂不创建新订单，请刷新核对。"); }
      lastJournal = null; view = { ...empty(), subject: session.subject, connected: true };
    }); },
    prepare(selection: { packageId: string; companionId?: string }) { return run(async () => {
      const session = await authenticate(), journal = restore(session);
      if (journal) { await recover(session, journal); throw new Error("请先核对原申请，或在已确认回执上选择另下一单。"); }
      if (view.receipt) return;
      view.preview = null;
      if (!selection.packageId) throw new Error("请先选择服务档位。");
      const data = object(await request(session, "POST", `/orders/${kind}/preview`, selection));
      if (data.customerId !== session.subject || data.packageId !== selection.packageId || data.companionId !== (selection.companionId || null)
        || !amount(data.totalAmount) || typeof data.mode !== "string" || !data.mode) throw new Error("报价返回不完整，请重新核对金额。");
      view.preview = data as FixedPreview;
    }); },
    submit(notes: string) { return run(async () => {
      const preview = view.preview;
      if (!preview || view.receipt) return;
      const session = await authenticate(), prior = restore(session);
      if (prior) { await recover(session, prior); throw new Error("请先核对原申请，或在已确认回执上选择另下一单。"); }
      if (preview.customerId !== session.subject) throw new Error("账号已变化，请重新核对订单。");
      if (notes.length > 200) throw new Error("备注不能超过 200 个字。");
      const requestId = makeRequestId(); if (!idValid(requestId)) throw new Error("申请编号无效，本次尚未提交。");
      const body: Body = { requestId, packageId: preview.packageId, ...(preview.companionId ? { companionId: preview.companionId } : {}),
        expectedTotalAmount: preview.totalAmount, ...(notes.trim() ? { notes: notes.trim() } : {}) };
      const journal: Journal = { version: 1, subject: session.subject, kind, body, preview };
      save(session, journal); hold(journal); await post(session, journal, true);
    }); },
    retry() { return run(async () => {
      const session = await authenticate(), journal = restore(session);
      if (!journal) throw new Error("没有待核对的原申请，请先核对订单列表。");
      if (!await recover(session, journal)) { view.error = ""; await post(session, journal, false); }
    }); },
  };
}
