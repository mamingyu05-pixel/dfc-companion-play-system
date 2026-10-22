import { randomUUID } from "node:crypto";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { OrdersService } from "../src/modules/orders/orders.service";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";
import { guaranteeProgress, parseEvidenceInput } from "../src/modules/orders/guarantee";

const prisma = new PrismaService();
const notifications = {
  syncCustomerMembershipLevels: jest.fn().mockResolvedValue([]),
  sendOrderAssignedNotifications: jest.fn().mockResolvedValue([]),
} as unknown as BotNotificationService;
const orders = new OrdersService(prisma, notifications);
const PNG = "data:image/png;base64,iVBORw0KGgo=";
beforeAll(() => prisma.$connect());
afterAll(() => prisma.$disconnect());

async function user(role: UserRole, balance = "0") {
  const suffix = randomUUID();
  return prisma.user.create({
    data: {
      email: `${suffix}@synthetic.invalid`, displayName: suffix, displayNameKey: suffix,
      passwordHash: "synthetic-unusable-hash", role,
      wallet: { create: { availableBalance: balance } },
      ...(role === "COMPANION"
        ? { companionProfile: { create: { nickname: suffix, skillModes: [], pricePerHour: "15", commissionRate: "0.5", status: "LISTED" } } }
        : {}),
    },
  });
}
// Each test gets its own package so price edits elsewhere cannot leak in.
const pkg = (price = "100.00", isActive = true) =>
  prisma.guaranteePackage.create({ data: { platform: "PC", targetWan: 100 + Math.floor(Math.random() * 1_000_000), price, isActive } });
const wallet = (userId: string) => prisma.wallet.findUniqueOrThrow({ where: { userId } });
const actor = (u: { id: string; role: UserRole }) => ({ id: u.id, role: u.role });

test("guarantee: package price is frozen once, snapshotted, and a changed price stops submission", async () => {
  const [customer, companion, p] = await Promise.all([user("CUSTOMER", "250"), user("COMPANION"), pkg()]);
  const preview = await orders.previewGuaranteeOrder(customer.id, { packageId: p.id, companionId: companion.id });
  expect(preview).toMatchObject({ totalAmount: "100.00", targetWan: p.targetWan, mode: `保底护航 ${p.targetWan}W · 端游` });

  await expect(orders.createGuaranteeOrder(customer.id, { requestId: randomUUID(), packageId: p.id, companionId: companion.id, expectedTotalAmount: "99" }))
    .rejects.toThrow("价格已变化");
  expect((await wallet(customer.id)).availableBalance.toString()).toBe("250");

  const requestId = randomUUID();
  const order = await orders.createGuaranteeOrder(customer.id, { requestId, packageId: p.id, companionId: companion.id, expectedTotalAmount: "100.00" });
  const replay = await orders.createGuaranteeOrder(customer.id, { requestId, packageId: p.id, companionId: companion.id, expectedTotalAmount: "100.00" });
  expect(replay.id).toBe(order.id);
  expect(order).toMatchObject({ serviceKind: "GUARANTEE", guaranteePlatform: "PC", guaranteeTargetWan: p.targetWan, status: "PAID" });
  expect(order.totalAmount.toString()).toBe("100");
  expect(order.hours.toString()).toBe("1");
  expect(order.commissionRateSnapshot.toString()).toBe("0.5");
  const w = await wallet(customer.id);
  expect([w.availableBalance.toString(), w.frozenBalance.toString()]).toEqual(["150", "100"]);

  // A later price edit never rewrites the purchased snapshot.
  await prisma.guaranteePackage.update({ where: { id: p.id }, data: { price: "300" } });
  expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).totalAmount.toString()).toBe("100");

  const inactive = await pkg("10", false);
  await expect(orders.createGuaranteeOrder(customer.id, { requestId: randomUUID(), packageId: inactive.id })).rejects.toThrow("已下架");
  const listed = await orders.listGuaranteePackages();
  expect(listed.some(x => x.id === inactive.id)).toBe(false);
});

