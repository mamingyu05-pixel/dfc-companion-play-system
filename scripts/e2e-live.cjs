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

async function makeUser(role, password, extra = {}, tag = role.toLowerCase()) {
  const name = `e2e-${tag}-${run}`;
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

  // --- growth features: member price, tips, packages, blown runs, swap, badges ---
  const money = v => Number(v).toFixed(2);
  await step("客服再代充 ¥1500（供后续用例）", async () => {
    const r = await call("POST", "/admin/recharges/staff-record", adminToken, { customerId: customer.id, amount: "1500", method: "WECHAT", requestId: crypto.randomUUID() });
    expect(r.recharge.status === "APPROVED", "未入账");
  });
  await step("会员价：报价按后台设置的会员折扣", async () => {
    const settings = await call("GET", "/admin/promotion-settings", adminToken);
    const rows = Array.isArray(settings) ? settings : settings.settings ?? [];
    const rateOf = level => Number((rows.find(x => x.key === `MEMBER_LV${level}_DISCOUNT_RATE`) ?? {}).value ?? 1);
    const p = await call("POST", "/orders/preview", customerToken, { game: "DELTA_FORCE", mode: "烽火地带", hours: "2", companionId: companion.id });
    expect(p.memberDiscount, "没有会员折扣（累计充值 ¥2100 应为 Lv.5）");
    const rate = rateOf(p.memberDiscount.level);
    expect(Math.abs(Number(p.memberDiscount.rate) - rate) < 1e-9, `折扣 ${p.memberDiscount.rate} ≠ 后台设置 ${rate}`);
    expect(money(Number(p.originalTotalAmount) * rate) === money(p.totalAmount), `原价 ${p.originalTotalAmount} × ${rate} ≠ ${p.totalAmount}`);
    return `Lv.${p.memberDiscount.level} ${p.memberDiscount.rate} · ¥${p.originalTotalAmount} → ¥${p.totalAmount}`;
  });
  await step("会员价：下单金额与报价一致", async () => {
    const p = await call("POST", "/orders/preview", customerToken, { game: "DELTA_FORCE", mode: "烽火地带", hours: "1", companionId: companion.id });
    const o = await call("POST", "/orders", customerToken, { requestId: crypto.randomUUID(), game: "DELTA_FORCE", mode: "烽火地带", hours: "1", companionId: companion.id, expectedTotalAmount: p.totalAmount });
    createdOrders.push(o.id); expect(money(o.totalAmount) === money(p.totalAmount), `下单 ${o.totalAmount} ≠ 报价 ${p.totalAmount}`);
    await call("PATCH", `/admin/orders/${o.id}/cancel`, adminToken, { note: "e2e" });
  });

  await step("小费：给已完成订单小费，陪玩到账，重复点击不重复扣", async () => {
    const before = Number((await call("GET", "/wallet/companion-summary", companionToken)).wallet?.availableIncome ?? 0);
    const cBefore = Number((await call("GET", "/wallet/customer-summary", customerToken)).wallet?.availableBalance ?? 0);
    const requestId = crypto.randomUUID();
    await call("POST", `/orders/${order.id}/tip`, customerToken, { amount: "5", requestId });
    const again = await call("POST", `/orders/${order.id}/tip`, customerToken, { amount: "5", requestId });
    expect(again.replayed === true, "重复点击没有被识别");
    const after = Number((await call("GET", "/wallet/companion-summary", companionToken)).wallet?.availableIncome ?? 0);
    const cAfter = Number((await call("GET", "/wallet/customer-summary", customerToken)).wallet?.availableBalance ?? 0);
    expect(money(cBefore - cAfter) === "5.00", `客户扣了 ${money(cBefore - cAfter)}`);
    expect(after > before && after - before <= 5.0001, `陪玩到账 ${money(after - before)}`);
    return `客户 -¥5，陪玩 +¥${money(after - before)}`;
  });
  await step("小费：超过 ¥500 被拒绝", async () => {
    try { await call("POST", `/orders/${order.id}/tip`, customerToken, { amount: "501", requestId: crypto.randomUUID() }); } catch { return "已拒绝"; }
    throw new Error("¥501 小费竟然成功");
  });

  let pk;
  await step("套餐：客户看到上架套餐并按会员价报价", async () => {
    const list = await call("GET", "/orders/service-packages");
    expect(list.length > 0, "没有上架套餐");
    const pkg = list.find(p => Number(p.price) <= 100) ?? list[0];
    const p = await call("POST", "/orders/package/preview", customerToken, { packageId: pkg.id, companionId: companion.id });
    expect(p.memberDiscount && Number(p.totalAmount) < Number(pkg.price), "套餐没有会员价");
    pk = { pkg, total: p.totalAmount }; return `${list.length} 个 · ${pkg.name} ¥${pkg.price} → ¥${p.totalAmount}`;
  });
  await step("套餐：下单→派单→接单→开始→立即交付→验收", async () => {
    const o = await call("POST", "/orders/package", customerToken, { requestId: crypto.randomUUID(), packageId: pk.pkg.id, companionId: companion.id, expectedTotalAmount: pk.total });
    createdOrders.push(o.id); expect(o.status === "PAID" && o.serviceKind === "PACKAGE", `${o.status} ${o.serviceKind}`);
    const d = await call("PATCH", `/admin/orders/${o.id}/dispatch`, adminToken, { mode: "DIRECT", companionId: companion.id, reason: "e2e", dispatchVersion: o.dispatchVersion });
    await call("PATCH", `/orders/${o.id}/accept`, companionToken, { dispatchVersion: d.order.dispatchVersion });
    await call("PATCH", `/orders/${o.id}/start`, companionToken);
    const c = await call("PATCH", `/orders/${o.id}/complete`, companionToken);
    expect((c.order ?? c).status === "AWAITING_ACCEPTANCE", (c.order ?? c).status);
    const r = await call("PATCH", `/orders/${o.id}/confirm-completion`, customerToken, { note: "e2e" });
    expect((r.order ?? r).status === "COMPLETED", (r.order ?? r).status);
  });
  await step("套餐：管理端列表与快速开单报价", async () => {
    const all = await call("GET", "/admin/service-packages", adminToken);
    expect(all.some(p => p.id === pk.pkg.id), "管理端没有该套餐");
    const q = await call("POST", "/admin/quick-order/preview", adminToken, { customerId: customer.id, kind: "PACKAGE", packageId: pk.pkg.id });
    return `快速开单 ¥${q.totalAmount}`;
  });

  await step("炸单：陪玩记录炸单后保底目标增加，只达基础目标不能完成", async () => {
    const pkg = (await call("GET", "/orders/guarantee-packages"))[0];
    const p = await call("POST", "/orders/guarantee/preview", customerToken, { packageId: pkg.id });
    const o = await call("POST", "/orders/guarantee", customerToken, { requestId: crypto.randomUUID(), packageId: pkg.id, expectedTotalAmount: p.totalAmount });
    createdOrders.push(o.id);
    const d = await call("PATCH", `/admin/orders/${o.id}/dispatch`, adminToken, { mode: "DIRECT", companionId: companion.id, reason: "e2e", dispatchVersion: o.dispatchVersion });
    await call("PATCH", `/orders/${o.id}/accept`, companionToken, { dispatchVersion: d.order.dispatchVersion });
    await call("PATCH", `/orders/${o.id}/start`, companionToken);
    await call("POST", `/orders/${o.id}/evidence`, companionToken, { kind: "VAULT_START", vaultValueWan: 100, image: PNG });
    let customerBlocked = false;
    try { await call("POST", `/orders/${o.id}/evidence`, customerToken, { kind: "BLOWN_RUN", image: PNG }); } catch { customerBlocked = true; }
    expect(customerBlocked, "客户竟能记炸单");
    await call("POST", `/orders/${o.id}/evidence`, companionToken, { kind: "BLOWN_RUN", image: PNG });
    const ev = await call("GET", `/orders/${o.id}/evidence`, customerToken);
    expect(ev.blownBonusWan > 0 && ev.targetWan === pkg.targetWan + ev.blownBonusWan, `目标 ${ev.targetWan}，基础 ${pkg.targetWan}，补 ${ev.blownBonusWan}`);
    await call("POST", `/orders/${o.id}/evidence`, companionToken, { kind: "VAULT_END", vaultValueWan: 100 + pkg.targetWan, image: PNG });
    let blocked = false; try { await call("PATCH", `/orders/${o.id}/complete`, companionToken); } catch { blocked = true; }
    expect(blocked, "只达基础目标就能完成（炸单补没生效）");
    await call("POST", `/orders/${o.id}/evidence`, companionToken, { kind: "VAULT_END", vaultValueWan: 100 + ev.targetWan, image: PNG });
    const c = await call("PATCH", `/orders/${o.id}/complete`, companionToken);
    expect((c.order ?? c).status === "AWAITING_ACCEPTANCE", (c.order ?? c).status);
    await call("PATCH", `/orders/${o.id}/confirm-completion`, customerToken, { note: "e2e" });
    return `${pkg.targetWan}W + 炸单 ${ev.blownBonusWan}W = ${ev.targetWan}W`;
  });

  const companion2 = await makeUser("COMPANION", password, { companionProfile: { create: {
    nickname: `e2e陪玩B${run}`, skillModes: ["烽火地带"], pricePerHour: "60.00", status: "LISTED", onlineStatus: "ONLINE", game: "DELTA_FORCE", games: ["DELTA_FORCE"]
  } } }, "companion2");
  const companion2Token = (await call("POST", "/auth/login", null, { email: companion2.email, password, portal: "companion" })).accessToken;
  const placeAccepted = async hours => {
    const o = await call("POST", "/orders", customerToken, { requestId: crypto.randomUUID(), game: "DELTA_FORCE", mode: "烽火地带", hours, companionId: companion.id });
    createdOrders.push(o.id);
    const d = await call("PATCH", `/admin/orders/${o.id}/dispatch`, adminToken, { mode: "DIRECT", companionId: companion.id, reason: "e2e", dispatchVersion: o.dispatchVersion });
    await call("PATCH", `/orders/${o.id}/accept`, companionToken, { dispatchVersion: d.order.dispatchVersion });
    return o;
  };
  await step("中途换人：服务 1 小时后换人，已服务部分结给原陪玩", async () => {
    const o = await placeAccepted("2");
    await call("PATCH", `/orders/${o.id}/start`, companionToken);
    await prisma.order.update({ where: { id: o.id }, data: { startedAt: new Date(Date.now() - 61 * 60_000) } });
    const income1 = Number((await call("GET", "/wallet/companion-summary", companionToken)).wallet?.availableIncome ?? 0);
    const frozen1 = Number((await call("GET", "/wallet/customer-summary", customerToken)).wallet?.frozenBalance ?? 0);
    const v = (await prisma.order.findUnique({ where: { id: o.id } })).dispatchVersion;
    const r = await call("POST", `/admin/orders/${o.id}/swap-companion`, adminToken, { newCompanionId: companion2.id, servedHours: "1", reason: "e2e 掉线换人", dispatchVersion: v });
    createdOrders.push(r.orderId);
    expect(r.settledOrderId === o.id && r.orderId !== o.id, "没有拆成结算单 + 续单");
    const original = await prisma.order.findUnique({ where: { id: o.id } });
    const follow = await prisma.order.findUnique({ where: { id: r.orderId } });
    expect(original.status === "COMPLETED", `原订单 ${original.status}`);
    expect(follow.companionId === companion2.id && follow.status === "ASSIGNED", `续单 ${follow.status}`);
    expect(money(Number(follow.totalAmount) + Number(original.totalAmount)) === money(o.totalAmount), `金额拆分 ${original.totalAmount} + ${follow.totalAmount} ≠ ${o.totalAmount}`);
    const income2 = Number((await call("GET", "/wallet/companion-summary", companionToken)).wallet?.availableIncome ?? 0);
    expect(income2 > income1, "原陪玩没有拿到已服务部分");
    const frozen2 = Number((await call("GET", "/wallet/customer-summary", customerToken)).wallet?.frozenBalance ?? 0);
    expect(money(frozen1 - frozen2) === money(original.totalAmount), `客户冻结减少 ${money(frozen1 - frozen2)}，应为 ${money(original.totalAmount)}`);
    await call("PATCH", `/orders/${r.orderId}/accept`, companion2Token, { dispatchVersion: follow.dispatchVersion });
    await call("PATCH", `/admin/orders/${r.orderId}/cancel`, adminToken, { note: "e2e" }).catch(() => undefined);
    return `原单 ¥${money(original.totalAmount)} 结算，续单 ¥${money(follow.totalAmount)} 新陪玩已接`;
  });
  await step("中途换人：未开始的订单整单转给新陪玩", async () => {
    const o = await placeAccepted("1");
    const v = (await prisma.order.findUnique({ where: { id: o.id } })).dispatchVersion;
    const r = await call("POST", `/admin/orders/${o.id}/swap-companion`, adminToken, { newCompanionId: companion2.id, servedHours: "0", reason: "e2e 客户要求换人", dispatchVersion: v });
    const after = await prisma.order.findUnique({ where: { id: o.id } });
    expect(r.orderId === o.id && after.companionId === companion2.id && after.status === "ASSIGNED", `${after.status}`);
    await call("PATCH", `/admin/orders/${o.id}/cancel`, adminToken, { note: "e2e" });
  });
  await step("中途换人：过期版本号被拒绝（防两人同时操作）", async () => {
    const o = await placeAccepted("1");
    let rejected = false;
    try { await call("POST", `/admin/orders/${o.id}/swap-companion`, adminToken, { newCompanionId: companion2.id, servedHours: "0", reason: "e2e", dispatchVersion: o.dispatchVersion }); } catch { rejected = true; }
    await call("PATCH", `/admin/orders/${o.id}/cancel`, adminToken, { note: "e2e" }).catch(() => undefined);
    expect(rejected, "过期的版本号也能换人");
    return "已拒绝";
  });

  await step("实名/标签：后台设置后客户能看到", async () => {
    await call("PATCH", `/admin/companions/${companion.id}/credentials`, adminToken, { verified: true, badges: ["金牌护航", "零炸单"] });
    const list = await call("GET", "/orders/companions?game=DELTA_FORCE", customerToken);
    const me = list.find(c => (c.userId ?? c.id) === companion.id);
    expect(me?.verified === true && me.badges?.join() === "金牌护航,零炸单", JSON.stringify({ verified: me?.verified, badges: me?.badges }));
    expect(typeof me.completedOrders === "number" && me.completedOrders >= 1, `完成单数 ${me.completedOrders}`);
    const row = (await call("GET", "/admin/companions", adminToken)).find(c => c.userId === companion.id);
    expect(row?.verified === true && row.badges?.length === 2, "管理端陪玩列表没带回标签");
    return `完成 ${me.completedOrders} 单`;
  });
  await step("实名/标签：超过 8 个字的标签被拒绝", async () => {
    try { await call("PATCH", `/admin/companions/${companion.id}/credentials`, adminToken, { badges: ["一二三四五六七八九"] }); } catch { return "已拒绝"; }
    throw new Error("9 个字的标签被接受");
  });
  await step("经营看板：陪玩质量指标", async () => {
    const text = JSON.stringify(await call("GET", "/admin/operations", adminToken));
    expect(text.includes("complaintRate") && text.includes("blownRuns") && text.includes("qualityFlags"), "缺少质量字段");
  });
  await step("客户不能新建套餐", async () => {
    try { await call("POST", "/admin/service-packages", customerToken, { category: "x", name: "x", price: "1" }); } catch { return "已拒绝"; }
    throw new Error("客户新建了套餐");
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
    // The synthetic companion must not stay on the public list real customers pick from.
    await prisma.companionProfile.updateMany({ where: { user: { email: { in: [`e2e-companion-${run}@synthetic.invalid`, `e2e-companion2-${run}@synthetic.invalid`] } } }, data: { status: "UNLISTED", onlineStatus: "OFFLINE" } }).catch(() => undefined);
    await prisma.$disconnect();
    const failed = results.filter(r => !r.ok);
    for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  —  ${r.detail}` : ""}`);
    console.log(`\n${results.length - failed.length}/${results.length} passed (run ${run})`);
    process.exitCode = failed.length ? 1 : 0;
  });
