'use strict';
const { randomUUID, randomInt } = require('node:crypto');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

// A temporary local TEST customer session; this is never WeChat authentication.
function createInteractiveSession({ isolation, seconds, workDeadline, sign, cancelled = () => false, now = Date.now,
  newId = randomUUID, newCode = () => String(randomInt(100000, 1000000)) }) {
  if (!isolation || isolation.host !== '127.0.0.1' || !Number.isInteger(isolation.port) || isolation.port < 1 || isolation.port > 65535 ||
      !/^dfc_test_[a-z0-9_]+$/.test(isolation.database) || !/^TEST_[A-Za-z0-9_-]+$/.test(isolation.storeKey) || !UUID.test(isolation.subject) ||
      !Number.isInteger(seconds) || seconds < 15 || seconds > 90 || !Number.isFinite(workDeadline) || typeof sign !== 'function' || typeof cancelled !== 'function') {
    throw Error('Interactive TEST configuration rejected');
  }
  const deadline = Math.min(now() + seconds * 1000, workDeadline - 2000);
  if (deadline - now() < 15000) throw Error('Insufficient guarded time for interactive TEST');
  let pending = null, stopped = null, requested = 0, approved = 0, issued = 0, denied = 0, wrongCodes = 0;
  function stop(reason = 'operator') { if (!stopped) stopped = reason; pending = null; }
  function active() {
    if (!stopped && cancelled()) stop('guard-stop');
    if (!stopped && now() >= deadline) stop('deadline');
    return !stopped;
  }
  function info() { active(); return { mode: 'interactive-test', stage: stopped ? 'stopped' : issued ? 'session-issued' : pending ? 'approval-pending' : 'ready',
    baseUrl: `http://127.0.0.1:${isolation.port}/api`, deadlineUtc: new Date(deadline).toISOString(),
    requested, approved, issued, denied, stopReason: stopped, realWxLogin: false, realFunds: false, tokenPersisted: false }; }
  function command(line) {
    if (line === 'STOP') { stop('operator'); return true; }
    if (!active() || !pending || now() >= pending.until || !/^APPROVE [0-9]{6}$/.test(line)) return false;
    if (line.slice(8) !== pending.code) { if (++wrongCodes >= 3) stop('approval-attempt-limit'); return false; }
    pending.approved = true; approved = 1; return true;
  }
  function reject(res, status, message) { denied++; return res.status(status).json({ message, environment: 'isolated-test', realFunds: false }); }
  async function middleware(req, res, next) {
    // Close admission for every TEST route before downstream JWT/business handlers.
    if (!active()) return reject(res, 410, '本次 TEST 窗口已结束');
    const route = req.url.split('?')[0];
    if (!route.startsWith('/api/test-session')) return next();
    if (req.method !== 'POST' || req.url !== route || req.socket?.remoteAddress !== '127.0.0.1' ||
        req.headers?.host !== `127.0.0.1:${isolation.port}` || req.headers?.['x-dfc-test-session'] !== '1') {
      return reject(res, 403, '仅接受本机原生 TEST 会话申请');
    }
    if (route === '/api/test-session/request') {
      if (issued || (pending && now() < pending.until)) return reject(res, 409, '本窗口已有 TEST 会话申请');
      if (++requested > 3) { stop('request-limit'); return reject(res, 429, '本窗口申请次数已用完'); }
      const id = newId(), code = newCode();
      if (!UUID.test(id) || !/^[0-9]{6}$/.test(code)) throw Error('Invalid synthetic pairing generator');
      pending = { id, code, approved: false, until: Math.min(now() + 30000, deadline) };
      return res.status(202).json({ status: 'pending', requestId: id, pairingCode: code,
        expiresAt: pending.until, environment: 'isolated-test', realWxLogin: false });
    }
    const id = route.slice('/api/test-session/claim/'.length);
    if (!route.startsWith('/api/test-session/claim/') || !UUID.test(id) || !pending || pending.id !== id || issued) {
      return reject(res, 404, 'TEST 会话申请不存在或已领取');
    }
    if (now() >= pending.until) { pending = null; return reject(res, 410, 'TEST 会话申请已过期'); }
    if (!pending.approved) return res.status(202).json({ status: 'pending', environment: 'isolated-test' });
    // Consume before awaiting signing so concurrent/replayed claims cannot issue twice.
    issued = 1; pending = null;
    try {
      const accessToken = await sign(Math.max(1, Math.floor((deadline - now()) / 1000)));
      if (!active()) return reject(res, 410, '本次 TEST 窗口已结束');
      return res.status(200).json({ status: 'granted', environment: 'isolated-test', realWxLogin: false,
        subject: isolation.subject, storeKey: isolation.storeKey, expiresAt: deadline, accessToken });
    } catch (_) { stop('sign-failed'); return reject(res, 503, 'TEST 会话创建失败'); }
  }
  async function wait({ cancelled, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), onState = () => {} }) {
    let last = '';
    while (active()) {
      if (cancelled()) { stop('guard-stop'); break; }
      const state = info(), serialized = JSON.stringify(state);
      if (serialized !== last) { onState(state); last = serialized; }
      await pause(100);
    }
    onState(info()); return info();
  }
  return { middleware, command, info, stop, wait };
}
module.exports = { createInteractiveSession };
