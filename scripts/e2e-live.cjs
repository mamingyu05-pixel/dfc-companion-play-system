#!/usr/bin/env node
// End-to-end check of a running deployment through its real HTTP API.
// Run inside the api-server container (it needs DATABASE_URL and the app's dependencies):
//   docker compose exec -T -w /app/apps/api-server api-server node ../../scripts/e2e-live.cjs
// It creates its own synthetic customer and companion (e2e-*@synthetic.invalid), walks every main
// flow, marks the orders it made as test orders, and prints a PASS/FAIL table. No real account is used.
const { createRequire } = require("node:module");
const crypto = require("node:crypto");
const appRequire = createRequire(`${process.cwd()}/`);
const { PrismaClient } = appRequire("@prisma/client");
const bcrypt = appRequire("bcryptjs");

const API = process.env.E2E_API_BASE ?? "http://localhost:4000/api";
const prisma = new PrismaClient();
const run = crypto.randomBytes(3).toString("hex");
const results = [];
const createdOrders = [];
// 1x1 PNG, enough to exercise the evidence upload path.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function step(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? "" });
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

async function call(method, path, token, body) {
  const response = await fetch(`${API}${path}`, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const message = data && typeof data === "object" ? (Array.isArray(data.message) ? data.message.join("; ") : data.message) : text;
    throw new Error(`${method} ${path} -> ${response.status} ${String(message).slice(0, 200)}`);
  }
  return data;
}
const expect = (cond, message) => { if (!cond) throw new Error(message); };

async function makeUser(role, password, extra = {}) {
  const name = `e2e-${role.toLowerCase()}-${run}`;
  return prisma.user.create({ data: {
    email: `${name}@synthetic.invalid`, displayName: name, displayNameKey: name, role,
    passwordHash: await bcrypt.hash(password, 10), referralCode: `E${crypto.randomBytes(10).toString("hex").toUpperCase()}`,
    wallet: { create: {} }, ...extra
  } });
}

