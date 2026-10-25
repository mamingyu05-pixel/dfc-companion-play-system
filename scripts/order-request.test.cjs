// Transaction substitute exercises service behavior, not PostgreSQL locking or migration compatibility.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const root = process.env.DFC_REQUEST_SOURCE_ROOT || path.resolve(__dirname, '..');
const deps = createRequire(path.join(process.env.DFC_REQUEST_DEPENDENCY_ROOT || root, 'apps/api-server/package.json'));
const ts = deps('typescript'), prisma = deps('@prisma/client');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const clone = value => JSON.parse(JSON.stringify(value));
class BadRequestException extends Error { constructor(value) { super(typeof value === 'object' ? value.message : value); this.response = value; } }
class ConflictException extends Error {}
const helper = {};
vm.runInNewContext(compile(fs.readFileSync(path.join(__dirname, '../apps/api-server/src/modules/orders/order-request.ts'), 'utf8')),
  { exports: helper, require: id => id === '@nestjs/common' ? { BadRequestException, ConflictException } : require(id) });
const environment = {};
vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'apps/api-server/src/modules/orders/order-environment.ts'), 'utf8')),
  { exports: environment, process: { env: {} }, require: id => {
    assert.equal(id, '@nestjs/common'); return { BadRequestException };
  } });
