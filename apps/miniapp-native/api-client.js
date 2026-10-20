'use strict';
const COPY = {
  login: '测试登录尚未就绪，请联系管理员。',
  unknown: '结果尚未确认，请先刷新核对原申请，不要再次下单。',
  storage: '暂时无法保存请求编号，请联系管理员后再操作。'
};
function problem(message, code) { const error = new Error(message); error.code = code; return error; }
function exactAmount(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(value)) throw problem('报价金额无效，请重新获取报价。', 'QUOTE');
  const [whole, fraction = ''] = value.split('.');
  const amount = whole + '.' + fraction.padEnd(2, '0');
  if (amount === '0.00') throw problem('报价金额无效，请重新获取报价。', 'QUOTE');
  return amount;
}
function validateConfig(config) {
  if (!config || config.mode !== 'isolated-api' || config.environment !== 'isolated-test') throw problem('当前未启用隔离测试连接。', 'CONFIG');
  // This candidate is only for a locally authorized isolated API, never production domains.
  if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{1,5}\/api\/?$/.test(config.baseUrl || '')) throw problem('隔离测试地址尚未就绪，请联系管理员。', 'CONFIG');
  return config.baseUrl.replace(/\/$/, '');
}
function createClient({ wx, config, getSession, makeRequestId = () => 'mini-test-' + Date.now() + '-' + Math.random().toString(36).slice(2) }) {
  const base = validateConfig(config);
  let busy = false, epoch = 0, subject = null, view = { pending: null, receipt: null, error: '', snapshot: null };
  let prepared = null, environment = null;
  const session = () => {
    const value = getSession();
    if (!value || typeof value.subject !== 'string' || !value.subject || typeof value.accessToken !== 'string' || !value.accessToken) {
      view = { pending: null, receipt: null, error: '', snapshot: null }; subject = null;
      prepared = null; environment = null;
      throw problem(COPY.login, 'LOGIN');
    }
    return { subject: value.subject, accessToken: value.accessToken };
  };
  const key = identity => 'dfc.isolated-order.v1:' + encodeURIComponent(base) + ':' + encodeURIComponent(identity.subject);
  function bindSession() {
    const identity = session();
    if (subject !== identity.subject) { subject = identity.subject; prepared = null; environment = null; view = { pending: null, receipt: null, error: '', snapshot: null }; }
    return identity;
  }
  function checkSession(identity) {
    const current = session();
    if (current.subject !== identity.subject || current.accessToken !== identity.accessToken) {
      view = { pending: null, receipt: null, error: '', snapshot: null }; subject = null;
      prepared = null; environment = null;
      throw problem('测试身份已变更，请重新刷新。', 'LOGIN');
    }
  }
  function restore(identity) {
    let value;
    try { value = wx.getStorageSync(key(identity)); } catch (_) { throw problem(COPY.storage, 'STORAGE'); }
    if (!value) return null;
    if (typeof value !== 'object' || !/^[A-Za-z0-9_-]{16,96}$/.test(value.requestId || '') || value.subject !== identity.subject || value.baseUrl !== base || !value.body || value.body.requestId !== value.requestId) throw problem('上次申请记录需要管理员核对，请勿重复下单。', 'STORAGE');
    return value;
  }
  function save(identity, value) {
    try { wx.setStorageSync(key(identity), value); } catch (_) { throw problem(COPY.storage, 'STORAGE'); }
    view.pending = value;
  }
  function clear(identity) {
    try { wx.removeStorageSync(key(identity)); } catch (_) { throw problem('回执已取得，但本机记录未清理；请刷新核对。', 'STORAGE'); }
    view.pending = null;
  }
  function request(identity, method, route, data) {
    return new Promise((resolve, reject) => {
      checkSession(identity);
      wx.request({ url: base + route, method, data, timeout: 10000,
        header: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + identity.accessToken },
        success(response) {
          try { checkSession(identity); } catch (error) { reject(error); return; }
          if (response.statusCode >= 200 && response.statusCode < 300) return resolve(response.data);
          const rejectedPreview = method === 'POST' && route === '/orders/preview' && response.statusCode === 400;
          const canExplain = response.data?.requestOutcome === 'NOT_COMMITTED' || rejectedPreview;
          const correction = canExplain && typeof response.data?.message === 'string' && /[\u4e00-\u9fff]/.test(response.data.message) ? response.data.message : null;
          const error = problem(correction || (response.data?.requestOutcome === 'NOT_COMMITTED' ? '本次订单未创建，请重新获取报价并确认金额。' : rejectedPreview ? '报价未取得，请检查服务选择后重试。' : COPY.unknown), 'HTTP');
          error.notCommitted = response.data?.requestOutcome === 'NOT_COMMITTED'; reject(error);
        },
        fail() { reject(problem(COPY.unknown, 'TRANSPORT')); }
      });
    });
  }
  async function verifyEnvironment(identity) {
    const current = await request(identity, 'GET', '/orders/environment');
    if (current?.environment !== 'isolated-test' || current.isTest !== true || !/^TEST_[A-Za-z0-9_-]{1,45}$/.test(current.storeKey || '')) {
      environment = null; view.snapshot = null;
      throw problem('当前连接未通过隔离测试核验，已阻止下单。', 'ENVIRONMENT');
    }
    environment = current;
  }
  function testOrder(order) {
    if (!environment || order?.isTest !== true || order.storeKey !== environment.storeKey) throw problem('订单缺少对应 TEST 标记，请联系管理员核对原申请。', 'ENVIRONMENT');
  }
  function receipt(order, expectedAmount) {
    if (!order || typeof order.id !== 'string' || !order.id || typeof order.orderNo !== 'string' || !order.orderNo || typeof order.status !== 'string') throw problem(COPY.unknown, 'RESPONSE');
    testOrder(order);
    if (expectedAmount !== undefined && exactAmount(String(order.totalAmount)) !== expectedAmount) throw problem('回执金额与确认金额不一致，请核对原申请。', 'RESPONSE');
    return { id: order.id, orderNo: order.orderNo, status: order.status, totalAmount: String(order.totalAmount ?? ''),
      isTest: true, storeKey: order.storeKey, nextStep: order.status === 'ASSIGNED' ? '已派单，等待陪玩接受。' : '订单已创建，请等待派单；陪玩接单后查看订单进度。', environment: 'isolated-test', realFunds: false };
  }
  async function recover(identity) {
    view.pending = restore(identity);
    if (!view.pending) return;
    const current = view.pending;
    const found = await request(identity, 'GET', '/orders/requests/' + encodeURIComponent(current.requestId));
    if (found?.requestId !== current.requestId) throw problem(COPY.unknown, 'RESPONSE');
    if (found.outcome === 'CONFIRMED') {
      view.receipt = receipt(found.order, current.body.expectedTotalAmount); clear(identity); view.error = '';
    } else {
      // A read may race an in-flight commit. NOT_FOUND never authorizes a new identity.
      view.error = '暂未查到最终结果，请稍后刷新或联系管理员核对原申请。';
    }
  }
  return {
    state() { return { ...view, busy, quote: prepared }; },
    async refresh() {
      if (busy) return { ...view, busy };
      busy = true; const generation = ++epoch;
      prepared = null;
      try {
        const identity = bindSession(); view.pending = restore(identity);
        await verifyEnvironment(identity);
        await recover(identity);
        const [companions, wallet, orders] = await Promise.all([
          request(identity, 'GET', '/orders/companions?game=DELTA_FORCE'),
          request(identity, 'GET', '/wallet/customer-summary'), request(identity, 'GET', '/orders/my')
        ]);
        checkSession(identity);
        if (generation !== epoch) throw problem('请重新刷新。', 'LOGIN');
        if (!Array.isArray(companions) || !Array.isArray(orders) || !wallet || !('wallet' in wallet)) throw problem('刷新结果不完整，请联系管理员。', 'RESPONSE');
        orders.forEach(testOrder);
        view.snapshot = { companions: companions.slice(0, 20), wallet, orders: orders.slice(0, 20) };
        if (!view.pending) view.error = '';
      } catch (error) { view.error = view.receipt ? '订单回执已保留；刷新失败，请稍后再试。' : error.message; }
      finally { busy = false; }
      return { ...view, busy };
    },
    async prepare(selection) {
      if (busy) return { ...view, busy, quote: null };
      busy = true; prepared = null;
      try {
        const identity = bindSession(); view.pending = restore(identity);
        if (view.pending) throw problem(COPY.unknown, 'PENDING');
        view.error = '';
        if (!selection || typeof selection.companionId !== 'string' || !selection.companionId || !['1','2','3','4'].includes(String(selection.hours)) || typeof selection.mode !== 'string' || !selection.mode.trim()) throw problem('请选择陪玩、模式和时长。', 'SELECTION');
        const body = { companionId: selection.companionId, game: 'DELTA_FORCE', mode: selection.mode, hours: String(selection.hours), testEnvironment: 'isolated-test' };
        await verifyEnvironment(identity);
        const quote = await request(identity, 'POST', '/orders/preview', body);
        if (quote?.customerId !== identity.subject || quote.companionId !== body.companionId || quote.game !== body.game || quote.mode !== body.mode || quote.hours !== body.hours || quote.environment !== 'isolated-test' || quote.isTest !== true || quote.storeKey !== environment.storeKey) throw problem('报价与当前测试身份或选择不一致，请重新获取。', 'QUOTE');
        prepared = Object.freeze({ ...body, customerId: identity.subject, storeKey: environment.storeKey, totalAmount: exactAmount(quote.totalAmount) });
      } catch (error) { view.error = error.message; }
      finally { busy = false; }
      return { ...view, busy, quote: prepared };
    },
    async submit(confirmedQuote) {
      if (busy) return { ...view, busy };
      busy = true;
      let identity, sent = false;
      try {
        identity = bindSession(); view.pending = restore(identity);
        if (view.pending) throw problem(COPY.unknown, 'PENDING');
        if (!prepared || confirmedQuote !== prepared || prepared.customerId !== identity.subject) throw problem('请先获取报价并确认金额。', 'QUOTE');
        view.error = ''; view.receipt = null;
        const selection = prepared;
        prepared = null;
        await verifyEnvironment(identity);
        if (selection.storeKey !== environment.storeKey) throw problem('测试店铺已变化，请重新获取报价。', 'ENVIRONMENT');
        const requestId = makeRequestId();
        if (!/^[A-Za-z0-9_-]{16,96}$/.test(requestId)) throw problem(COPY.storage, 'REQUEST_ID');
        const body = { requestId, companionId: selection.companionId, game: 'DELTA_FORCE', mode: selection.mode, hours: selection.hours, voiceTrialRequested: false, expectedTotalAmount: selection.totalAmount, testEnvironment: 'isolated-test' };
        const pending = { subject: identity.subject, baseUrl: base, requestId, body };
        save(identity, pending); sent = true;
        const order = await request(identity, 'POST', '/orders', body);
        checkSession(identity);
        view.receipt = receipt(order, selection.totalAmount); clear(identity); view.error = '';
      } catch (error) {
        if (sent && error.notCommitted && identity) { try { clear(identity); } catch (storageError) { view.error = storageError.message; } }
        view.error = view.error || error.message;
      } finally { busy = false; }
      return { ...view, busy };
    }
  };
}
module.exports = { createClient, validateConfig, exactAmount };
