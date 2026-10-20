const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");
const root = process.env.DFC_SELECTION_SOURCE_ROOT || path.resolve(__dirname, "..");
const supportSource = fs.readFileSync(path.join(root, "apps/api-server/src/modules/support/platform-support.service.ts"), "utf8");
function methods(source, names) {
  const ast = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
  const found = [];
  const visit = node => { if (ts.isMethodDeclaration(node) && names.includes(node.name?.getText(ast))) found.push(node.getText(ast)); ts.forEachChild(node, visit); };
  visit(ast); return found.join("\n");
}
function matches(row, where) {
  return Object.entries(where).every(([key, value]) => key === "OR" ? value.some(w => matches(row, w))
    : key === "AND" ? value.every(w => matches(row, w))
      : value && typeof value === "object" && "in" in value ? value.in.includes(row[key]) : row[key] === value);
}
const customer = { userId: "customer-owner" };
const draft = { id: "draft-one", draftNo: "TRY20261004123456ABCDE", status: "OPEN", sourcePlatform: "KOOK",
  customerId: "customer-owner", customerPlatformUserId: "platform-owner", sourceGuildId: "guild", sourceChannelId: "channel",
  candidates: [1, 2].map(n => ({ id: `candidate-${n}`, status: "RECOMMENDED", companionId: `companion-${n}`, companion: { displayName: `陪玩${n}`, email: `c${n}@example.invalid`, companionProfile: null } })) };