const membership = {}, financial = {};
for (const [file, exports] of [['customer-membership.ts', membership], ['financial-values.ts', financial]]) {
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'apps/api-server/src/modules', file), 'utf8')), {
    exports, process: { env: {} }, require: id => {
      if (id === '@prisma/client') return prisma;
      assert.equal(id, '@nestjs/common'); return { BadRequestException };
    }
  });
}
function methods(source) {
  const ast = ts.createSourceFile('s.ts', source, ts.ScriptTarget.Latest, true), found = [];
  const names = ['createOrder', 'createOrderInTransaction', 'lockUnconvertedDraft', 'createOrderGroup', 'resolvePricing', 'resolveGameRankPrice', 'normalizeRankTierKey',
    'resolvePlatformMatchUnitPrice', 'platformMatchPriceKeys', 'readPositivePlatformPrice', 'readPlatformSettingValue',
    'resolveMultiCompanionDiscountConfig', 'applyUnitDiscount', 'defaultPlatformMatchUnitPrice', 'pickCompanionPriceForTier',
    'pickCompanionPriceForPlatform', 'normalizePriceTier', 'defaultPlatformCommissionRate', 'memberDiscount', 'memberUnitPrice'];
  function visit(node) { if (ts.isMethodDeclaration(node) && names.includes(node.name?.getText(ast))) found.push(node.getText(ast)); ts.forEachChild(node, visit); }
  visit(ast); return found.join('\n');
}
function fixture({ realPricing = false, rechargeTotal = '0', settings = {} } = {}) {
  const exported = {}, source = fs.readFileSync(path.join(root, 'apps/api-server/src/modules/orders/orders.service.ts'), 'utf8');
  vm.runInNewContext(compile(`class S { ${methods(source)} } exports.S=S;`), {
    exports: exported, ...prisma, ...helper, ...environment, ...membership, ...financial,
    MEMBER_DISCOUNT_LEVELS: [10, 8, 5, 3], BadRequestException, process: { env: {} }
  });
  let state = { balance: 1000, frozen: 0, debits: 0, logs: 0, orders: [], groups: [], receipts: {} }, queue = Promise.resolve(), notifications = 0;
  const s = new exported.S(); let fail = false, pricingCalls = 0, globalReads = 0; const scopedReads = [];
  s.prisma = { $transaction: fn => {
    const run = queue.then(async () => {
      const next = clone(state);
      const tx = {
        companionProfile: { findFirst: async () => { scopedReads.push('companionProfile'); return {
          pricePerHour: new prisma.Prisma.Decimal(100), kookPricePerHour: new prisma.Prisma.Decimal(120),
          discordPricePerHour: new prisma.Prisma.Decimal(110), entertainmentPricePerHour: new prisma.Prisma.Decimal(80),
          rankedPricePerHour: new prisma.Prisma.Decimal(140), highRankedPricePerHour: null, commissionRate: new prisma.Prisma.Decimal('0.2')
        }; } },
        gameRankPrice: { findUnique: async ({ where }) => { scopedReads.push('gameRankPrice'); return where.game_tierKey.tierKey === 'synthetic-rank'
          ? { tierKey: 'synthetic-rank', tierName: 'Synthetic rank', unitPrice: new prisma.Prisma.Decimal(175), isActive: true } : null; } },
        platformSetting: { findUnique: async ({ where }) => { scopedReads.push(`setting:${where.key}`);
          return Object.hasOwn(settings, where.key) ? { value: settings[where.key] }
            : where.key === 'KOOK_PLATFORM_MATCH_ENTERTAINMENT_UNIT_PRICE' ? { value: '123' } : null; } },
        rechargeRequest: { aggregate: async ({ where }) => { scopedReads.push('rechargeRequest');
          assert.equal(where.status, 'APPROVED'); assert.ok(where.customerId);
          return { _sum: { amount: new prisma.Prisma.Decimal(rechargeTotal) } }; } },
        $queryRaw: async (sql, key, payloadHash) => {
          if (/SELECT "id" FROM "order_drafts"/.test(sql.join('?'))) {
            assert.match(sql.join('?'), /FOR UPDATE/); return [{ id: key }];
          }
          assert.match(sql.join('?'), /ON CONFLICT.*DO UPDATE/s);
          return [next.receipts[key] || (next.receipts[key] = { key, payloadHash, resourceId: null })];
        },
        $executeRaw: async (sql, resourceId, key) => { assert.match(sql.join('?'), /resourceId.*IS NULL/s); next.receipts[key].resourceId = resourceId; return 1; },
        user: { findFirst: async () => ({ wallet: { id: 'wallet' } }) },
        wallet: {
          updateMany: async args => { const amount = Number(args.data.availableBalance.decrement); if (next.balance < amount) return { count: 0 }; next.balance -= amount; next.frozen += amount; next.debits++; return { count: 1 }; },
          findUniqueOrThrow: async () => ({ availableBalance: next.balance })
        },
        order: {
          create: async ({ data }) => { const order = { ...data, id: `order-${next.orders.length + 1}` }; next.orders.push(order); return order; },
          findUniqueOrThrow: async ({ where }) => next.orders.find(o => o.id === where.id),
          count: async ({ where }) => next.orders.filter(o => o.sourceDraftId === where.sourceDraftId).length,
          findMany: async ({ where }) => next.orders.filter(o => o.orderGroupId === where.orderGroupId)
        },
        orderDraft: { findUnique: async ({ where }) => ({ id: where.id, customerId: 'customer-a', status: 'CUSTOMER_CONFIRMED' }) },
        orderGroup: {
          create: async ({ data }) => { const group = { ...data, id: `group-${next.groups.length + 1}` }; next.groups.push(group); return group; },
          count: async ({ where }) => next.groups.filter(g => g.sourceDraftId === where.sourceDraftId).length,
          findUniqueOrThrow: async ({ where }) => next.groups.find(g => g.id === where.id)
        },
        walletTransaction: { create: async () => { if (fail) { fail = false; throw new Error('synthetic ledger failure'); } next.logs++; } },
        orderStatusLog: { create: async () => {} }, adminLog: { create: async () => {} }
      };
      const result = await fn(tx); state = clone(next); return result;
    }); queue = run.catch(() => {}); return run;
  } };
  s.positiveDecimal = x => new prisma.Prisma.Decimal(x);
  s.nonNegativeDecimal = x => new prisma.Prisma.Decimal(x);
  if (realPricing) {
    for (const model of ['companionProfile', 'gameRankPrice', 'platformSetting', 'rechargeRequest']) Object.defineProperty(s.prisma, model, {
      get() { globalReads++; throw new Error(`Global Prisma read while transaction owns the only connection: ${model}`); }
    });
  } else {
    s.normalizePriceTier = () => 'CUSTOM';
    s.resolvePricing = async () => { pricingCalls++; return { unitPrice: new prisma.Prisma.Decimal(100), commissionRate: new prisma.Prisma.Decimal('0.2') }; };
    s.resolveMultiCompanionDiscountConfig = async () => ({ enabled: false });
  }
  s.generateOrderNo = () => 'SYNTHETIC-ORDER'; s.generateOrderGroupNo = () => 'SYNTHETIC-GROUP';
  s.botNotifications = { sendOrderAssignedNotifications: async () => { notifications++; return {}; } };
  return { s, state: () => state, failNextLedger: () => { fail = true; }, notifications: () => notifications, pricingCalls: () => pricingCalls,
    globalReads: () => globalReads, scopedReads };
}
const body = { requestId: 'synthetic-request-0001', mode: 'synthetic-mode', hours: '1', companionId: 'synthetic-companion' };
test('committed order with lost response can be retried without another debit or repricing', async () => {
  const f = fixture(), first = await f.s.createOrder('customer-a', body);
  const replay = await f.s.createOrder('customer-a', { ...body });
  assert.equal(replay.id, first.id); assert.equal(f.state().debits, 1); assert.equal(f.state().logs, 1); assert.equal(f.pricingCalls(), 1);
});
test('same request key with different payload conflicts before another debit', async () => {
  const f = fixture(); await f.s.createOrder('customer-a', body);
  await assert.rejects(f.s.createOrder('customer-a', { ...body, hours: '2' }), /different order request/);
  assert.equal(f.state().balance, 900); assert.equal(f.state().orders.length, 1);
});
test('serialized duplicate submissions of a direct group return one group and notify once', async () => {
  const f = fixture(), group = { ...body, companionIds: ['one', 'two'], assignedById: 'admin-synthetic' };
  const result = await Promise.all(Array.from({ length: 6 }, () => f.s.createOrderGroup('customer-a', group)));
  assert.equal(new Set(result.map(r => r.orderGroup.id)).size, 1);
  assert.equal(f.state().debits, 1); assert.equal(f.state().orders.length, 2); assert.equal(f.state().logs, 1); assert.equal(f.notifications(), 2);
});
test('ledger failure rolls back receipt and debit so the original request can retry', async () => {
  const f = fixture(); f.failNextLedger();
  await assert.rejects(f.s.createOrder('customer-a', body), /ledger failure/);
  assert.equal(f.state().balance, 1000); assert.equal(Object.keys(f.state().receipts).length, 0);
  await f.s.createOrder('customer-a', body); assert.equal(f.state().debits, 1);
});
test('missing/malformed request IDs fail closed; distinct customer and request identities remain separate', async () => {
  const f = fixture();
  for (const id of [undefined, '', 'short', 'x'.repeat(97), 'bad id'.repeat(5)]) {
    await assert.rejects(f.s.createOrder('customer-a', { ...body, requestId: id }), /requestId/);
  }
  assert.equal(f.state().debits, 0);
  await f.s.createOrder('customer-a', body); await f.s.createOrder('customer-b', body);
  await f.s.createOrder('customer-a', { ...body, requestId: 'synthetic-request-0002' }); assert.equal(f.state().debits, 3);
});
test('internal source draft uses a stable identity and canonical property order', async () => {
  const f = fixture(), draft = { mode: 'synthetic-mode', hours: '1', sourceDraftId: 'synthetic-draft' };
  const first = await f.s.createOrder('customer-a', draft);
  const second = await f.s.createOrder('customer-a', { sourceDraftId: draft.sourceDraftId, hours: '1', mode: draft.mode });
  assert.equal(first.id, second.id); assert.equal(f.state().debits, 1);
});
test('only known business-validation rollback gets a safe not-committed marker', async () => {
  const f = fixture();
  await assert.rejects(f.s.createOrder('customer-a', { ...body, requestId: undefined }), e => e.response?.requestOutcome === 'NOT_COMMITTED');
  f.failNextLedger();
  await assert.rejects(f.s.createOrder('customer-a', body), e => !e.response?.requestOutcome);
});
test('companion pricing uses the transaction delegate, not a second pooled connection', async () => {
  const f = fixture({ realPricing: true }); const order = await f.s.createOrder('customer-a', body);
  assert.equal(order.totalAmount.toString(), '100'); assert.equal(f.state().balance, 900);
  assert.equal(f.globalReads(), 0); assert.ok(f.scopedReads.includes('companionProfile'));
});
test('rank price lookup remains in the transaction and keeps rank precedence', async () => {
  const f = fixture({ realPricing: true });
  const order = await f.s.createOrder('customer-a', { ...body, rankTierKey: 'synthetic-rank', customUnitPrice: '10' });
  assert.equal(order.totalAmount.toString(), '175'); assert.equal(order.rankTierKey, 'synthetic-rank');
  assert.equal(f.globalReads(), 0); assert.ok(f.scopedReads.includes('gameRankPrice'));
});
test('platform matching price reads configured settings on the transaction', async () => {
  const f = fixture({ realPricing: true });
  const order = await f.s.createOrder('customer-a', { ...body, companionId: undefined, sourcePlatform: 'KOOK', priceTier: 'ENTERTAINMENT' });
  assert.equal(order.totalAmount.toString(), '123'); assert.equal(f.globalReads(), 0);
  assert.ok(f.scopedReads.includes('setting:KOOK_PLATFORM_MATCH_ENTERTAINMENT_UNIT_PRICE'));
});
test('group discount reads and all companion prices use one transaction without changing discount rules', async () => {
  const f = fixture({ realPricing: true });
  const result = await f.s.createOrderGroup('customer-a', { ...body, companionIds: ['one', 'two'], priceTier: 'ENTERTAINMENT', assignedById: 'admin-synthetic' });
  assert.equal(result.orderGroup.originalAmount.toString(), '160'); assert.equal(result.orderGroup.discountAmount.toString(), '20');
  assert.equal(result.orderGroup.totalAmount.toString(), '140'); assert.equal(f.state().balance, 860);
  assert.equal(f.globalReads(), 0); assert.equal(f.scopedReads.filter(x => x.startsWith('setting:MULTI_')).length, 4);
});
test('invalid rank still rejects and rolls back rather than falling through to another price', async () => {
  const f = fixture({ realPricing: true });
  await assert.rejects(f.s.createOrder('customer-a', { ...body, rankTierKey: 'missing-rank' }), /Rank price tier is not configured/);
  assert.equal(f.state().balance, 1000); assert.equal(f.state().debits, 0); assert.equal(f.globalReads(), 0);
});
test('custom, platform and high-ranked price precedence stays unchanged', async () => {
  for (const [extra, expected] of [[{ customUnitPrice: '67.50', priceTier: 'CUSTOM' }, '67.5'],
    [{ sourcePlatform: 'KOOK' }, '120'], [{ sourcePlatform: 'DISCORD' }, '110'], [{ priceTier: 'HIGH_RANKED' }, '140']]) {
    const f = fixture({ realPricing: true }); const order = await f.s.createOrder('customer-a', { ...body, ...extra });
    assert.equal(order.totalAmount.toString(), expected); assert.equal(f.globalReads(), 0);
  }
});
test('membership pricing is read in the transaction and a replay keeps the first committed amount', async () => {
  const settings = { MEMBER_LV3_DISCOUNT_RATE: '0.9' };
  const f = fixture({ realPricing: true, rechargeTotal: '500', settings });
  const first = await f.s.createOrder('customer-a', body);
  assert.equal(first.totalAmount.toString(), '90'); assert.equal(first.originalAmount.toString(), '100');
  assert.equal(first.memberDiscountRate.toString(), '0.9'); assert.equal(f.state().balance, 910);
  assert.equal(f.globalReads(), 0); assert.ok(f.scopedReads.includes('rechargeRequest'));
  assert.ok(f.scopedReads.includes('setting:MEMBER_LV3_DISCOUNT_RATE'));
  settings.MEMBER_LV3_DISCOUNT_RATE = '0.5';
  const replay = await f.s.createOrder('customer-a', body);
  assert.equal(replay.id, first.id); assert.equal(replay.totalAmount.toString(), '90');
  assert.equal(f.state().debits, 1); assert.equal(f.state().logs, 1);
  assert.equal(f.scopedReads.filter(value => value === 'rechargeRequest').length, 1);
});
test('a staff custom price bypasses membership discounts without reading another connection', async () => {
  const f = fixture({ realPricing: true, rechargeTotal: '500', settings: { MEMBER_LV3_DISCOUNT_RATE: '0.5' } });
  const order = await f.s.createOrder('customer-a', { ...body, priceTier: 'CUSTOM', customUnitPrice: '67.50' });
  assert.equal(order.totalAmount.toString(), '67.5'); assert.equal(f.state().balance, 932.5);
  assert.equal(f.scopedReads.includes('rechargeRequest'), false); assert.equal(f.globalReads(), 0);
});
