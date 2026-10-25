const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { config, runtime } = require('./runtime.cjs');
const base = 'http://127.0.0.1:18080';

async function main() {
  const results = [];
  async function get(route) {
    const response = await fetch(base + route, { signal: AbortSignal.timeout(10000) });
    const text = await response.text();
    assert.equal(response.status, 200, `${route}: ${response.status}`);
    results.push({ route, status: response.status, bytes: Buffer.byteLength(text) });
    return { response, text };
  }
  for (const route of ['/', '/terms.html', '/privacy.html', '/customer/', '/companion/', '/admin/', '/admin/login/']) {
    const { text } = await get(route);
    assert.match(text, /<html/);
    if (route.includes('customer') || route.includes('companion') || route.includes('admin')) {
      const asset = text.match(/(?:src|href)="([^"\s]+\/_next\/static\/[^"\s]+\.(?:js|css))"/);
      assert.ok(asset, `${route}: missing built assets`);
      await get(asset[1].replaceAll('&amp;', '&'));
    }
  }
  const { text: healthText } = await get('/api/health');
  const health = JSON.parse(healthText);
  assert.equal(health.processAlive, true);
  assert.equal(health.productionReady, false);
  await get('/api/auth/public-config');
  const { text: companions } = await get('/api/orders/public/companions?game=DELTA_FORCE');
  assert.ok(Array.isArray(JSON.parse(companions)));
  const c = config();
  const login = await fetch(base + '/api/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ email: 'admin@dfc.local', password: c.adminPassword, portal: 'admin' }), signal: AbortSignal.timeout(10000) });
  assert.equal(login.status, 201);
  assert.equal(login.headers.get('access-control-allow-origin'), base);
  const session = await login.json();
  assert.ok(session.accessToken);
  const me = await fetch(base + '/api/auth/me', { headers: { Authorization: `Bearer ${session.accessToken}` }, signal: AbortSignal.timeout(10000) });
  assert.equal(me.status, 200);
  const identity = await me.json();
  assert.equal(identity.user?.role, 'SUPER_ADMIN');
  results.push({ route: '/api/auth/login', status: login.status, role: identity.user.role, authenticatedMeStatus: me.status, corsOrigin: base });
  const unauthorized = await fetch(base + '/api/auth/me', { signal: AbortSignal.timeout(10000) });
  assert.equal(unauthorized.status, 401);
  await unauthorized.body?.cancel();
  results.push({ route: '/api/auth/me (without token)', status: unauthorized.status });
  const report = { status: 'PASS', checkedAt: new Date().toISOString(), base, checks: results,
    processAlive: health.processAlive, productionReady: health.productionReady,
    realPayment: false, realKook: false, realWechat: false, publicDeployment: false };
  fs.writeFileSync(path.join(runtime, 'smoke-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`SMOKE_PASS checks=${results.length} apiAlive=true adminLogin=201 authenticatedMe=200 unauthenticatedMe=401 productionReady=false`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
