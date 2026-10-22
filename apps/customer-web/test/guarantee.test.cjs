const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const ui = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../../../packages/ui/src/guarantee.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, { exports: ui, Promise, Error });
const entry = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../app/order/order-entry.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, { exports: entry, URLSearchParams, String, Number });

test('guarantee progress text explains missing evidence, shortfall and success', () => {
  assert.equal(ui.guaranteeProgressText(688, { startWan: null, endWan: null, gainWan: null, reached: false }), '目标净增 688 万：待上传开局仓库，待上传结束仓库');
  assert.equal(ui.guaranteeProgressText(688, { startWan: 1000, endWan: null, gainWan: null, reached: false }), '目标净增 688 万：开局 1000 万，待上传结束仓库');
  assert.equal(ui.guaranteeProgressText(688, { startWan: 1000, endWan: 1600, gainWan: 600, reached: false }), '开局 1000 万 → 结束 1600 万，净增 600 / 688 万 · 未达标');
  assert.equal(ui.guaranteeProgressText(688, { startWan: 1000, endWan: 1700, gainWan: 700, reached: true }), '开局 1000 万 → 结束 1700 万，净增 700 / 688 万 · 已达标');
  assert.equal(ui.guaranteeProgressText(null, null), '');
});

test('guarantee upload windows mirror the server and vault values are whole 万', () => {
  for (const s of ['ACCEPTED', 'IN_PROGRESS']) assert.ok(ui.canUploadVault(s));
  for (const s of ['PAID', 'AWAITING_ACCEPTANCE', 'COMPLETED', 'DISPUTED']) assert.ok(!ui.canUploadVault(s));
  for (const s of ['AWAITING_ACCEPTANCE', 'DISPUTED']) assert.ok(ui.canUploadEvidence(s));
  for (const s of ['PAID', 'COMPLETED', 'REFUNDED']) assert.ok(!ui.canUploadEvidence(s));
  assert.equal(ui.parseVaultWan(' 1288 '), 1288);
  for (const bad of ['', '-1', '1.5', '12a', '1e3', '1234567890']) assert.equal(ui.parseVaultWan(bad), null);
});

test('guarantee image picker rejects wrong type and oversize before reading', async () => {
  let reads = 0;
  const read = async () => { reads++; return 'data:image/png;base64,AAAA'; };
  await assert.rejects(ui.readEvidenceImage({ size: 10, type: 'image/svg+xml' }, read), /仅支持/);
  await assert.rejects(ui.readEvidenceImage({ size: 2 * 1024 * 1024 + 1, type: 'image/png' }, read), /2MiB/);
  assert.equal(reads, 0);
  assert.equal(await ui.readEvidenceImage({ size: 10, type: 'image/png' }, read), 'data:image/png;base64,AAAA');
});

test('guarantee rules promise only what the system enforces', () => {
  const text = ui.GUARANTEE_RULES.join('');
  assert.match(text, /净增达到档位才报完成/);
  assert.match(text, /不承诺零封号/);
  assert.match(text, /不转移物资/);
  assert.doesNotMatch(text, /包赔|零风险|100%/);
  assert.equal(ui.platformLabel('MOBILE'), '手游');
  assert.equal(ui.platformLabel('PC'), '端游');
});

test('reorder of a completed guarantee order returns to the guarantee page with the same companion', () => {
  assert.equal(entry.reorderHref({ status: 'COMPLETED', companionId: 'c&1', mode: '保底护航 688W · 端游', hours: '1', serviceKind: 'GUARANTEE' }), '/guarantee?companionId=c%261');
  assert.equal(entry.reorderHref({ status: 'IN_PROGRESS', companionId: 'c', mode: 'x', hours: '1', serviceKind: 'GUARANTEE' }), null);
});
