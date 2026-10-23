import { randomUUID } from "node:crypto";
import { BotPlatform, UserRole } from "@prisma/client";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { WalletService } from "../src/modules/wallet/wallet.service";
import { BotNotificationService } from "../src/modules/bot/bot-notification.service";
import { AdminBatchController } from "../src/modules/admin/batch.controller";
import { toCsv } from "../src/modules/admin/csv";

const prisma = new PrismaService();
const notifications = { syncCustomerMembershipLevels: jest.fn().mockResolvedValue([]) } as unknown as BotNotificationService;
const wallet = new WalletService(prisma, notifications);
const batch = new AdminBatchController(prisma, wallet);
beforeAll(() => prisma.$connect());
afterAll(() => prisma.$disconnect());

async function user(role: UserRole, name: string = randomUUID()) {
  return prisma.user.create({ data: {
    email: `${randomUUID()}@synthetic.invalid`, displayName: name, displayNameKey: name.toLowerCase(), passwordHash: "x", role,
    wallet: { create: {} },
    ...(role === "COMPANION" ? { companionProfile: { create: { nickname: name, skillModes: [], pricePerHour: "50.00", status: "LISTED" } } } : {})
  } });
}
const actor = async () => ({ id: (await user("ADMIN")).id, role: UserRole.ADMIN }) as never;

test("staff-recorded recharge credits like an approved recharge, counts as recharge, and replays on retry", async () => {
  const staff = await actor();
  const customer = await user("CUSTOMER", `代充客户${randomUUID().slice(0, 6)}`);
  await prisma.userExternalAccount.create({ data: { userId: customer.id, platform: BotPlatform.KOOK, externalUserId: String(Date.now()), displayName: "kook昵称X" } });
  const found = await batch.searchCustomers(customer.displayName.slice(0, 6));
  expect(found.map(f => f.id)).toContain(customer.id);
  expect(found.find(f => f.id === customer.id)?.platforms).toEqual(["KOOK:kook昵称X"]);

  const requestId = randomUUID();
  await expect(batch.recordStaffRecharge(staff, { customerId: customer.id, amount: "100", method: "NOPE", requestId })).rejects.toThrow("付款方式");
  const first = await batch.recordStaffRecharge(staff, { customerId: customer.id, amount: "100", method: "WECHAT", note: "转账尾号1234", requestId });
  expect(first.replayed).toBe(false);
  expect(first.recharge).toMatchObject({ status: "APPROVED", reviewNote: "客服代录·微信·转账尾号1234" });
  const again = await batch.recordStaffRecharge(staff, { customerId: customer.id, amount: "100", method: "WECHAT", requestId });
  expect(again).toMatchObject({ replayed: true, recharge: { id: first.recharge.id } });
  const other = await user("CUSTOMER");
  await expect(batch.recordStaffRecharge(staff, { customerId: other.id, amount: "100", method: "WECHAT", requestId })).rejects.toThrow("其他客户");

  const ledger = await prisma.walletTransaction.findMany({ where: { userId: customer.id, type: "RECHARGE_APPROVED" } });
  expect(ledger.map(l => l.amount.toString())).toEqual(["100"]);
  expect(await prisma.rechargeRequest.count({ where: { customerId: customer.id, status: "APPROVED" } })).toBe(1);
  const balance = (await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.id } })).availableBalance;
  expect(balance.gte(100)).toBe(true);
  expect(notifications.syncCustomerMembershipLevels).toHaveBeenCalledWith(customer.id);
});

test("batch recharge review refuses stale totals and reviews each request through the normal path", async () => {
  const staff = await actor();
  const a = await user("CUSTOMER");
  const b = await user("CUSTOMER");
  const r1 = await wallet.createRechargeRequest(a.id, { amount: "30" });
  const r2 = await wallet.createRechargeRequest(b.id, { amount: "70.50" });
  await expect(batch.reviewRecharges(staff, { ids: [r1.id, r2.id], status: "APPROVED", expectedTotal: "100" })).rejects.toThrow("合计金额已变化");
  expect(await prisma.rechargeRequest.count({ where: { id: { in: [r1.id, r2.id] }, status: "PENDING" } })).toBe(2);
  expect(await batch.reviewRecharges(staff, { ids: [r1.id, r2.id], status: "APPROVED", expectedTotal: "100.50" })).toEqual({ done: 2, failed: [] });
  await expect(batch.reviewRecharges(staff, { ids: [r1.id], status: "REJECTED", expectedTotal: "30" })).rejects.toThrow("已被处理");
  await expect(batch.reviewRecharges(staff, { ids: [], status: "APPROVED", expectedTotal: "0" })).rejects.toThrow("至少选择");
});

test("batch companion and user updates touch only allowed targets and leave an audit trail", async () => {
  const staff = await actor();
  const [c1, c2] = [await user("COMPANION"), await user("COMPANION")];
  expect(await batch.updateCompanions(staff, { userIds: [c1.id, c2.id, "missing-id"], status: "UNLISTED", pricePerHour: "88", commissionRate: "0.25" }))
    .toEqual({ updated: 2, missing: 1 });
  const profiles = await prisma.companionProfile.findMany({ where: { userId: { in: [c1.id, c2.id] } } });
  expect(profiles.map(p => [p.status, p.pricePerHour.toString(), p.commissionRate.toString()])).toEqual([["UNLISTED", "88", "0.25"], ["UNLISTED", "88", "0.25"]]);
  await expect(batch.updateCompanions(staff, { userIds: [c1.id], commissionRate: "1.5" })).rejects.toThrow("0 到 1");
  await expect(batch.updateCompanions(staff, { userIds: [c1.id] })).rejects.toThrow("没有需要修改");

  const customer = await user("CUSTOMER");
  const admin = await user("ADMIN");
  expect(await batch.updateUserStatus(staff, { ids: [customer.id, admin.id, c1.id], status: "BANNED" })).toEqual({ updated: 2, skipped: 1 });
  expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).status).toBe("ACTIVE");
  expect((await prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).status).toBe("BANNED");
  expect(await prisma.adminLog.count({ where: { actorId: (staff as { id: string }).id, action: { in: ["BATCH_UPDATE_COMPANION", "BAN_USER"] } } })).toBe(4);
});

test("CSV export is Excel-friendly and neutralises formulas", async () => {
  const csv = toCsv(["名字", "备注"], [["=HYPERLINK(\"x\")", "a,b"], [null, "-1"]]);
  expect(csv.startsWith("﻿名字,备注\r\n")).toBe(true);
  expect(csv).toContain(`"'=HYPERLINK(""x"")","a,b"`);
  expect(csv).toContain(",'-1\r\n");
  const staff = await actor();
  for (const kind of ["users", "orders", "recharges"]) expect((await batch.exportCsv(staff, kind)).startsWith("﻿")).toBe(true);
  await expect(batch.exportCsv(staff, "secrets")).rejects.toThrow("可导出");
});
