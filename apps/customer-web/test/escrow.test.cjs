const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = path.resolve(__dirname, '../../../packages/ui/src/order-escrow.ts');
const escrow = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, { exports: escrow });
const view = (status, totalAmount = '200', refundAmount = '0') => escrow.orderEscrowView({ status, totalAmount, refundAmount });
// Spread into this realm's Array so deepStrictEqual does not trip on the vm context prototype.
const states = v => [...v.steps].map(step => `${step.label}:${step.state}`);

test('escrow: held statuses show the frozen amount and advance the normal progress', () => {
  for (const [status, current] of [['PAID', '陪玩接单'], ['ASSIGNED', '陪玩接单'], ['ACCEPTED', '服务中'], ['IN_PROGRESS', '服务中'], ['AWAITING_ACCEPTANCE', '待你验收']]) {
    const v = view(status);
    assert.equal(v.tone, 'held');
    assert.equal(v.headline, '¥200.00 由平台托管中');
    assert.equal(v.steps.find(step => step.state === 'current').label, current, status);
    assert.equal(v.steps[0].state, 'done');
    assert.equal(v.steps.at(-1).state, 'todo');
  }
});

test('escrow: completion, partial refund and full refund report where the money went', () => {
  const settled = view('COMPLETED');
  assert.equal(settled.headline, '已结算 ¥200.00');
  assert.ok(settled.steps.every(step => step.state === 'done'));
  const partial = view('COMPLETED', '200', '50');
  assert.equal(partial.headline, '已退回 ¥50.00，结算 ¥150.00');
  assert.deepEqual(states(partial), ['资金托管:done', '争议裁决:done', '退回 ¥50.00:done', '结算 ¥150.00:done']);
  const refunded = view('REFUNDED', '200', '200');
  assert.equal(refunded.tone, 'returned');
  assert.equal(refunded.headline, '已退回站内余额 ¥200.00');
  assert.match(refunded.detail, /没有结算给陪玩/);
  assert.equal(view('REFUNDED', '200', '0').headline, '已退回站内余额');
});

test('escrow: disputes stay frozen and never claim settlement; unknown states ask to verify', () => {
  for (const status of ['DISPUTED', 'REFUND_REQUESTED']) {
    const v = view(status);
    assert.equal(v.tone, 'warning');
    assert.equal(v.headline, '¥200.00 冻结中，等待客服裁决');
    assert.deepEqual(states(v), ['资金托管:done', '争议处理:current', '裁决后退回或结算:todo']);
  }
  assert.equal(view('PENDING_PAYMENT').headline, '尚未冻结余额');
  assert.equal(view('CANCELLED').headline, '订单已取消');
  const unknown = view('SOMETHING_NEW');
  assert.equal(unknown.headline, '资金状态待核对');
  assert.equal(unknown.steps.length, 0);
  assert.equal(view('PAID', 'garbage').headline, '¥0.00 由平台托管中');
  assert.equal(escrow.orderEscrowView({ status: 'COMPLETED', totalAmount: '99.9' }).headline, '已结算 ¥99.90');
});

test('escrow promise copy states the guarantee without claiming external payouts', () => {
  assert.equal(escrow.ESCROW_PROMISE.title, '平台托管，验收后才付给陪玩');
  assert.ok(escrow.ESCROW_PROMISE.points.some(point => point.includes('站内余额')));
  assert.ok(!escrow.ESCROW_PROMISE.points.some(point => /微信|支付宝|原路/.test(point)));
});
