import { Body, Controller, Module, Post, UseGuards } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { request } from "node:http";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import sharp from "sharp";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { AuthRateLimitGuard } from "../src/modules/auth/auth-rate-limit.guard";
import { JwtAuthGuard } from "../src/modules/auth/jwt-auth.guard";
import {
  UploadsController,
  normalizeMedia,
} from "../src/modules/uploads/uploads.controller";
import { OperationsController } from "../src/modules/admin/operations.controller";
import { OperationsService } from "../src/modules/admin/operations.service";
import { RolesGuard } from "../src/modules/auth/roles.guard";
import { OrdersController } from "../src/modules/orders/orders.controller";
import { OrdersService } from "../src/modules/orders/orders.service";
import { OrderDraftsService } from "../src/modules/orders/order-drafts.service";
import { NotificationDeliveryService } from "../src/modules/bot/notification-delivery.service";

const prisma = new PrismaService();
@Controller("synthetic-auth")
class LoginProbe {
  @Post("login")
  @UseGuards(AuthRateLimitGuard)
  login(@Body() _body: unknown) {
    return { ok: true };
  }
}
@Module({
  imports: [JwtModule.register({})],
  controllers: [
    LoginProbe,
    UploadsController,
    OperationsController,
    OrdersController,
  ],
  providers: [
    JwtAuthGuard,
    RolesGuard,
    AuthRateLimitGuard,
    OperationsService,
    NotificationDeliveryService,
    { provide: PrismaService, useValue: prisma },
    {
      provide: OrdersService,
      useFactory: () =>
        new OrdersService(prisma, {
          syncCustomerMembershipLevels: async () => [],
        } as any),
    },
    { provide: OrderDraftsService, useValue: {} },
  ],
})
class SyntheticHttpModule {}

let apps: INestApplication[];
async function call(
  app: INestApplication,
  path: string,
  options: {
    method?: string;
    body?: Buffer;
    headers?: Record<string, string>;
  } = {},
) {
  const address = app.getHttpServer().address();
  return new Promise<{
    status: number;
    headers: Record<string, unknown>;
    body: Buffer;
  }>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path,
        method: options.method ?? "GET",
        headers: options.headers,
      },
      (res) => {
        const data: Buffer[] = [];
        res.on("data", (b) => data.push(b));
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            body: Buffer.concat(data),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}
beforeAll(async () => {
  apps = await Promise.all(
    [1, 2].map(async () => {
      const app = await NestFactory.create(SyntheticHttpModule, {
        logger: false,
      });
      await app.listen(0, "127.0.0.1");
      return app;
    }),
  );
});
afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  await prisma.$disconnect();
});

test("operations HTTP: unauthenticated and customer access is blocked; admin can read a filtered report", async () => {
  expect((await call(apps[0], "/admin/operations")).status).toBe(401);
  for (const role of ["CUSTOMER", "ADMIN"] as const) {
    const id = randomUUID();
    await prisma.user.create({
      data: {
        id,
        email: `${id}@synthetic.invalid`,
        displayName: id,
        displayNameKey: id,
        passwordHash: "synthetic",
        role,
      },
    });
    const token = await apps[0]
      .get(JwtService)
      .signAsync({ sub: id, role }, { secret: process.env.JWT_SECRET });
    const report = await call(apps[0], `/admin/operations?store=${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(report.status).toBe(role === "ADMIN" ? 200 : 403);
    if (role === "ADMIN")
      expect(
        JSON.parse(report.body.toString()).financial.recognizedOrderCount,
      ).toBe(0);
  }
});

test("notification reconciliation HTTP: only admins may inspect or resolve outcomes; API never returns stored message bodies", async () => {
  const row = await prisma.notificationDelivery.create({
    data: {
      key: randomUUID(),
      businessKey: "synthetic-permission-check",
      platform: "DISCORD",
      target: "synthetic",
      path: "/channels/synthetic/messages",
      requestBody: { content: "synthetic private message body" },
      status: "UNKNOWN",
    },
  });
  const path = `/admin/operations/deliveries/${row.id}/reconcile`;
  expect((await call(apps[0], path, { method: "PATCH" })).status).toBe(401);
  for (const role of ["CUSTOMER", "COMPANION", "ADMIN"] as const) {
    const id = randomUUID();
    await prisma.user.create({
      data: {
        id,
        email: `${id}@synthetic.invalid`,
        displayName: id,
        displayNameKey: id,
        passwordHash: "synthetic",
        role,
      },
    });
    const token = await apps[0]
      .get(JwtService)
      .signAsync({ sub: id, role }, { secret: process.env.JWT_SECRET });
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const list = await call(apps[0], "/admin/operations/deliveries", {
      headers,
    });
    expect(list.status).toBe(role === "ADMIN" ? 200 : 403);
    if (role === "ADMIN")
      expect(list.body.toString()).not.toContain(
        "synthetic private message body",
      );
    const result = await call(apps[0], path, {
      method: "PATCH",
      headers,
      body: Buffer.from(
        JSON.stringify({
          decision: "SENT",
          evidence: "Synthetic platform receipt verified by administrator",
          messageId: "observed-synthetic",
        }),
      ),
    });
    expect(result.status).toBe(role === "ADMIN" ? 200 : 403);
  }
  expect(
    (
      await prisma.notificationDelivery.findUniqueOrThrow({
        where: { id: row.id },
      })
    ).status,
  ).toBe("SENT");
});

test("fulfillment HTTP: companion reporting cannot settle income; owner acceptance settles once through authenticated routes", async () => {
  const people = [];
  for (const role of ["CUSTOMER", "COMPANION", "CUSTOMER"] as const) {
    const id = randomUUID();
    const person = await prisma.user.create({
      data: {
        id,
        email: `${id}@synthetic.invalid`,
        displayName: id,
        displayNameKey: id,
        passwordHash: "synthetic",
        role,
        wallet: {
          create: { frozenBalance: role === "CUSTOMER" ? "100" : "0" },
        },
      },
    });
    const token = await apps[0]
      .get(JwtService)
      .signAsync({ sub: id, role }, { secret: process.env.JWT_SECRET });
    people.push({ ...person, token });
  }
  const [customer, companion, outsider] = people;
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      companionId: companion.id,
      orderNo: randomUUID(),
      mode: "synthetic",
      hours: "1",
      unitPrice: "100",
      totalAmount: "100",
      status: "IN_PROGRESS",
      startedAt: new Date(0),
      commissionRateSnapshot: "0.2",
    },
  });
  const patch = (action: string, token: string) =>
    call(apps[0], `/orders/${order.id}/${action}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: Buffer.from("{}"),
    });
  expect((await patch("complete", companion.token)).status).toBe(200);
  expect(
    (
      await prisma.wallet.findUniqueOrThrow({ where: { userId: companion.id } })
    ).availableIncome.toString(),
  ).toBe("0");
  expect((await patch("confirm-completion", companion.token)).status).toBe(403);
  expect((await patch("confirm-completion", outsider.token)).status).toBe(400);
  expect((await patch("confirm-completion", customer.token)).status).toBe(200);
  expect((await patch("confirm-completion", customer.token)).status).toBe(400);
  expect(
    (
      await prisma.wallet.findUniqueOrThrow({ where: { userId: companion.id } })
    ).availableIncome.toString(),
  ).toBe("80");
});