const input = { platform: "KOOK", platformUserId: "platform-owner", channelId: "channel", guildId: "guild" };
function service(rows = [draft]) {
  const selections = [], queries = [];
  const exports = {};
  vm.runInNewContext(ts.transpileModule(`class S { ${methods(supportSource, ["trySelectDraftCandidate", "extractCandidateOrdinal"])} }\nexports.S=S;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, BotPlatform: { DISCORD: "DISCORD" }, OrderSourcePlatform: { DISCORD: "DISCORD", KOOK: "KOOK" } });
  const s = new exports.S();
  s.prisma = { orderDraft: { findFirst: async query => { queries.push(query); return rows.find(row => matches(row, query.where)); } } };
  s.findServiceAdmin = async () => ({ id: "admin-fixture" });
  s.orderDrafts = { selectCompanion: async (...args) => selections.push(args) };
  return { s, queries, selections };
}
test("ordinary demand text cannot select a candidate", async () => {
  for (const text of ["我要2小时", "就玩1小时", "这个预算300", "选1", "2", "我想要陪玩2"]) {
    const { s, selections } = service();
    assert.equal(await s.trySelectDraftCandidate(input, customer, text), null, text);
    assert.equal(selections.length, 0);
  }
});
test("another channel member cannot select someone else's draft", async () => {
  const { s, selections } = service();
  assert.equal(await s.trySelectDraftCandidate({ ...input, platformUserId: "attacker" }, { userId: "other" }, `选择 ${draft.draftNo} 陪玩2`), null);
  assert.equal(selections.length, 0);
});
test("owner selects an explicit draft and candidate and passes ownership to the transaction", async () => {
  const { s, selections } = service();
  const result = await s.trySelectDraftCandidate(input, customer, `选择 ${draft.draftNo} 陪玩2`);
  assert.equal(result.draftId, draft.id);
  assert.equal(selections[0][2].companionId, "companion-2");
  assert.equal(selections[0][3].platformUserId, "platform-owner");
  assert.equal(selections[0][3].draftNo, draft.draftNo);
});
test("wrong draft, guild, channel or ordinal cannot silently pick the latest draft", async () => {
  for (const [message, overrides] of [["选择 TRYOTHER 陪玩1", {}], [`选择 ${draft.draftNo} 陪玩1`, { guildId: "other" }],
    [`选择 ${draft.draftNo} 陪玩1`, { channelId: "other" }], [`选择 ${draft.draftNo} 9`, {}]]) {
    const { s, selections } = service();
    assert.equal(await s.trySelectDraftCandidate({ ...input, ...overrides }, customer, message), null);
    assert.equal(selections.length, 0);
  }
});
test("ambiguous names, rejected candidates and bare ordinals cannot choose another person", async () => {
  const duplicate = { ...draft, candidates: draft.candidates.map(c => ({ ...c, companion: { ...c.companion, displayName: "同名" } })) };
  assert.equal(await service([duplicate]).s.trySelectDraftCandidate(input, customer, `选择 ${draft.draftNo} 同名`), null);
  const rejected = { ...draft, candidates: [{ ...draft.candidates[1], status: "REJECTED" }] };
  assert.equal(await service([rejected]).s.trySelectDraftCandidate(input, customer, `选择 ${draft.draftNo} #candidate-2`), null);
  assert.equal(await service().s.trySelectDraftCandidate(input, customer, `选择 ${draft.draftNo} 2`), null);
  const direct = service([duplicate]);
  await direct.s.trySelectDraftCandidate(input, customer, `选择 ${draft.draftNo} #candidate-2`);
  assert.equal(direct.selections[0][2].companionId, "companion-2");
});

function transactionalService(currentDraft = draft, currentCandidate = { ...draft.candidates[1], draftId: draft.id }) {
  const source = fs.readFileSync(path.join(root, "apps/api-server/src/modules/orders/order-drafts.service.ts"), "utf8");
  const exports = {}; let writes = 0, notifications = 0; const locks = [];
  vm.runInNewContext(ts.transpileModule(`class S { ${methods(source, ["selectCompanion"])} }\nexports.S=S;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, BadRequestException: Error, OrderDraftCandidateStatus: { SELECTED: "SELECTED", REJECTED: "REJECTED", RECOMMENDED: "RECOMMENDED" },
      OrderDraftStatus: { SELECTED: "SELECTED" }, OrderDraftActorType: { CUSTOMER: "CUSTOMER", ADMIN: "ADMIN" },
      OrderDraftEventType: { CUSTOMER_SELECTED_COMPANION: "SELECTED", CUSTOMER_CHANGED_COMPANION: "CHANGED" } });
  const tx = { $queryRaw: async query => { locks.push(query.join("?")); return []; },
    orderDraftCandidate: { findUnique: async () => currentCandidate, findMany: async () => [],
      upsert: async () => { writes++; }, updateMany: async () => { writes++; } },
    orderDraft: { update: async () => { writes++; return currentDraft; } } };
  const s = new exports.S(); s.prisma = { $transaction: callback => callback(tx) };
  s.normalizeCompanionIds = body => [body.companionId]; s.assertEditableDraft = async () => currentDraft;
  s.assertListedCompanion = async () => {}; s.writeDraftEvent = s.writeAdminLog = async () => { writes++; };
  s.botNotifications = { sendOrderDraftSelectedCompanionNotification: async () => { notifications++; } };
  return { s, counts: () => ({ writes, notifications }), locks };
}
const context = { draftNo: draft.draftNo, sourcePlatform: "KOOK", platformUserId: input.platformUserId,
  customerId: customer.userId, guildId: "guild", channelId: "channel", candidateId: "candidate-2" };
test("transaction rechecks ownership, status and channel before writes or notifications", async () => {
  for (const overrides of [{ customerId: "other", customerPlatformUserId: "other" }, { status: "CUSTOMER_CONFIRMED" },
    { sourceChannelId: "other" }, { sourceGuildId: "other" }, { draftNo: "OTHER" }]) {
    const p = transactionalService({ ...draft, ...overrides });
    await assert.rejects(p.s.selectCompanion("admin", draft.id, { companionId: "companion-2" }, context));
    assert.deepEqual(p.counts(), { writes: 0, notifications: 0 });
  }
});
test("transaction rejects candidates removed, rejected or moved after the initial read", async () => {
  for (const candidate of [null, { ...draft.candidates[1], draftId: "other" },
    { ...draft.candidates[1], draftId: draft.id, status: "REJECTED" },
    { ...draft.candidates[0], draftId: draft.id }]) {
    const p = transactionalService(draft, candidate);
    await assert.rejects(p.s.selectCompanion("admin", draft.id, { companionId: "companion-2" }, context));
    assert.deepEqual(p.counts(), { writes: 0, notifications: 0 });
  }
});
test("valid bound selection locks draft and candidate then retains audit and notification", async () => {
  const p = transactionalService();
  await p.s.selectCompanion("admin", draft.id, { companionId: "companion-2" }, context);
  assert.equal(p.counts().notifications, 1); assert.ok(p.counts().writes >= 5);
  assert.equal(p.locks.length, 2); assert.ok(p.locks.every(query => query.includes("FOR UPDATE")));
});
