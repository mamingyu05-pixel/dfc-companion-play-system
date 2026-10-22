import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { AppModule } from "../src/modules/app.module";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { configureRechargeBodyParser } from "../src/recharge-body-parser";

let app: INestApplication, prisma: PrismaService, port: number, token: string, customerId: string;
let png: Buffer;
function image(bytes: number) {
  if (bytes === png.length) return "data:image/png;base64," + png.toString("base64");
  // Add a valid PNG ancillary tEXt chunk, including CRC, to hit an exact byte boundary.
  const data = Buffer.alloc(bytes - png.length - 12, 65); Buffer.from("padding\0").copy(data);
  const kindAndData = Buffer.concat([Buffer.from("tEXt"), data]);
  let crc = 0xffffffff;
  for (const byte of kindAndData) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  const size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return "data:image/png;base64," + Buffer.concat([png.subarray(0, -12), size, kindAndData, checksum, png.subarray(-12)]).toString("base64");
}
beforeAll(async () => {
  png = await sharp({ create: { width: 1, height: 1, channels: 3, background: { r: 40, g: 80, b: 120 } } }).png().toBuffer();
  app = await NestFactory.create(AppModule, { logger: false });
  configureRechargeBodyParser(app); app.setGlobalPrefix("api");
  await app.listen(0, "127.0.0.1"); port = app.getHttpServer().address().port;
  prisma = app.get(PrismaService); customerId = randomUUID();
  await prisma.user.create({ data: { id: customerId, email: `${customerId}@synthetic.invalid`, displayName: "上传边界合成客户", displayNameKey: customerId, passwordHash: "synthetic-unusable", role: "CUSTOMER", wallet: { create: { availableBalance: "1000" } } } });
  token = await app.get(JwtService).signAsync({ sub: customerId }, { secret: process.env.JWT_SECRET });
});
afterAll(async () => { await app?.close(); });

function post(body: unknown, route = "/api/wallet/recharge-requests", authenticated = true) {
  return new Promise<{ status: number; body: { message?: string } }>((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = request({ hostname: "127.0.0.1", port, path: route, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) } }, res => {
      let response = ""; res.on("data", chunk => { response += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(response) }));
    });
    req.on("error", reject); req.end(payload);
  });
}
async function check(body: unknown, expected: number, route?: string, authenticated = true) {
  const before = await prisma.rechargeRequest.count({ where: { customerId } });
  const response = await post(body, route, authenticated);
  expect(response.status).toBe(expected);
  expect(await prisma.rechargeRequest.count({ where: { customerId } })).toBe(before + (expected === 201 ? 1 : 0));
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: customerId } });
  expect(wallet.availableBalance.toString()).toBe("1000"); expect(wallet.frozenBalance.toString()).toBe("0");
  return response;
}
test.each([262144, 2097151, 2097152])("real HTTP accepts %i-byte PNG evidence without crediting funds", async bytes => {
  await check({ amount: "100", screenshotUrl: image(bytes) }, 201);
});
test("one byte over the decoded limit is rejected without persisting", async () => {
  const response = await check({ amount: "100", screenshotUrl: image(2097153) }, 400);
  expect(response.body.message).toContain("2MiB");
});
test("bounded JSON envelope returns an actionable 413", async () => {
  const response = await check({ amount: "100", screenshotUrl: image(2097152), note: "x".repeat(32768) }, 413);
  expect(response.body.message).toContain("2MiB");
});
test("other endpoints retain the default small parser limit", async () => {
  await check({ note: "x".repeat(131072) }, 413, "/api/wallet/withdrawal-requests");
});
test.each(["data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64,????", 42])("invalid evidence %s is rejected as a client error", async screenshotUrl => {
  await check({ amount: "100", screenshotUrl }, 400);
});
test("supported body still requires customer authentication", async () => {
  await check({ amount: "100", screenshotUrl: image(262144) }, 401, undefined, false);
});
test("manual verification without an image stays supported", async () => { await check({ amount: "100" }, 201); });
test("small valid image works after rejected requests", async () => { await check({ amount: "100", screenshotUrl: image(png.length) }, 201); });

test("order evidence accepts a full 2MiB screenshot over real HTTP and keeps the bounded envelope", async () => {
  const pkg = await prisma.guaranteePackage.create({ data: { platform: "PC", targetWan: 900_000 + Math.floor(Math.random() * 99_999), price: "1" } });
  const order = await prisma.order.create({ data: { customerId, orderNo: randomUUID(), mode: "synthetic", hours: "1", unitPrice: "1", totalAmount: "1",
    status: "ACCEPTED", serviceKind: "GUARANTEE", guaranteePlatform: pkg.platform, guaranteeTargetWan: pkg.targetWan } });
  const route = `/api/orders/${order.id}/evidence`;
  const count = () => prisma.orderEvidence.count({ where: { orderId: order.id } });
  expect((await post({ kind: "VAULT_START", vaultValueWan: 1000, image: image(2097152) }, route)).status).toBe(201);
  const tooLarge = await post({ kind: "VAULT_START", vaultValueWan: 1000, image: image(2097152), note: "x".repeat(32768) }, route);
  expect(tooLarge.status).toBe(413);
  expect(tooLarge.body.message).toContain("2MiB");
  expect((await post({ kind: "VAULT_START", vaultValueWan: 1000, image: image(262144) }, route, false)).status).toBe(401);
  expect(await count()).toBe(1);
});

test("text disguised as PNG is rejected before persistence", async () => { await check({ amount: "100", screenshotUrl: "data:image/png;base64," + Buffer.from("not an image").toString("base64") }, 400); });
test("declared JPEG with a PNG signature is rejected before persistence", async () => { await check({ amount: "100", screenshotUrl: image(png.length).replace("image/png", "image/jpeg") }, 400); });
