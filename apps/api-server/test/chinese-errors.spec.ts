import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BadRequestException, HttpException, NotFoundException } from "@nestjs/common";
import { ChineseErrorFilter } from "../src/modules/chinese-error.filter";
import { hasChineseError, toChineseError } from "../src/modules/error-messages";

test("known, patterned, Chinese and unknown messages", () => {
  expect(toChineseError("Insufficient balance")).toBe("余额不足，请先充值");
  expect(toChineseError("Order cannot be accepted from status COMPLETED")).toBe("订单当前状态不能接单，请刷新");
  expect(toChineseError("amount must be positive, have at most 2 decimal places and not exceed 999999.99")).toBe("金额必须大于 0，最多 2 位小数，且不超过 999999.99");
  expect(toChineseError("只有本单陪玩可以操作")).toBe("只有本单陪玩可以操作");
  expect(toChineseError("Something brand new")).toBe("Something brand new");
});

// Messages only operators see while configuring or wiring the server; customers and companions never reach them.
const INTERNAL = new Set([
  "BOT_INTERNAL_TOKEN is not configured", "JWT_SECRET is not configured", "KOOK_VERIFY_TOKEN is not configured",
  "KOOK encrypted webhook requires KOOK_ENCRYPT_KEY", "Invalid KOOK encrypted webhook payload", "Invalid KOOK verify token",
  "KOOK event requires an outer d.msg_id; card and timestamp fallback is not supported", "Invalid bot token",
  "Missing KOOK order accept payload", "Missing KOOK order draft apply payload", "Missing verified KOOK button identity",
  "Isolated test customer required", "Invalid provider wallet business key", "Invalid upload path",
  "MULTI_COMPANION_DISCOUNT_MIN_COUNT must be a positive integer", "Unsupported source platform"
]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
  });
}

test("every English error a user can see has Chinese wording", () => {
  const thrown = new Set<string>();
  for (const file of sources(join(__dirname, "../src"))) {
    for (const match of readFileSync(file, "utf8").matchAll(/Exception\("([A-Za-z][^"]*)"/g)) thrown.add(match[1]);
  }
  // Admin-only field validation ("sortOrder must be an integer" and the like) may stay English; everything else may not.
  const adminFieldCheck = /^[a-z][A-Za-z]* (must|is|cannot|and) /;
  const missing = [...thrown].filter(m => !INTERNAL.has(m) && !adminFieldCheck.test(m) && !hasChineseError(m));
  expect(missing).toEqual([]);
});

function respond(exception: unknown) {
  let sent: { status?: number; body?: unknown } = {};
  const adapter = { reply: (_res: unknown, body: unknown, status: number) => { sent = { status, body }; }, isHeadersSent: () => false, end: () => undefined };
  const host = { getType: () => "http", getArgByIndex: () => ({}), switchToHttp: () => ({ getResponse: () => ({}), getRequest: () => ({}) }), getArgs: () => [{}, {}] };
  new ChineseErrorFilter(adapter as never).catch(exception, host as never);
  return sent;
}

test("the HTTP filter answers in Chinese and keeps the status code", () => {
  expect(respond(new BadRequestException("Companion is busy"))).toMatchObject({ status: 400, body: { message: "这位陪玩正在忙" } });
  expect(respond(new NotFoundException())).toMatchObject({ status: 404, body: { message: "请求的内容不存在" } });
  expect(respond(new HttpException("Insufficient role", 403))).toMatchObject({ status: 403, body: { message: "这个账号没有权限进行此操作" } });
  expect(respond(new Error("database exploded"))).toMatchObject({ status: 500 });
  expect(JSON.stringify(respond(new Error("database exploded")).body)).not.toContain("database exploded");
});