test("rate limit: query, portal and forged XFF changes cannot reset account budget across two API instances", async () => {
  const email = `${randomUUID()}@synthetic.invalid`;
  for (let i = 0; i < 10; i++) {
    const response = await call(
      apps[i % 2],
      `/synthetic-auth/login?attempt=${i}`,
      {
        method: "POST",
        body: Buffer.from(JSON.stringify({ email, portal: `variant-${i}` })),
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": `198.51.100.${i}`,
        },
      },
    );
    expect(response.status).toBe(i < 5 ? 201 : 429);
  }
});

test("uploads: unauthenticated multipart upload is rejected by the actual HTTP guard", async () => {
  const response = await call(apps[0], "/uploads/companion-media", {
    method: "POST",
  });
  expect(response.status).toBe(401);
});

test("uploads: fake MIME, SVG, HTML extension and corrupt images are rejected", async () => {
  const html = Buffer.from("<!doctype html><p>synthetic harmless marker</p>");
  await expect(
    normalizeMedia(html, "payload.png", "image/png", false),
  ).rejects.toThrow();
  await expect(
    normalizeMedia(html, "payload.html", "image/png", false),
  ).rejects.toThrow();
  await expect(
    normalizeMedia(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      "payload.svg",
      "image/png",
      false,
    ),
  ).rejects.toThrow();
  await expect(
    normalizeMedia(html, "payload.mp3", "audio/mpeg", true),
  ).rejects.toThrow();
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  await expect(
    normalizeMedia(png, "mismatch.jpg", "image/jpeg", false),
  ).rejects.toThrow();
});

test("uploads: legal image is re-encoded and served with non-executable response headers; other users cannot read private media", async () => {
  const id = randomUUID();
  const owner = await prisma.user.create({
    data: {
      email: `${id}@synthetic.invalid`,
      displayName: id,
      displayNameKey: id,
      passwordHash: "synthetic",
      role: "COMPANION",
      companionProfile: {
        create: {
          nickname: id,
          skillModes: [],
          pricePerHour: "15",
          status: "LISTED",
        },
      },
    },
  });
  const token = await apps[0]
    .get(JwtService)
    .signAsync(
      { sub: owner.id, role: owner.role },
      { secret: process.env.JWT_SECRET },
    );
  const image = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "blue" },
  })
    .jpeg()
    .toBuffer();
  const boundary = "synthetic-boundary";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nphoto\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    ),
    image,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const uploaded = await call(apps[0], "/uploads/companion-media", {
    method: "POST",
    body,
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      Authorization: `Bearer ${token}`,
    },
  });
  expect(uploaded.status).toBe(201);
  const { url } = JSON.parse(uploaded.body.toString());
  expect(url).toMatch(/\.png$/);
  const privateRead = await call(apps[0], url.replace(/^\/api/, ""));
  expect(privateRead.status).toBe(401);
  const otherId = randomUUID();
  const other = await prisma.user.create({
    data: {
      email: `${otherId}@synthetic.invalid`,
      displayName: otherId,
      displayNameKey: otherId,
      passwordHash: "synthetic",
      role: "CUSTOMER",
    },
  });
  const otherToken = await apps[0]
    .get(JwtService)
    .signAsync(
      { sub: other.id, role: other.role },
      { secret: process.env.JWT_SECRET },
    );
  expect(
    (
      await call(apps[0], url.replace(/^\/api/, ""), {
        headers: { Authorization: `Bearer ${otherToken}` },
      })
    ).status,
  ).toBe(403);
  await prisma.companionProfile.update({
    where: { userId: owner.id },
    data: { photoUrls: [url] },
  });
  const media = await call(apps[0], url.replace(/^\/api/, ""));
  expect(media.status).toBe(200);
  expect(media.headers["content-type"]).toBe("image/png");
  expect(media.headers["x-content-type-options"]).toBe("nosniff");
  expect(media.headers["content-security-policy"]).toContain("sandbox");
  expect((await sharp(media.body).metadata()).format).toBe("png");
});
