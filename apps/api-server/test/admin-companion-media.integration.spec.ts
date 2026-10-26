import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { existsSync, rmdirSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import sharp from "sharp";
import { CompanionProfileStatus, Prisma, UserRole, UserStatus } from "@prisma/client";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { UploadsController } from "../src/modules/uploads/uploads.controller";
import { AppModule } from "../src/modules/app.module";

const prisma = new PrismaService();
const controller = new UploadsController(prisma, {} as JwtService);
const publicMedia = (owner: string, filename: string) =>
  (controller as unknown as { isPublicCompanionMedia(owner: string, filename: string): Promise<boolean> }).isPublicCompanionMedia(owner, filename);
const ownedUsers: string[] = [];
type MediaFields = Pick<Prisma.CompanionProfileCreateWithoutUserInput, "avatarUrl" | "photoUrls" | "voiceIntroUrl" | "payoutQrCodeUrl">;

beforeAll(() => prisma.$connect());
afterAll(async () => {
  try {
    await prisma.companionProfile.deleteMany({ where: { userId: { in: ownedUsers } } });
    await prisma.user.deleteMany({ where: { id: { in: ownedUsers } } });
    expect(await prisma.user.count({ where: { id: { in: ownedUsers } } })).toBe(0);
  } finally { await prisma.$disconnect(); }
});

async function user(role: UserRole, status: UserStatus = UserStatus.ACTIVE) {
  const id = randomUUID();
  const row = await prisma.user.create({ data: {
    id, email: `${id}@synthetic.invalid`, displayName: id, displayNameKey: id,
    passwordHash: "synthetic-unusable", role, status
  } });
  ownedUsers.push(id);
  return row;
}

async function profile(owner: string, fields: Partial<MediaFields>, status: CompanionProfileStatus = CompanionProfileStatus.LISTED) {
  await prisma.companionProfile.create({ data: {
    userId: owner, nickname: owner, skillModes: [], pricePerHour: "60", status, ...fields
  } });
}
const url = (owner: string, filename: string) => `/api/uploads/companions/${owner}/${filename}`;

test.each(["avatarUrl", "photoUrls", "voiceIntroUrl"] as const)("a listed active companion can publish an administrator upload in %s", async field => {
  const admin = await user(UserRole.ADMIN), companion = await user(UserRole.COMPANION);
  const filename = `${randomUUID()}.${field === "voiceIntroUrl" ? "mp3" : "png"}`;
  await profile(companion.id, field === "photoUrls" ? { photoUrls: [url(admin.id, filename)] } : { [field]: url(admin.id, filename) });
  expect(await publicMedia(admin.id, filename)).toBe(true);
});

test("an administrator upload without an exact public profile reference remains private", async () => {
  const admin = await user(UserRole.SUPER_ADMIN), companion = await user(UserRole.COMPANION);
  const filename = `${randomUUID()}.png`;
  await profile(companion.id, { avatarUrl: url(admin.id, `${randomUUID()}.png`) });
  expect(await publicMedia(admin.id, filename)).toBe(false);
});

test("a payout QR reference alone never publishes administrator media", async () => {
  const admin = await user(UserRole.ADMIN), companion = await user(UserRole.COMPANION);
  const filename = `${randomUUID()}.png`;
  await profile(companion.id, { payoutQrCodeUrl: url(admin.id, filename) });
  expect(await publicMedia(admin.id, filename)).toBe(false);
});

test("a public profile cannot publish another ordinary user's private upload", async () => {
  const uploader = await user(UserRole.CUSTOMER), companion = await user(UserRole.COMPANION);
  const filename = `${randomUUID()}.png`;
  await profile(companion.id, { avatarUrl: url(uploader.id, filename) });
  expect(await publicMedia(uploader.id, filename)).toBe(false);
});

test("a companion's own exact public photo keeps working", async () => {
  const companion = await user(UserRole.COMPANION), filename = `${randomUUID()}.png`;
  await profile(companion.id, { photoUrls: [url(companion.id, filename)] });
  expect(await publicMedia(companion.id, filename)).toBe(true);
});

test("unlisting a profile makes its administrator upload private again", async () => {
  const admin = await user(UserRole.ADMIN), companion = await user(UserRole.COMPANION);
  const filename = `${randomUUID()}.png`;
  await profile(companion.id, { avatarUrl: url(admin.id, filename) }, CompanionProfileStatus.UNLISTED);
  expect(await publicMedia(admin.id, filename)).toBe(false);
});

test("a banned account's listed profile does not publish its previous media", async () => {
  const companion = await user(UserRole.COMPANION, UserStatus.BANNED), filename = `${randomUUID()}.png`;
  await profile(companion.id, { avatarUrl: url(companion.id, filename) });
  expect(await publicMedia(companion.id, filename)).toBe(false);
});

test("real HTTP serves staff-uploaded public photos while QR-only uploads and unlisted media remain private", async () => {
  const admin = await user(UserRole.ADMIN), companion = await user(UserRole.COMPANION);
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  const createdFiles: string[] = [];
  const mediaRoot = resolve(process.env.UPLOAD_DIR || join(process.cwd(), "uploads"));
  const ownerDirectory = join(mediaRoot, "companions", admin.id);
  try {
    await app.listen(0, "127.0.0.1");
    const port = app.getHttpServer().address().port;
    const token = await app.get(JwtService).signAsync({ sub: admin.id, role: admin.role, sv: 0 }, { secret: process.env.JWT_SECRET });
    const call = (method: string, route: string, body?: Buffer, headers: Record<string, string> = {}) =>
      new Promise<{ status: number; body: Buffer }>((done, reject) => {
        const req = request({ hostname: "127.0.0.1", port, method, path: route, headers }, response => {
          const chunks: Buffer[] = [];
          response.on("data", chunk => chunks.push(chunk));
          response.on("end", () => done({ status: response.statusCode!, body: Buffer.concat(chunks) }));
        });
        req.on("error", reject); req.end(body);
      });
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } }).png().toBuffer();
    async function upload(purpose: string) {
      const boundary = `synthetic-${randomUUID()}`;
      const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\n${purpose}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from(`\r\n--${boundary}--\r\n`)]);
      const result = await call("POST", "/api/uploads/companion-media", body, {
        Authorization: `Bearer ${token}`, "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": String(body.length)
      });
      expect(result.status).toBe(201);
      const uploaded = JSON.parse(result.body.toString()).url as string;
      const prefix = `/api/uploads/companions/${admin.id}/`;
      expect(uploaded.startsWith(prefix)).toBe(true);
      const filename = uploaded.slice(prefix.length);
      expect(filename).toMatch(/^[a-zA-Z0-9-]+\.png$/);
      createdFiles.push(join(ownerDirectory, filename));
      return uploaded;
    }
    const photo = await upload("photo"), qr = await upload("payoutQr");
    await profile(companion.id, { photoUrls: [photo], payoutQrCodeUrl: qr });
    const publicRead = await call("GET", photo);
    expect(publicRead.status).toBe(200);
    expect((await sharp(publicRead.body).metadata()).format).toBe("png");
    expect((await call("GET", qr)).status).toBe(401);
    await prisma.companionProfile.update({ where: { userId: companion.id }, data: { status: CompanionProfileStatus.UNLISTED } });
    expect((await call("GET", photo)).status).toBe(401);
  } finally {
    await app.close();
    for (const file of createdFiles) {
      expect(dirname(resolve(file))).toBe(resolve(ownerDirectory));
      if (existsSync(file)) unlinkSync(file);
    }
    if (existsSync(ownerDirectory)) rmdirSync(ownerDirectory);
  }
});