test("guarantee: completion requires evidenced net gain, then settles through normal acceptance", async () => {
  const [customer, companion, outsider, p] = await Promise.all([user("CUSTOMER", "100"), user("COMPANION"), user("CUSTOMER"), pkg()]);
  const order = await orders.createGuaranteeOrder(customer.id, { requestId: randomUUID(), packageId: p.id, companionId: companion.id });
  // A future start time proves the hourly duration gate does not apply to outcome-priced orders.
  await prisma.order.update({ where: { id: order.id }, data: { status: "IN_PROGRESS", startedAt: new Date(Date.now() + 3_600_000) } });

  await expect(orders.completeOrder(order.id, companion.id)).rejects.toThrow("保底单需先上传开局和结束仓库截图");
  await expect(orders.addOrderEvidence(order.id, actor(outsider), parseEvidenceInput({ kind: "VAULT_START", vaultValueWan: 1, image: PNG })))
    .rejects.toBeInstanceOf(NotFoundException);
  await expect(orders.listOrderEvidence(order.id, actor(outsider))).rejects.toBeInstanceOf(NotFoundException);

  await orders.addOrderEvidence(order.id, actor(customer), parseEvidenceInput({ kind: "VAULT_START", vaultValueWan: 1000, image: PNG }));
  await orders.addOrderEvidence(order.id, actor(companion), parseEvidenceInput({ kind: "VAULT_END", vaultValueWan: 1000 + p.targetWan - 1, image: PNG }));
  await expect(orders.completeOrder(order.id, companion.id)).rejects.toThrow(`当前净增 ${p.targetWan - 1} 万 / 目标 ${p.targetWan} 万`);
  // Re-uploading a higher start cannot shrink the target; the earliest start stays the baseline.
  await orders.addOrderEvidence(order.id, actor(companion), parseEvidenceInput({ kind: "VAULT_START", vaultValueWan: 5000, image: PNG }));
  await orders.addOrderEvidence(order.id, actor(companion), parseEvidenceInput({ kind: "VAULT_END", vaultValueWan: 1000 + p.targetWan, image: PNG, note: "最后一局撤离" }));

  const view = await orders.listOrderEvidence(order.id, actor(customer));
  expect(view.progress).toEqual({ startWan: 1000, endWan: 1000 + p.targetWan, gainWan: p.targetWan, reached: true });
  expect(view.evidence.map(e => e.uploader)).toEqual(["客户", "陪玩", "陪玩", "陪玩"]);

  const reported = await orders.completeOrder(order.id, companion.id);
  expect(reported.status).toBe("AWAITING_ACCEPTANCE");
  await expect(orders.addOrderEvidence(order.id, actor(companion), parseEvidenceInput({ kind: "VAULT_END", vaultValueWan: 1, image: PNG })))
    .rejects.toThrow("仓库凭证只能在接单后、报完成前上传");
  await orders.addOrderEvidence(order.id, actor(customer), parseEvidenceInput({ kind: "RECORDING", linkUrl: "https://example.invalid/clip" }));

  const accepted = await orders.acceptCompletion(order.id, customer.id);
  expect(accepted.status).toBe("COMPLETED");
  const [c, k] = await Promise.all([wallet(customer.id), wallet(companion.id)]);
  expect([c.availableBalance.toString(), c.frozenBalance.toString()]).toEqual(["0", "0"]);
  expect(k.availableIncome.toString()).toBe("50");
});

test("guarantee: a missed guarantee can be fully refunded through the existing dispute settlement", async () => {
  const [customer, companion, admin, p] = await Promise.all([user("CUSTOMER", "100"), user("COMPANION"), user("ADMIN"), pkg()]);
  const order = await orders.createGuaranteeOrder(customer.id, { requestId: randomUUID(), packageId: p.id, companionId: companion.id });
  await prisma.order.update({ where: { id: order.id }, data: { status: "DISPUTED", disputeFromStatus: "IN_PROGRESS", startedAt: new Date() } });
  const resolved = await orders.acceptCompletion(order.id, admin.id, "保底未达成，全额退回", "100");
  expect(resolved.status).toBe("REFUNDED");
  const w = await wallet(customer.id);
  expect([w.availableBalance.toString(), w.frozenBalance.toString()]).toEqual(["100", "0"]);
  expect((await wallet(companion.id)).availableIncome.toString()).toBe("0");
});

