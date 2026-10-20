'use strict';
function problem(message) { return new Error(message); }
function validateWechatConfig(config) {
  if (!config || config.mode !== 'wechat-api' || config.environment !== 'wechat' ||
      !/^wx[0-9a-f]{16}$/.test(config.appId || '')) throw problem('微信登录配置尚未就绪。');
  // A compile-time HTTPS API address, never the editable local TEST address.
  const match = /^https:\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)(?::443)?\/api\/?$/.exec(config.baseUrl || '');
  if (!match || /(^|\.)(localhost|local|internal|invalid)$/.test(match[1]) ||
      !/[a-z]{2,}$/.test(match[1].split('.').pop())) throw problem('微信登录需要已批准的 HTTPS 业务地址。');
  return config.baseUrl.replace(/\/$/, '');
}

function createWechatSession({ wx, config, now = () => Date.now() }) {
  const base = validateWechatConfig(config);
  let session = null, generation = 0, busy = false;
  const current = () => {
    if (session && now() >= session.expiresAt) session = null;
    return session ? { ...session, user: { ...session.user } } : null;
  };
  function request(method, route, data, token) {
    return new Promise((resolve, reject) => {
      try { wx.request({ url: base + route, method, data, timeout: 10000,
        header: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        success(response) {
          if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data);
          else reject(problem(response.statusCode === 503 ? '微信登录暂不可用，请联系管理员。' : '登录未完成，请重新登录。'));
        },
        fail() { reject(problem('无法连接登录服务，请稍后重新登录。')); }
      }); } catch (_) { reject(problem('无法连接登录服务，请稍后重新登录。')); }
    });
  }
  return {
    getSession: current,
    logout() { generation++; session = null; busy = false; },
    async login() {
      if (busy) throw problem('正在登录，请稍候。');
      busy = true; session = null; const attempt = ++generation;
      const check = () => { if (attempt !== generation) throw problem('登录已取消。'); };
      try {
        let account;
        try { account = wx.getAccountInfoSync(); } catch (_) { throw problem('无法确认当前小程序身份。'); }
        if (account?.miniProgram?.appId !== config.appId) throw problem('当前小程序与登录配置不匹配。');
        const capability = await request('GET', '/auth/wechat/config'); check();
        if (capability?.mode !== 'wechat-api' || capability.enabled !== true || capability.appId !== config.appId ||
            capability.payment !== 'NOT_CONNECTED' || capability.nativeOrdering !== 'NOT_CONNECTED') throw problem('服务端微信登录配置尚未就绪。');
        const code = await new Promise((resolve, reject) => { try { wx.login({ timeout: 10000,
          success(result) { if (typeof result?.code === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(result.code)) resolve(result.code); else reject(problem('未取得微信登录凭证，请重试。')); },
          fail() { reject(problem('微信登录未完成，请重试。')); }
        }); } catch (_) { reject(problem('微信登录未完成，请重试。')); } }); check();
        const result = await request('POST', '/auth/wechat/login', { code }); check();
        if (result?.mode !== 'wechat-api' || typeof result.accessToken !== 'string' || !result.accessToken ||
            !Number.isInteger(result.expiresIn) || result.expiresIn < 1 || result.expiresIn > 3600 ||
            typeof result.user?.id !== 'string' || !result.user.id || result.user.role !== 'CUSTOMER' ||
            typeof result.user.displayName !== 'string' || result.payment !== 'NOT_CONNECTED' ||
            result.nativeOrdering !== 'NOT_CONNECTED') throw problem('登录回执不完整，请重新登录。');
        const expiresAt = now() + result.expiresIn * 1000;
        const me = await request('GET', '/auth/me', undefined, result.accessToken); check();
        if (me?.user?.id !== result.user.id || me.user.role !== 'CUSTOMER' || now() >= expiresAt) throw problem('登录身份核验未通过，请重新登录。');
        session = { subject: result.user.id, accessToken: result.accessToken, expiresAt, baseUrl: base,
          user: { id: result.user.id, role: 'CUSTOMER', displayName: result.user.displayName } };
        return { user: { ...session.user }, expiresAt };
      } finally { if (attempt === generation) busy = false; }
    }
  };
}
module.exports = { validateWechatConfig, createWechatSession };
