// Uses the validated native client's requestId journal/recovery protocol, with the existing web session.
// Requests are same-origin; tokens are never persisted in the journal or substituted with test identities.
export type Selection = { companionId: string; mode: string; hours: string };
export type Preview = Selection & { customerId: string; game: string; unitPrice: string; totalAmount: string };
export type OrderReceipt = { id: string; orderNo: string; status: string; totalAmount: string; mode?: string; hours?: string };
export type Companion = { id: string; nickname: string; pricePerHour: string; onlineStatus: string };
export type OrderView = { busy: boolean; connected: boolean; pending: boolean; error: string; companions: Companion[]; preview: Preview | null; receipt: OrderReceipt | null; orders: OrderReceipt[]; availableBalance: string };
type Body = Selection & { requestId: string; game: string; expectedTotalAmount: string; voiceTrialRequested: false };
type Journal = { subject: string; requestId: string; body: Body; receipt?: OrderReceipt };
type Session = { token: string; subject: string };
type Transport = (path: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
type Fault = Error & { notCommitted?: boolean };
const empty = (): OrderView => ({ busy: false, connected: false, pending: false, error: "", companions: [], preview: null, receipt: null, orders: [], availableBalance: "" });
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const amount = (value: unknown) => typeof value === "string" && /^\d+(?:\.\d{1,2})?$/.test(value) && Number.isFinite(Number(value));
const requestIdValid = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{16,96}$/.test(value);
export function createOrderClient({ fetcher, storage, getToken, makeRequestId, scope }: {
  fetcher: Transport; storage: Pick<Storage, "getItem" | "setItem" | "removeItem">; getToken(): string | null; makeRequestId(): string; scope: string;
}) {
  let view = empty(), session: Session | null = null, busy = false, previewAt = 0;
  const state = () => ({ ...view, busy });
  const key = (identity: Session) => `dfc.web-order.v1:${encodeURIComponent(scope)}:${encodeURIComponent(identity.subject)}`;
  async function fetchData(path: string, init: RequestInit) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    try { const response = await fetcher(path, { ...init, signal: controller.signal }); return { response, data: await response.json() }; }
    catch (error) { if (controller.signal.aborted) throw new Error("连接超时，请刷新核对原申请，不要重复下单。"); throw error; }
    finally { clearTimeout(timer); }
  }
  function check(identity: Session) {
    if (getToken() !== identity.token || session?.subject !== identity.subject) {
      view = empty(); session = null; throw new Error("登录身份已变化，请重新刷新核对。");
    }
  }
  async function request(identity: Session, method: string, route: string, body?: unknown) {
    check(identity);
    const { response, data } = await fetchData(`/api${route}`, { method, cache: "no-store", headers: { Authorization: `Bearer ${identity.token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    check(identity);
    if (!response.ok) {
      if ([401,403].includes(response.status)) { view = empty(); session = null; throw new Error("客户身份验证未通过，请重新登录后核对原申请。"); }
      const value = object(data);
      // Preview is read-only: a known 400 can explain how to correct the selection without creating a receipt claim.
      const rejectedPreview = method === "POST" && route === "/orders/preview" && response.status === 400;
      const error: Fault = new Error(value.requestOutcome === "NOT_COMMITTED" || rejectedPreview
        ? (typeof value.message === "string" && /[\u4e00-\u9fff]/.test(value.message) ? value.message : rejectedPreview ? "报价未取得，请检查服务选择后重试。" : "本次订单未创建，请检查余额和选择后重新核对。")
        : "服务暂未返回可靠结果，请先刷新核对原申请，不要重复下单。");
      error.notCommitted = value.requestOutcome === "NOT_COMMITTED"; throw error;
    }
    return data;
  }
  async function authenticate() {
    const token = getToken();
    if (!token) { view = empty(); session = null; throw new Error("请先登录客户账号，当前未连接订单服务。"); }
    if (session?.token !== token) { view = empty(); session = null; }
    const { response, data: responseData } = await fetchData("/api/auth/me", { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
    const data = object(responseData), user = object(data.user);
    if (getToken() !== token || !response.ok || user.role !== "CUSTOMER" || typeof user.id !== "string" || !user.id) {
      view = empty(); session = null; throw new Error("客户身份验证未通过，请重新登录；没有提交订单。");
    }
    if (session && session.subject !== user.id) view = empty();
    session = { token, subject: user.id }; view.connected = true; return session;
  }
  function restore(identity: Session): Journal | null {
    let raw: string | null;
    try { raw = storage.getItem(key(identity)); } catch { throw new Error("无法读取上次申请，请联系管理员核对，暂不重新下单。"); }
    if (!raw) return null;
    let saved: Journal;
    try { saved = JSON.parse(raw) as Journal; } catch { throw new Error("上次申请记录异常，请联系管理员核对。"); }
    if (!requestIdValid(saved?.requestId) || saved.subject !== identity.subject || saved.body?.requestId !== saved.requestId
      || !saved.body.companionId || !amount(saved.body.expectedTotalAmount)) throw new Error("上次申请记录异常，请联系管理员核对。");
    return saved;
  }
  function save(identity: Session, journal: Journal) {
    check(identity);
    try { storage.setItem(key(identity), JSON.stringify(journal)); } catch { throw new Error("申请记录暂时无法保存，请先刷新核对，不重复提交。"); }
  }
  function receipt(data: unknown, expected: string): OrderReceipt {
    const value = object(data);
    if (typeof value.id !== "string" || !value.id || typeof value.orderNo !== "string" || !value.orderNo || typeof value.status !== "string"
      || !amount(String(value.totalAmount ?? "")) || Number(value.totalAmount) !== Number(expected)) throw new Error("未取得本笔订单的可靠回执，请先刷新核对。");
    return { id: value.id, orderNo: value.orderNo, status: value.status, totalAmount: String(value.totalAmount), mode: typeof value.mode === "string" ? value.mode : undefined, hours: typeof value.hours === "string" ? value.hours : undefined };
  }
  async function recover(identity: Session) {
    const journal = restore(identity); view.pending = Boolean(journal && !journal.receipt);
    if (!journal) return;
    const result = object(await request(identity, "GET", `/orders/requests/${encodeURIComponent(journal.requestId)}`));
    if (result.requestId !== journal.requestId || result.outcome !== "CONFIRMED") { view.pending = true; throw new Error("原申请结果仍待核对，请稍后刷新或联系管理员，不要再次提交。"); }
    view.receipt = receipt(result.order, journal.body.expectedTotalAmount);
    save(identity, { ...journal, receipt: view.receipt }); view.pending = false;
  }
  async function run(action: () => Promise<void>) {
    if (busy) return state(); busy = true; view.error = "";
    try { await action(); }
    catch (error) { view.error = `${view.receipt ? "原订单回执已保留。" : ""}${error instanceof Error ? error.message : "操作未完成，请刷新核对。"}`; }
    finally { busy = false; }
    return state();
  }
  return {
    state,
    customerSubject(): string | null {
      try { return session && view.connected && getToken() === session.token ? session.subject : null; }
      catch { return null; }
    },
    beginNew() { if (!view.pending && !busy) { view.receipt = null; view.preview = null; } return state(); },
    cancelPreview() { view.preview = null; return state(); },
    refresh() { return run(async () => {
      const identity = await authenticate(); await recover(identity);
      const [companions, walletValue, orders] = await Promise.all([request(identity,"GET","/orders/companions?game=DELTA_FORCE"),request(identity,"GET","/wallet/customer-summary"),request(identity,"GET","/orders/my")]);
      if (!Array.isArray(companions) || !Array.isArray(orders)) throw new Error("列表返回不完整，请刷新核对。");
      const wallet = object(object(walletValue).wallet);
      view.companions = companions as Companion[]; view.orders = orders as OrderReceipt[]; view.availableBalance = String(wallet.availableBalance ?? "0");
    }); },
    prepare(selection: Selection) { return run(async () => {
      const identity = await authenticate(); const journal = restore(identity);
      if (journal && !journal.receipt) { view.pending = true; throw new Error("请先刷新核对原申请，不重复下单。"); }
      view.preview = null;
      if (!selection.companionId || !selection.mode || !["1","2","3","4"].includes(selection.hours)) throw new Error("请选择陪玩、模式和时长。");
      const data = object(await request(identity,"POST","/orders/preview",{...selection,game:"DELTA_FORCE"}));
      if (data.customerId !== identity.subject || data.companionId !== selection.companionId || data.mode !== selection.mode || String(data.hours) !== selection.hours
        || data.game !== "DELTA_FORCE" || !amount(data.totalAmount) || !amount(data.unitPrice)) throw new Error("未取得可核对的价格，订单尚未提交。");
      view.preview = { ...selection, customerId: identity.subject, game: "DELTA_FORCE", unitPrice: String(data.unitPrice), totalAmount: String(data.totalAmount) }; previewAt = Date.now();
    }); },
    submit() { return run(async () => {
      const preview = view.preview;
      if (!preview || Date.now()-previewAt>120000) { view.preview = null; throw new Error("请重新核对金额后提交。"); }
      const identity = await authenticate();
      if (preview.customerId !== identity.subject) throw new Error("账号已变化，请重新核对订单。");
      const prior = restore(identity);
      if (prior && !prior.receipt) { view.pending = true; throw new Error("请先刷新核对原申请，不重复提交。"); }
      const requestId = makeRequestId(); if (!requestIdValid(requestId)) throw new Error("无法保存申请编号，本次未提交。");
      const body: Body = {requestId,companionId:preview.companionId,game:preview.game,mode:preview.mode,hours:preview.hours,expectedTotalAmount:preview.totalAmount,voiceTrialRequested:false};
      const journal: Journal = {subject:identity.subject,requestId,body};
      save(identity,journal); view.pending = true; view.receipt = null; view.preview = null;
      try {
        const result = await request(identity,"POST","/orders",body);
        view.receipt = receipt(result,preview.totalAmount); save(identity,{...journal,receipt:view.receipt}); view.pending = false;
      } catch(error) {
        if ((error as Fault).notCommitted) { check(identity);storage.removeItem(key(identity));view.pending=false; }
        throw error;
      }
    }); }
  };
}