async function main() {
  const password = crypto.randomBytes(12).toString("base64url");
  const admin = await makeUser("ADMIN", password);
  const customer = await makeUser("CUSTOMER", password);
  const companion = await makeUser("COMPANION", password, { companionProfile: { create: {
    nickname: `e2e陪玩${run}`, skillModes: ["烽火地带"], pricePerHour: "60.00", status: "LISTED", onlineStatus: "ONLINE", game: "DELTA_FORCE", games: ["DELTA_FORCE"]
  } } });
  let adminToken, customerToken, companionToken;

  // --- public ---
  await step("健康检查 /health", async () => { await call("GET", "/health"); });
  await step("公开配置 public-config", async () => { const c = await call("GET", "/auth/public-config"); expect(c.support, "缺少 support"); });
  await step("公开陪玩列表", async () => { const l = await call("GET", "/orders/public/companions"); expect(Array.isArray(l), "不是数组"); return `${l.length} 位`; });
  await step("保底档位列表", async () => { const l = await call("GET", "/orders/guarantee-packages"); expect(l.length > 0, "没有上架档位"); return `${l.length} 档`; });

  // --- login ---
  await step("管理员登录", async () => { adminToken = (await call("POST", "/auth/login", null, { email: admin.email, password, portal: "admin" })).accessToken; expect(adminToken, "无 token"); });
  await step("客户登录", async () => { customerToken = (await call("POST", "/auth/login", null, { email: customer.email, password, portal: "customer" })).accessToken; expect(customerToken, "无 token"); });
  await step("陪玩登录", async () => { companionToken = (await call("POST", "/auth/login", null, { email: companion.email, password, portal: "companion" })).accessToken; expect(companionToken, "无 token"); });
  await step("错误密码被拒绝", async () => {
    try { await call("POST", "/auth/login", null, { email: customer.email, password: "wrong-password", portal: "customer" }); } catch { return "已拒绝"; }
    throw new Error("错误密码竟然登录成功");
  });
  await step("客户不能登录管理端", async () => {
    try { await call("POST", "/auth/login", null, { email: customer.email, password, portal: "admin" }); } catch { return "已拒绝"; }
    throw new Error("客户登录了管理端");
  });
  await step("客户资料 /auth/me", async () => { const me = await call("GET", "/auth/me", customerToken); expect(me.user?.id === customer.id, "身份不对"); });

  // --- recharge ---
  let rechargeId;
  await step("客户提交网页充值", async () => { rechargeId = (await call("POST", "/wallet/recharge-requests", customerToken, { amount: "500", note: "e2e" })).id; });
  await step("管理员审核通过充值", async () => { const r = await call("PATCH", `/admin/recharges/${rechargeId}/review`, adminToken, { status: "APPROVED", note: "e2e" }); expect(r.status === "APPROVED", r.status); });
  await step("余额到账", async () => { const s = await call("GET", "/wallet/customer-summary", customerToken); const bal = Number(s.wallet?.availableBalance ?? s.availableBalance); expect(bal >= 500, `余额 ${bal}`); return `¥${bal}`; });
  await step("客服代客充值", async () => {
    const r = await call("POST", "/admin/recharges/staff-record", adminToken, { customerId: customer.id, amount: "100", method: "WECHAT", requestId: crypto.randomUUID() });
    expect(r.recharge.status === "APPROVED", "未入账");
  });

  // --- hourly order, web flow ---
  let order;
  await step("可选陪玩列表含 e2e 陪玩", async () => { const l = await call("GET", "/orders/companions?game=DELTA_FORCE", customerToken); expect(l.some(c => (c.userId ?? c.id) === companion.id), "列表里没有"); });
  await step("下单前报价", async () => { const p = await call("POST", "/orders/preview", customerToken, { game: "DELTA_FORCE", mode: "烽火地带", hours: "1", companionId: companion.id }); expect(Number(p.totalAmount) > 0, "报价为 0"); return `¥${p.totalAmount}`; });
  await step("客户下小时单", async () => {
    order = await call("POST", "/orders", customerToken, { requestId: crypto.randomUUID(), game: "DELTA_FORCE", mode: "烽火地带", hours: "1", companionId: companion.id, notes: "e2e" });
    createdOrders.push(order.id); expect(order.status === "PAID", order.status);
  });
  await step("管理员派单给陪玩", async () => {
    const r = await call("PATCH", `/admin/orders/${order.id}/dispatch`, adminToken, { mode: "DIRECT", companionId: companion.id, reason: "e2e", dispatchVersion: order.dispatchVersion });
    order = r.order; expect(order.status === "ASSIGNED", order.status);
  });
  await step("陪玩看到派给自己的单", async () => { const l = await call("GET", "/orders/companion/my", companionToken); expect(l.some(o => o.id === order.id), "工作台没有这单"); });
  await step("陪玩接单", async () => { const r = await call("PATCH", `/orders/${order.id}/accept`, companionToken, { dispatchVersion: order.dispatchVersion }); expect((r.order ?? r).status === "ACCEPTED", (r.order ?? r).status); });
  await step("陪玩开始服务", async () => { const r = await call("PATCH", `/orders/${order.id}/start`, companionToken); expect((r.order ?? r).status === "IN_PROGRESS", (r.order ?? r).status); });
  await step("时长未到不能提前完成", async () => {
    try { await call("PATCH", `/orders/${order.id}/complete`, companionToken); } catch { return "已拦截"; }
    throw new Error("没到时长也能完成");
  });
  // Simulate the hour passing rather than waiting for it.
  await prisma.order.update({ where: { id: order.id }, data: { startedAt: new Date(Date.now() - 61 * 60_000) } });
  await step("陪玩提交完成", async () => { const r = await call("PATCH", `/orders/${order.id}/complete`, companionToken); expect((r.order ?? r).status === "AWAITING_ACCEPTANCE", (r.order ?? r).status); });
  await step("客户验收", async () => { const r = await call("PATCH", `/orders/${order.id}/confirm-completion`, customerToken, { note: "e2e" }); expect((r.order ?? r).status === "COMPLETED", (r.order ?? r).status); });
  await step("陪玩收入到可提现", async () => { const s = await call("GET", "/wallet/companion-summary", companionToken); const v = Number(s.wallet?.availableIncome ?? s.availableIncome); expect(v > 0, `可提现 ${v}`); return `¥${v}`; });
  await step("客户评价", async () => { await call("POST", `/orders/${order.id}/review`, customerToken, { stars: 5, comment: "e2e 测试评价" }); });

  // --- withdrawal ---
  let withdrawalId;
  await step("陪玩设置收款方式", async () => { await call("PATCH", "/wallet/companion-payout-profile", companionToken, { payoutMethod: "ALIPAY", payoutAccountName: "测试", payoutAccountNo: "e2e@example.invalid" }); });
  await step("陪玩申请提现", async () => { withdrawalId = (await call("POST", "/wallet/withdrawal-requests", companionToken, { amount: "10", payoutAccount: "e2e@example.invalid" })).id; });
  await step("管理员批准并打款", async () => {
    await call("PATCH", `/admin/withdrawals/${withdrawalId}/review`, adminToken, { status: "APPROVED", note: "e2e" });
    const r = await call("PATCH", `/admin/withdrawals/${withdrawalId}/review`, adminToken, { status: "PAID", payoutReference: `e2e-${run}` });
    expect(r.status === "PAID", r.status);
  });

  // --- guarantee order with evidence ---
  let g;
  await step("保底护航报价", async () => {
    const pkg = (await call("GET", "/orders/guarantee-packages"))[0];
    const p = await call("POST", "/orders/guarantee/preview", customerToken, { packageId: pkg.id });
    g = { pkg, total: p.totalAmount }; return `${pkg.label} ¥${p.totalAmount}`;
  });
  await step("客户下保底单", async () => {
    const o = await call("POST", "/orders/guarantee", customerToken, { requestId: crypto.randomUUID(), packageId: g.pkg.id, expectedTotalAmount: g.total });
    g.order = o; createdOrders.push(o.id); expect(o.status === "PAID", o.status);
  });
  await step("保底单派单、接单、开始", async () => {
    const d = await call("PATCH", `/admin/orders/${g.order.id}/dispatch`, adminToken, { mode: "DIRECT", companionId: companion.id, reason: "e2e", dispatchVersion: g.order.dispatchVersion });
    await call("PATCH", `/orders/${g.order.id}/accept`, companionToken, { dispatchVersion: d.order.dispatchVersion });
    await call("PATCH", `/orders/${g.order.id}/start`, companionToken);
  });
  await step("未达标不能报完成", async () => {
    await call("POST", `/orders/${g.order.id}/evidence`, companionToken, { kind: "VAULT_START", vaultValueWan: 100, image: PNG });
    await call("POST", `/orders/${g.order.id}/evidence`, companionToken, { kind: "VAULT_END", vaultValueWan: 100 + g.pkg.targetWan - 1, image: PNG });
    try { await call("PATCH", `/orders/${g.order.id}/complete`, companionToken); } catch { return "已拦截"; }
    throw new Error("没达标也能完成");
  });
  await step("达标后报完成，客户看得到凭证", async () => {
    await call("POST", `/orders/${g.order.id}/evidence`, companionToken, { kind: "VAULT_END", vaultValueWan: 100 + g.pkg.targetWan, image: PNG });
    const r = await call("PATCH", `/orders/${g.order.id}/complete`, companionToken);
    expect((r.order ?? r).status === "AWAITING_ACCEPTANCE", (r.order ?? r).status);
    const ev = await call("GET", `/orders/${g.order.id}/evidence`, customerToken);
    expect(ev.evidence.length >= 3, `凭证 ${ev.evidence.length} 条`); expect(ev.progress, "缺少达标进度");
  });

  // --- complaint & refund ---
  let refundOrder;
  await step("下单后管理员取消退款", async () => {
    refundOrder = await call("POST", "/orders", customerToken, { requestId: crypto.randomUUID(), game: "DELTA_FORCE", mode: "娱乐陪玩", hours: "1", companionId: companion.id });
    createdOrders.push(refundOrder.id);
    const before = Number((await call("GET", "/wallet/customer-summary", customerToken)).wallet?.availableBalance ?? 0);
    const r = await call("PATCH", `/admin/orders/${refundOrder.id}/cancel`, adminToken, { note: "e2e" });
    const after = Number((await call("GET", "/wallet/customer-summary", customerToken)).wallet?.availableBalance ?? 0);
    expect(r.status === "REFUNDED", r.status); expect(after > before, `退款前 ${before} 后 ${after}`);
  });
  await step("客户投诉并由客服处理", async () => {
    const c = await call("POST", "/complaints", customerToken, { orderId: g.order.id, reason: "e2e 测试投诉" });
    const r = await call("PATCH", `/admin/complaints/${c.id}/review`, adminToken, { status: "RESOLVED", resolution: "e2e 已处理" });
    expect(r.status === "RESOLVED", r.status);
  });

  // --- support ---
  await step("AI 客服知识库回答", async () => { const r = await call("POST", "/support/auto-reply", customerToken, { message: "保底没打到怎么办" }); expect(/知识库/.test(r.matchedTopic ?? ""), r.matchedTopic); });
  await step("退款问题转人工", async () => { const r = await call("POST", "/support/auto-reply", customerToken, { message: "我要退款" }); expect(r.handoffRequired === true, "没有转人工"); });

  // --- admin pages' data ---
  for (const [name, path] of [["看板", "/admin/dashboard"], ["待办数", "/admin/pending-counts"], ["客户数据", "/admin/analytics/customers"], ["陪玩数据", "/admin/analytics/companions"],
    ["订单列表", "/admin/orders"], ["充值列表", "/admin/recharges"], ["提现列表", "/admin/withdrawals"], ["投诉列表", "/admin/complaints"], ["陪玩列表", "/admin/companions"],
    ["用户列表", "/admin/users"], ["日志", "/admin/logs"], ["知识库", "/admin/support-knowledge"], ["草稿台", "/admin/order-drafts"], ["经营与绩效", "/admin/operations"]]) {
    await step(`管理端：${name}`, async () => { await call("GET", path, adminToken); });
  }
  await step("管理端：导出订单 CSV", async () => { const r = await fetch(`${API}/admin/export/orders`, { headers: { Authorization: `Bearer ${adminToken}` } }); expect(r.ok, String(r.status)); const bytes = new Uint8Array(await r.arrayBuffer()); expect(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, "缺 BOM"); });
  await step("管理端：快速开单报价", async () => { const p = await call("POST", "/admin/quick-order/preview", adminToken, { customerId: customer.id, kind: "HOURLY", mode: "烽火地带", hours: "1" }); return `¥${p.totalAmount}`; });
  await step("管理端：读取 KOOK 服务器成员", async () => { const p = await call("POST", "/admin/kook-members/preview", adminToken, { refresh: true }); return `${p.total} 人`; });
  await step("客户不能调用管理接口", async () => {
    try { await call("GET", "/admin/orders", customerToken); } catch { return "已拒绝"; }
    throw new Error("客户读到了管理数据");
  });
}

main()
  .catch(error => results.push({ name: "脚本异常", ok: false, detail: error instanceof Error ? error.stack : String(error) }))
  .finally(async () => {
    // Keep e2e orders out of business dashboards.
    if (createdOrders.length) await prisma.order.updateMany({ where: { id: { in: createdOrders } }, data: { isTest: true } }).catch(() => undefined);
    await prisma.$disconnect();
    const failed = results.filter(r => !r.ok);
    for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  —  ${r.detail}` : ""}`);
    console.log(`\n${results.length - failed.length}/${results.length} passed (run ${run})`);
    process.exitCode = failed.length ? 1 : 0;
  });
