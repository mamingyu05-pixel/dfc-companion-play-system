'use strict';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function createTestSession({ wx, baseUrl, now = Date.now }) {
  const match = /^http:\/\/127\.0\.0\.1:([0-9]{1,5})\/api\/?$/.exec(baseUrl || '');
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) throw Error('请填写本次控制台显示的 127.0.0.1 TEST 地址。');
  const base = baseUrl.replace(/\/$/, '');
  let pending = null, busy = false, closed = false;
  function request(route) {
    return new Promise((resolve, reject) => wx.request({ url: base + route, method: 'POST', timeout: 5000,
      header: { 'Content-Type': 'application/json', 'X-DFC-Test-Session': '1' }, data: {},
      success: response => resolve(response), fail: () => reject(Error('本机 TEST 服务未连接；请核对窗口和平台网络提示。')) }));
  }
  return {
    config: Object.freeze({ mode: 'isolated-api', baseUrl: base, environment: 'isolated-test' }),
    close() { closed = true; pending = null; },
    async begin() {
      if (busy || closed || pending) throw Error('已有申请，请核对授权或断开后再申请。');
      busy = true;
      try {
        const response = await request('/test-session/request'), value = response.data;
        if (closed) throw Error('已断开 TEST 会话。');
        if (response.statusCode !== 202 || value?.status !== 'pending' || value.environment !== 'isolated-test' ||
            value.realWxLogin !== false || !UUID.test(value.requestId) || !/^[0-9]{6}$/.test(value.pairingCode) ||
            !Number.isFinite(value.expiresAt) || value.expiresAt <= now() || value.expiresAt > now() + 30000) throw Error('TEST 申请未就绪或已过期；不执行登录。');
        pending = { id: value.requestId, expiresAt: value.expiresAt };
        return { pairingCode: value.pairingCode, expiresAt: value.expiresAt };
      } finally { busy = false; }
    },
    async claim() {
      if (closed || busy || !pending || pending.expiresAt <= now()) throw Error('TEST 申请已过期或尚未建立。');
      busy = true;
      try {
        const response = await request('/test-session/claim/' + pending.id), value = response.data;
        if (closed) throw Error('已断开 TEST 会话。');
        if (response.statusCode === 202 && value?.status === 'pending' && value.environment === 'isolated-test') return null;
        pending = null; // A lost/invalid grant must not be replayed blindly.
        if (response.statusCode !== 200 || value?.status !== 'granted' || value.environment !== 'isolated-test' || value.realWxLogin !== false ||
            !UUID.test(value.subject) || !/^TEST_[A-Za-z0-9_-]+$/.test(value.storeKey) || typeof value.accessToken !== 'string' || !value.accessToken ||
            !Number.isFinite(value.expiresAt) || value.expiresAt <= now() || value.expiresAt > now() + 90000) throw Error('TEST 授权未通过，请停止本次连接。');
        return { subject: value.subject, accessToken: value.accessToken, expiresAt: value.expiresAt };
      } finally { busy = false; }
    }
  };
}
module.exports = { createTestSession };