test("guarantee: vault evidence is limited to guarantee orders; admins edit prices with an audit log", async () => {
  const [customer, companion, admin, p] = await Promise.all([user("CUSTOMER", "100"), user("COMPANION"), user("ADMIN"), pkg()]);
  const hourly = await orders.createOrder(customer.id, { requestId: randomUUID(), mode: "娱乐", hours: "1", companionId: companion.id });
  await prisma.order.update({ where: { id: hourly.id }, data: { status: "IN_PROGRESS" } });
  await expect(orders.addOrderEvidence(hourly.id, actor(customer), parseEvidenceInput({ kind: "VAULT_START", vaultValueWan: 1, image: PNG })))
    .rejects.toThrow("仓库凭证只用于保底单");
  const recording = await orders.addOrderEvidence(hourly.id, actor(customer), parseEvidenceInput({ kind: "OTHER", image: PNG }));
  expect(recording.kind).toBe("OTHER");
  expect((await orders.listOrderEvidence(hourly.id, actor(admin))).progress).toBeNull();

  const updated = await orders.updateGuaranteePackage(admin.id, p.id, { price: "66.6", isActive: false });
  expect(updated).toMatchObject({ price: "66.60", isActive: false });
  const log = await prisma.adminLog.findFirstOrThrow({ where: { entityId: p.id, action: "UPDATE_GUARANTEE_PACKAGE" } });
  expect(log.detail).toMatchObject({ before: { price: "100.00", isActive: true }, after: { price: "66.60", isActive: false } });
  await expect(orders.updateGuaranteePackage(admin.id, p.id, {})).rejects.toBeInstanceOf(BadRequestException);
  await expect(orders.updateGuaranteePackage(admin.id, p.id, { price: "-1" })).rejects.toBeInstanceOf(BadRequestException);
});

test("guarantee evidence input: rejects malformed bodies and keeps the earliest start baseline", () => {
  for (const [body, message] of [
    [null, "凭证内容无效"],
    [{ kind: "SELFIE" }, "请选择凭证类型"],
    [{ kind: "VAULT_START", image: PNG }, "请填写仓库总价值"],
    [{ kind: "VAULT_END", vaultValueWan: -1, image: PNG }, "请填写仓库总价值"],
    [{ kind: "VAULT_END", vaultValueWan: 1.5, image: PNG }, "请填写仓库总价值"],
    [{ kind: "VAULT_END", vaultValueWan: 10 }, "仓库凭证必须附截图"],
    [{ kind: "OTHER", vaultValueWan: 3, image: PNG }, "只有仓库截图可以填写仓库价值"],
    [{ kind: "RECORDING" }, "请附截图或录屏链接"],
    [{ kind: "RECORDING", linkUrl: "javascript:alert(1)" }, "录屏链接无效"],
    [{ kind: "RECORDING", linkUrl: "https://u:p@example.invalid/x" }, "录屏链接无效"],
    [{ kind: "OTHER", image: "data:image/png;base64,AAAA" }, "凭证仅支持PNG、JPEG、WebP、GIF图片"],
    [{ kind: "OTHER", image: PNG, note: "x".repeat(201) }, "备注最多200字"],
  ] as const) expect(() => parseEvidenceInput(body)).toThrow(message);

  const at = (s: number) => new Date(s * 1000);
  expect(guaranteeProgress(100, [])).toEqual({ startWan: null, endWan: null, gainWan: null, reached: false });
  expect(guaranteeProgress(100, [
    { kind: "VAULT_END", vaultValueWan: 400, createdAt: at(3) },
    { kind: "VAULT_START", vaultValueWan: 350, createdAt: at(2) },
    { kind: "VAULT_START", vaultValueWan: 300, createdAt: at(1) },
    { kind: "VAULT_END", vaultValueWan: 390, createdAt: at(4) },
  ])).toEqual({ startWan: 300, endWan: 390, gainWan: 90, reached: false });
});
