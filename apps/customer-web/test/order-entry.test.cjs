const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync(path.join(__dirname, '../app/order/order-entry.ts'), 'utf8');
const helpers = import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const companion = (id, onlineStatus = 'ONLINE') => ({ id, onlineStatus, nickname: id, pricePerHour: '30' });
const ready = { connected: true, busy: false, error: '', pending: false, receipt: null, companions: [companion('a&b')] };

test('entry selects the matching decoded companion without creating an order', async () => {
  const { entrySelection } = await helpers;
  assert.deepEqual(entrySelection('?companionId=a%26b', ready), { companionId: 'a&b', message: '' });
});
test('missing entry keeps placeholder; invalid or delisted entry explains why', async () => {
  const { entrySelection } = await helpers;
  assert.deepEqual(entrySelection('', ready), { companionId: '', message: '' });
  for (const view of [ready, { ...ready, companions: [] }]) {
    assert.deepEqual(entrySelection('?companionId=missing', view), { companionId: '', message: '这位陪玩暂时不能下单，请另选' });
  }
});
test('entry waits for successful loading and does not change pending or recovered orders', async () => {
  const { entrySelection } = await helpers;
  for (const patch of [{ connected: false }, { busy: true }, { error: '加载失败' }, { pending: true }, { receipt: { id: 'old' } }]) {
    assert.equal(entrySelection('?companionId=a%26b', { ...ready, ...patch }), null);
  }
});
test('online then busy then offline, stable within each group, without mutating API list', async () => {
  const { sortedCompanions } = await helpers;
  const rows = [companion('off', 'OFFLINE'), companion('busy1', 'BUSY'), companion('on1'), companion('on2'), companion('busy2', 'BUSY')];
  const original = rows.slice();
  assert.deepEqual(sortedCompanions(rows).map(row => row.id), ['on1', 'on2', 'busy1', 'busy2', 'off']);
  assert.deepEqual(rows, original);
});
test('statuses are Chinese including unexpected status fallback', async () => {
  const { onlineLabel } = await helpers;
  assert.deepEqual(['ONLINE', 'BUSY', 'OFFLINE', 'NEW'].map(onlineLabel), ['在线', '忙碌', '离线', '状态待核对']);
});
test('shortfall shows exact cents including zero balance and one-cent difference', async () => {
  const { balanceShortfall } = await helpers;
  for (const [balance, total, expected] of [['0', '30', '30.00'], ['20', '30', '10.00'], ['0.29', '0.30', '0.01'], ['1.1', '2.22', '1.12']]) {
    assert.equal(balanceShortfall(balance, total), expected);
  }
});
test('equal or sufficient balance never blocks confirmation', async () => {
  const { balanceShortfall } = await helpers;
  for (const balance of ['30', '30.00', '31']) assert.equal(balanceShortfall(balance, '30.00'), null);
});
test('unavailable or malformed balance does not invent a shortfall', async () => {
  const { balanceShortfall } = await helpers;
  for (const balance of ['', '待核对', 'NaN', 'Infinity', '-1', ' ', '1.234', '99999999999999999']) {
    assert.equal(balanceShortfall(balance, '30'), null);
  }
  assert.equal(balanceShortfall('0', ''), null);
});
