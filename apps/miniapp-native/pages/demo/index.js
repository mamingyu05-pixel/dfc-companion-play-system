const { presentOrder } = require('../../order-view.js');
const model = require('../../model.js');
const config = require('../../api-config.js');
const { createClient } = require('../../api-client.js');
const { createTestSession } = require('../../test-session.js');
const { createWechatSession } = require('../../wechat-session.js');
const simulation = config.mode === 'simulation';
const realMode = config.mode === 'wechat-api';
Page({
  data: { simulation, realMode, wechatUser: null, wechatMessage: '', testBaseUrl: '', pairingCode: '', sessionStage: 'idle', sessionMessage: '', tab: 'service', companions: simulation ? model.companions : [], selectedId: simulation ? model.companions[0].id : '',
    modes: simulation ? ['娱乐', '排位'] : ['烽火地带', '全面战场'], modeIndex: 0, durations: [1,2,3,4], hoursIndex: 0, totalAmount: simulation ? 50 : '',
    busy: false, pending: false, receipt: null, message: '', store: simulation ? model.initial() : { orders: [], availableBalance: '', frozenBalance: '' } },
  onLoad() {
    this.closed = false;
    if (realMode) {
      try { this.wechatClient = createWechatSession({ wx, config }); }
      catch (error) { this.setData({ wechatMessage: error.message }); }
      return;
    }
    if (this.data.simulation) return;
    try { this.client = createClient({ wx, config, getSession: () => getApp().globalData.testApiSession }); this.refresh(); }
    catch (error) { this.setData({ message: error.message }); }
  },
  onUnload() { this.closed = true; this.wechatClient?.logout(); this.pairing?.close(); this.clearOwnedSession(); },
  onShow() {
    if (realMode && this.data.wechatUser && !this.wechatClient?.getSession()) this.setData({ wechatUser: null, wechatMessage: '登录已过期，请重新登录。' });
    if (!realMode && !this.data.simulation && this.client) this.refresh();
  },
  async loginWechat() {
    if (!realMode || this.data.busy || !this.wechatClient) return;
    this.setData({ busy: true, wechatUser: null, wechatMessage: '' });
    try {
      const result = await this.wechatClient.login();
      if (!this.closed) this.setData({ wechatUser: result.user, wechatMessage: '微信客户身份已登录。订单与支付尚未接通。' });
    } catch (error) { if (!this.closed) this.setData({ wechatMessage: error.message }); }
    finally { if (!this.closed) this.setData({ busy: false }); }
  },
  logoutWechat() {
    if (!realMode || this.data.busy) return;
    this.wechatClient?.logout();
    this.setData({ wechatUser: null, wechatMessage: '已退出当前小程序会话。' });
  },
  changeTestAddress(e) { if (this.data.sessionStage === 'idle') this.setData({ testBaseUrl: e.detail.value }); },
  clearOwnedSession() {
    if (this.ownedTestSession && getApp().globalData.testApiSession === this.ownedTestSession) getApp().globalData.testApiSession = null;
    this.ownedTestSession = null;
  },
  sessionAlive() {
    if (!this.ownedTestSession || Date.now() < this.ownedTestSession.expiresAt) return true;
    this.clearOwnedSession(); this.client = null; this.pairing?.close();
    this.setData({ sessionStage: 'expired', pairingCode: '', sessionMessage: '本次 TEST 会话已到期，请结束本窗口。', busy: false });
    return false;
  },
  async connectTest() {
    if (realMode) return;
    if (this.data.busy || this.data.sessionStage !== 'idle') return;
    this.setData({ busy: true, sessionMessage: '' });
    try {
      this.pairing = createTestSession({ wx, baseUrl: this.data.testBaseUrl });
      this.clearOwnedSession(); this.client = null;
      this.setData({ simulation: false, companions: [], selectedId: '', totalAmount: '', receipt: null, message: '',
        store: { orders: [], availableBalance: '', frozenBalance: '' }, modes: ['烽火地带', '全面战场'], sessionStage: 'requesting' });
      const result = await this.pairing.begin();
      if (this.closed) return;
      this.setData({ pairingCode: result.pairingCode, sessionStage: 'pending', sessionMessage: '请在本次 TEST 控制台输入 APPROVE 加此配对码，再点核对授权。这不是微信登录。' });
    } catch (error) { if (!this.closed) this.setData({ sessionStage: 'failed', sessionMessage: error.message }); }
    finally { if (!this.closed) this.setData({ busy: false }); }
  },
  async claimTest() {
    if (realMode) return;
    if (this.data.busy || this.data.sessionStage !== 'pending') return;
    this.setData({ busy: true });
    try {
      const session = await this.pairing.claim();
      if (this.closed) return;
      if (!session) { this.setData({ sessionMessage: '尚未获本机操作者批准；没有后台身份，不会下单。' }); return; }
      this.ownedTestSession = session; getApp().globalData.testApiSession = session;
      this.client = createClient({ wx, config: this.pairing.config, getSession: () => getApp().globalData.testApiSession });
      this.setData({ pairingCode: '', sessionStage: 'connected', sessionMessage: '临时 TEST 会话已连接；无真实资金，到期即停止。' });
      this.renderClient(await this.client.refresh());
    } catch (error) { if (!this.closed) this.setData({ sessionStage: 'failed', sessionMessage: error.message }); }
    finally { if (!this.closed) this.setData({ busy: false }); }
  },
  disconnectTest() {
    if (realMode) return;
    if (this.data.busy) return;
    this.pairing?.close(); this.clearOwnedSession(); this.client = null;
    this.setData({ sessionStage: 'idle', pairingCode: '', sessionMessage: '已断开；未清除未决申请记录。控制台输入 STOP 可关闭本次 API/PG。',
      companions: [], selectedId: '', store: { orders: [], availableBalance: '', frozenBalance: '' } });
  },
  select(e) { if (this.data.busy || this.data.pending) return; this.setData({ selectedId: e.currentTarget.dataset.id }); this.quote(); },
  changeMode(e) { if (this.data.busy || this.data.pending) return; this.setData({ modeIndex: Number(e.detail.value) }); this.quote(); },
  changeHours(e) { if (this.data.busy || this.data.pending) return; this.setData({ hoursIndex: Number(e.detail.value) }); this.quote(); },
  quote() { const c = this.data.companions.find(c => c.id === this.data.selectedId); this.setData({ totalAmount: c ? Number(c.price) * this.data.durations[this.data.hoursIndex] : '' }); },
  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }); },
  guide() {
    wx.showModal({ title: '验收与售后说明', showCancel: false, content: (this.data.simulation ? '当前仅在内存模拟，未连接任何业务API。' : '当前为隔离测试入口，不使用真实资金。') + '订单与验收请使用客户网页端 /customer/orders/。评价尚未实现。退款经客服与管理员人工裁决，没有客户自助退款申请按钮；投诉可在客户网页端提交。投诉发起数不会直接扣分或判责。' });
  },
  renderClient(state) {
    if (this.closed) return;
    const update = { busy: state.busy, pending: !!state.pending, receipt: state.receipt ? { ...state.receipt, ...presentOrder(state.receipt.status) } : null, message: state.error };
    if (state.receipt) update.tab = 'orders';
    if (state.snapshot) {
      const snapshot = state.snapshot;
      update.companions = snapshot.companions.map(c => ({ id: c.id, nickname: c.nickname, price: c.pricePerHour }));
      const wallet = snapshot.wallet.wallet;
      update.store = { availableBalance: wallet?.availableBalance ?? '0', frozenBalance: wallet?.frozenBalance ?? '0',
        orders: snapshot.orders.map(o => ({ id: o.id, orderNo: o.orderNo, status: o.status, ...presentOrder(o.status), mode: o.mode, hours: o.hours, totalAmount: o.totalAmount })) };
      if (!update.companions.some(c => c.id === this.data.selectedId) && !state.pending) update.selectedId = update.companions[0]?.id || '';
    } else {
      update.companions = []; update.selectedId = '';
      update.store = { orders: [], availableBalance: '', frozenBalance: '' };
    }
    this.setData(update); this.quote();
  },
  async refresh() {
    if (realMode) return;
    if (!this.sessionAlive()) return;
    if (this.data.simulation || !this.client || this.data.busy) return;
    this.setData({ busy: true }); this.renderClient(await this.client.refresh());
  },
  async pay() {
    if (realMode) { this.setData({ wechatMessage: '订单与微信支付尚未接通，不会提交或扣款。' }); return; }
    if (!this.sessionAlive()) return;
    if (this.data.busy || this.data.pending) return;
    if (!this.data.simulation && !this.client) { this.setData({ message: '隔离测试连接尚未就绪，请联系管理员。' }); return; }
    const selection = { companionId: this.data.selectedId, hours: this.data.durations[this.data.hoursIndex], mode: this.data.modes[this.data.modeIndex] };
    this.setData({ busy: true, message: '' });
    let confirmedQuote;
    if (!this.data.simulation) {
      const quoted = await this.client.prepare(selection);
      if (this.closed) return;
      if (!quoted.quote) { this.renderClient(quoted); return; }
      confirmedQuote = quoted.quote;
    }
    wx.showModal({ title: this.data.simulation ? '确认模拟余额付款' : '确认隔离测试订单',
      content: `${this.data.companions.find(c => c.id === selection.companionId)?.nickname || '所选陪玩'} · ${selection.mode} · ${selection.hours} 小时 · ${this.data.simulation ? '参考' : '确认冻结'} ¥${this.data.simulation ? this.data.totalAmount : confirmedQuote.totalAmount}。\n` + (this.data.simulation ? '仅本机虚构数据，模拟冻结 ¥' + this.data.totalAmount + '，不调用微信支付或真实API。'
        : '仅使用隔离测试账本，无真实资金。价格变化时不会创建订单，需重新确认。结果不明时请先刷新核对。'),
      confirmText: this.data.simulation ? '模拟付款' : '提交测试单',
      success: async result => {
        if (this.closed) return;
        if (!result.confirm) { if (!this.closed) this.setData({ busy: false }); return; }
        if (!this.data.simulation) { this.renderClient(await this.client.submit(confirmedQuote)); return; }
        try { const store = model.createOrder(this.data.store, { ...selection, clientRequestId: 'local-' + (this.data.store.orders.length + 1) });
          this.setData({ store, tab: 'orders', receipt: { orderNo: store.orders[0].id, nextStep: '仅模拟成单，不会发送真实派单。' }, busy: false });
        } catch (error) { this.setData({ message: error.message, busy: false }); }
      },
      fail: () => { if (!this.closed) this.setData({ busy: false, message: '确认未完成，订单没有提交。' }); }
    });
  }
});
