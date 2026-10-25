const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), { test } = require('node:test'), { createRequire } = require('node:module');
const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const root = argument('--repository') || path.resolve(__dirname, '..');
const overlay = argument('--candidate');
const deps = createRequire(path.join(root, 'apps/api-server/package.json')), ts = deps('typescript');
const cache = new Map();
const read = relative => fs.readFileSync(overlay && fs.existsSync(path.join(overlay, relative)) ? path.join(overlay, relative) : path.join(root, relative), 'utf8');
function load(relative) {
  if (cache.has(relative)) return cache.get(relative);
  const exports = {}; cache.set(relative, exports);
  if (relative.endsWith('/auth/password.util.ts')) {
    exports.createPasswordHash = async input => { assert.match(input, /^[a-f0-9]{64}$/); return 'synthetic-password-hash'; };
    return exports;
  }
  const code = ts.transpileModule(read(relative), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
  const local = id => id.startsWith('.') ? load(path.posix.normalize(path.posix.join(path.posix.dirname(relative), id.endsWith('.ts') ? id : id + '.ts')))
    : id === '@dfc/shared' ? load('packages/shared/src/index.ts') : deps(id);
  vm.runInNewContext(code, { exports, require: local, process: { env: {} }, Error, Date, Buffer, console, setTimeout, clearTimeout,
    fetch() { throw Error('Network forbidden'); } }, { timeout: 3000 });
  return exports;
}
const { KookOrderFlowService } = load('apps/api-server/src/modules/kook/kook-order-flow.service.ts');
const { OrdersService } = load('apps/api-server/src/modules/orders/orders.service.ts');
const { createConfirmedKookCustomer, parseKookOnboardingAction } = load('apps/api-server/src/modules/kook/kook-customer-onboarding.ts');
const { dispatchReminder } = load('apps/api-server/src/modules/orders/dispatch-reminder.ts');
const { KookWebhookController } = load('apps/api-server/src/modules/kook/kook-webhook.controller.ts');
const { PlatformSupportService } = load('apps/api-server/src/modules/support/platform-support.service.ts');
const actor = '123456789';
const buttons = card => card.flatMap(c => c.modules.filter(m => m.type === 'action-group').flatMap(m => m.elements));
function fixture() {
  let data = { users: [], wallets: [], accounts: [] }, queue = Promise.resolve(), failAt, failSend = false, sequence = 0;
  const sent = [], issued = new Map(), sql = [];
  const tx = {
    $queryRaw: async (parts, ...values) => { sql.push(parts.join('?')); return []; },
    user: {
      findUnique: async ({ where }) => data.users.find(u => u.email === where.email) || null,
      create: async ({ data: input }) => {
        assert.equal(input.role, 'CUSTOMER');
        assert.equal(input.passwordHash, 'synthetic-password-hash');
        const user = { id: `customer-${data.users.length}`, status: 'ACTIVE', ...input }; data.users.push(user); return user;
      }
    },
    wallet: { create: async ({ data: input }) => {
      assert.deepEqual(Object.keys(input), ['userId']);
      if (failAt === 'wallet') throw Error('Synthetic wallet failure');
      data.wallets.push({ ...input, availableBalance: 0, frozenBalance: 0, availableIncome: 0, pendingIncome: 0, frozenIncome: 0 });
    } },
    userExternalAccount: {
      findUnique: async ({ where }) => {
        const account = data.accounts.find(a => a.externalUserId === where.platform_externalUserId.externalUserId);
        return account ? { ...account, user: data.users.find(u => u.id === account.userId) } : null;
      },
      create: async ({ data: input }) => {
        if (failAt === 'binding') throw Error('Synthetic binding failure');
        assert.equal(input.platform, 'KOOK'); data.accounts.push({ ...input });
      }
    }
  };
  // Serial, rollback-capable transaction model. Does not prove PostgreSQL locking.
  const db = { $transaction: callback => {
    const run = queue.then(async () => { const before = structuredClone(data); try { return await callback(tx); } catch (error) { data = before; throw error; } });
    queue = run.catch(() => {}); return run;
  } };
  const port = {
    send: async (userId, card, key) => {
      if (failSend) throw Error('Synthetic delivery unknown');
      const messageId = `message-${++sequence}`;
      sent.push({ userId, card, key, messageId }); issued.set(messageId, { userId, values: buttons(card).map(b => b.value) });
      return { messageId };
    },
    wasIssuedTo: async (userId, messageId, value) => { const row = issued.get(messageId); return row?.userId === userId && row.values.includes(value); },
    wasIssuedInChannel: async () => false
  };
  const service = new KookOrderFlowService(db, {}, {}, port);
  return { service, db, tx, sent, issued, sql, data: () => data,
    fail: point => { failAt = point; }, deliveryFailure: value => { failSend = value; },
    last: () => sent.at(-1),
    async open(command = '首次使用') { await service.command(actor, `command-${++sequence}`, command); return sent.at(-1); },
    async click(message, action = 'create', overrides = {}) {
      const value = buttons(message.card).find(b => b.value.startsWith(`dfc.onboard.${action}.`)).value;
      return service.action({ userId: actor, eventId: `event-${++sequence}`, messageId: message.messageId, value, ...overrides });
    }
  };
}
const counts = f => [f.data().users.length, f.data().wallets.length, f.data().accounts.length];
const text = f => JSON.stringify(f.last().card);

test('first-use and unbound order commands only present explicit choices', async () => {
  for (const command of ['首次使用', '建档', '下单', '我要下单']) {
    const f = fixture(); assert.equal(f.service.acceptsCommand(command), true); await f.open(command);
    assert.deepEqual(counts(f), [0, 0, 0]); assert.equal(buttons(f.last().card).length, 2);
    assert.match(text(f), /初始余额为零/); assert.equal(f.sql.some(s => s.includes('INSERT')), false);
  }
});
test('binding choice never creates, links or changes an account', async () => {
  const f = fixture(); await f.click(await f.open(), 'bind'); assert.deepEqual(counts(f), [0, 0, 0]); assert.match(text(f), /此按钮没有建立新档案/);
});
test('forwarded private card cannot create an account for another actor', async () => {
  const f = fixture(); await f.click(await f.open(), 'create', { userId: '987654321' }); assert.deepEqual(counts(f), [0, 0, 0]); assert.match(text(f), /不属于当前账号/);
});
test('unissued or modified action cannot create an account', async () => {
  const f = fixture(), card = await f.open(); await f.click(card, 'create', { messageId: 'forged' });
  await f.click(card, 'create', { value: 'dfc.onboard.create.9999999999.00000000-0000-0000-0000-000000000000' }); assert.deepEqual(counts(f), [0, 0, 0]);
});
test('expired consent rejects without writes', async () => {
  const f = fixture(); const value = 'dfc.onboard.create.1000000000.00000000-0000-0000-0000-000000000000';
  f.issued.set('old', { userId: actor, values: [value] });
  await f.service.action({ userId: actor, eventId: 'expiry', messageId: 'old', value });
  assert.deepEqual(counts(f), [0, 0, 0]); assert.match(text(f), /已过期/);
});
test('confirmed actor gets one CUSTOMER, zero wallet and unique external identity', async () => {
  const f = fixture(); await f.click(await f.open()); assert.deepEqual(counts(f), [1, 1, 1]);
  assert.equal(f.data().users[0].role, 'CUSTOMER'); assert.equal(f.data().accounts[0].externalUserId, actor);
  assert.ok(Object.entries(f.data().wallets[0]).filter(([k]) => k !== 'userId').every(([,v]) => v === 0));
  assert.match(text(f), /客户档案已建立/); assert.ok(f.sql.some(s => s.includes('pg_advisory_xact_lock')));
});
test('repeated confirmation and new first-use command reuse the current account', async () => {
  const f = fixture(), card = await f.open(); await f.click(card); const before = JSON.stringify(f.data());
  await f.click(card); await f.open(); assert.equal(JSON.stringify(f.data()), before); assert.match(text(f), /无需重复建档/);
});
test('concurrent explicit confirmations in transaction model create once', async () => {
  const f = fixture(), a = await f.open(), b = await f.open(); await Promise.all([f.click(a), f.click(b)]); assert.deepEqual(counts(f), [1, 1, 1]);
});
test('wallet and binding failures roll back all three records in transaction model', async () => {
  for (const point of ['wallet', 'binding']) { const f = fixture(), card = await f.open(); f.fail(point); await f.click(card); assert.deepEqual(counts(f), [0,0,0]); }
});
test('lost delivery after commit cannot cause a duplicate profile on retry', async () => {
  const f = fixture(), card = await f.open(); f.deliveryFailure(true); await assert.rejects(f.click(card), /delivery unknown/);
  assert.deepEqual(counts(f), [1,1,1]); f.deliveryFailure(false); await f.click(card); assert.deepEqual(counts(f), [1,1,1]); assert.match(text(f), /没有重复创建/);
});
test('banned and non-customer bindings are rejected without role or wallet changes', async () => {
  for (const update of [{status:'BANNED'}, {role:'COMPANION'}, {role:'ADMIN'}, {role:'SUPER_ADMIN'}]) {
    const f=fixture(), card=await f.open(); await f.click(card); Object.assign(f.data().users[0], update); const before=JSON.stringify(f.data());
    await f.click(card); assert.equal(JSON.stringify(f.data()), before); assert.match(text(f), /权限已变化/);
  }
});
test('reserved orphan identity is not automatically reattached or duplicated', async () => {
  const f = fixture(); f.data().users.push({id:'orphan',email:`customer-kook-${actor}@platform.maycatplay.local`});
  await f.click(await f.open()); assert.deepEqual(counts(f), [1,0,0]); assert.match(text(f), /管理员核对/);
});
test('invalid actor and invalid expiry are rejected before any writes', async () => {
  const f = fixture(); await assert.rejects(createConfirmedKookCustomer(f.tx, 'forged-id', Date.now()+1000), /身份无效/);
  await assert.rejects(createConfirmedKookCustomer(f.tx, actor, NaN), /已过期/); assert.deepEqual(counts(f), [0,0,0]);
  for(const value of ['dfc.onboard.create', 'dfc.onboard.admin.9999999999.00000000-0000-0000-0000-000000000000']) assert.equal(parseKookOnboardingAction(value), null);
});
test('verified controller routes first-use privately and ignores bot messages', async () => {
  const f = fixture(); const c = new KookWebhookController({}, {}, {}, {}, {}, {}, {}, f.service);
  await c.processVerifiedWebhook({ d: { msg_id:'msg', author_id:actor, channel_type:'PERSON', content:'首次使用', extra:{author:{id:actor,bot:false}} } });
  assert.equal(f.sent.length, 1); assert.deepEqual(counts(f), [0,0,0]);
  await c.processVerifiedWebhook({ d: { msg_id:'bot-msg', author_id:actor, channel_type:'PERSON', content:'首次使用', extra:{author:{id:actor,bot:true}} } }); assert.equal(f.sent.length,1);
});
test('joining guild still cannot create a customer or grant roles', async () => {
  let sends=0; const c = new KookWebhookController({}, {}, {ensurePlatformCustomer(){throw Error('No implicit profile')}},
    {sendKookDirectMessage:async()=>{sends++;return{status:'SENT'}}}, {}, {}, {});
  await c.processVerifiedWebhook({d:{extra:{type:'joined_guild',body:{user_id:actor}}}}); assert.equal(sends,1);
});

test('legacy KOOK support creation entry cannot bypass explicit consent', async () => {
  const service = new PlatformSupportService({userExternalAccount:{findUnique:async()=>null}},{});
  service.resolvePlatformDisplayName=async()=>{throw Error('No external lookup or implicit creation')};
  assert.equal(await service.ensurePlatformCustomer({platform:'KOOK',platformUserId:actor}),null);
});
test('ordinary unbound KOOK consultation provides first-use guidance without account writes', async () => {
  const conversations=[];
  const service=new PlatformSupportService({userExternalAccount:{findUnique:async()=>null},aiSupportConversation:{create:async({data})=>{conversations.push(data);return{id:'consultation'}}}},{});
  service.findDuplicatePlatformMessage=async()=>null;service.loadConversationHistory=async()=>[];
  service.resolveSupportAnswer=async()=>({answer:'可以先了解服务。',matchedTopic:'问候',handoffRequired:false});
  const result=await service.handlePlatformMessage({platform:'KOOK',platformUserId:actor,content:'你好',messageId:'consultation',isDirect:true});
  assert.match(result.reply,/首次使用/);assert.equal(conversations[0].userId,undefined);assert.equal(result.draft,null);
});
test('existing KOOK account and other platform lookup behavior are preserved', async () => {
  const account={userId:'existing'};
  const bound=new PlatformSupportService({userExternalAccount:{findUnique:async()=>account}},{});
  bound.refreshPlatformAccountDisplayName=async value=>value;
  assert.equal(await bound.ensurePlatformCustomer({platform:'KOOK',platformUserId:actor}),account);
  const discord=new PlatformSupportService({userExternalAccount:{findUnique:async()=>null}},{});
  discord.resolvePlatformDisplayName=async()=>{throw Error('Existing Discord path reached')};
  await assert.rejects(discord.ensurePlatformCustomer({platform:'DISCORD',platformUserId:'123456789123456789'}),/Existing Discord path reached/);
});

const now = new Date('2026-10-06T10:00:00Z');
const order = Object.freeze({id:'order',status:'ASSIGNED',dispatchVersion:3});
const log = (minutes=10, reason='{"dispatchVersion":3}') => ({orderId:'order',toStatus:'ASSIGNED',createdAt:new Date(now.getTime()-minutes*60000),reason});
test('read-only reminder has exact ten-minute threshold independent of deadline', () => {
  assert.equal(dispatchReminder(order,log(10-1/60),now).due,false); assert.equal(dispatchReminder(order,log(),now).due,true);
  assert.equal(dispatchReminder(order,log(11),now).due,true);
});
test('new dispatch round, wrong owner and stale log cannot inherit old reminder', () => {
  assert.equal(dispatchReminder({...order,dispatchVersion:4},log(),now).due,false);
  assert.equal(dispatchReminder(order,{...log(),orderId:'foreign'},now).due,false);
  assert.equal(dispatchReminder(order,log(2),now).due,false);
});
test('accepted, finished, paid, cancelled or disputed orders cannot be reminded', () => {
  for(const status of ['ACCEPTED','IN_PROGRESS','COMPLETED','PAID','CANCELLED','DISPUTED','REFUNDED']) assert.equal(dispatchReminder({...order,status},log(),now).due,false);
});
test('missing, malformed, legacy or future assignment evidence remains unknown', () => {
  for(const entry of [undefined,log(10,'plain legacy'),log(10,'null'),log(10,'{"dispatchVersion":"3"}'),log(-1),{...log(),createdAt:new Date(NaN)},{...log(),toStatus:'PAID'}]) {
    const result=dispatchReminder(order,entry,now); assert.equal(result.due,false); assert.equal(result.assignedAt,null);
  }
});
test('customer-selected assignment prefix is supported and inputs are immutable', () => {
  const entry=Object.freeze(log(10,'CUSTOMER_SELECTED_DISPATCH:{"dispatchVersion":3}')), before=JSON.stringify(entry);
  assert.equal(dispatchReminder(order,entry,now).due,true); assert.equal(JSON.stringify(entry),before);
});
test('admin list derives reminder from latest assignment beyond the five display logs, using reads only', async () => {
  const requested=[]; const row={...order,statusLogs:[],totalAmount:'10'};
  const db={order:{findMany:async()=>[row]},orderStatusLog:{findMany:async query=>{requested.push(query);return [{...log(),createdAt:new Date(Date.now()-30*60000)}]}}};
  const service=new OrdersService(db,{}); service.serializeOrder=x=>x;
  const result=await service.listAdminOrders(); assert.equal(result[0].dispatchReminder.due,true);
  assert.equal(requested[0].where.toStatus,'ASSIGNED'); assert.deepEqual(Array.from(requested[0].distinct),['orderId']);
  assert.deepEqual(Array.from(requested[0].where.orderId.in),['order']); assert.equal(requested[0].orderBy[1].createdAt,'desc');
});
test('admin display includes due reminder by default, excludes outdated dispatch metadata', () => {
  const source=read('apps/admin-web/app/dispatch/page.tsx'), ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const names=['hasDispatchReminder','needsDispatchAttention'];
  const functions=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.includes(n.name?.text)).map(n=>n.getText(ast)).join('\n');
  const exports={}; vm.runInNewContext(ts.transpileModule(functions+'\nexports.attention=needsDispatchAttention;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,Date});
  assert.equal(exports.attention({...order,dispatchReminder:{dispatchVersion:3,due:true}}),true);
  assert.equal(exports.attention({...order,dispatchReminder:{dispatchVersion:2,due:true}}),false);
  assert.equal(exports.attention({...order,status:'ACCEPTED',dispatchReminder:{dispatchVersion:3,due:true}}),false);
  let refresh;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'button'
      && node.children.some(child => ts.isJsxText(child) && child.text.trim() === '刷新')) refresh = node;
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(refresh, 'manual refresh button remains available');
  assert.match(refresh.getText(ast),/loadData\(\)/); assert.doesNotMatch(refresh.getText(ast),/expireDue|method:\s*["']POST["']/);
  assert.doesNotMatch(source,/setInterval/);
});
