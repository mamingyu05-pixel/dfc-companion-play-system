import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { isolatedTestConfig, isolatedHttpBoundary } from "./isolated-test-runtime";
import { installIsolatedNetwork } from "./isolated-test-network";
import { PrismaService } from "./modules/prisma/prisma.service";
import { orderEnvironment } from "./modules/orders/order-environment";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./modules/app.module";

import { configureRechargeBodyParser } from "./recharge-body-parser";
import { ChineseErrorFilter } from "./modules/chinese-error.filter";

async function bootstrap() {
  const isolated = isolatedTestConfig();
  const restoreNetwork = isolated ? installIsolatedNetwork(isolated) : undefined;
  let app: INestApplication | undefined;
  try {
    app = await NestFactory.create(AppModule, isolated ? { abortOnError: false } : {});
    if (isolated) app.use(isolatedHttpBoundary);
    configureRechargeBodyParser(app);
    const trustedProxies = process.env.TRUSTED_PROXY_CIDRS?.split(",").map((entry) => entry.trim()).filter(Boolean);
    if (trustedProxies?.length) app.getHttpAdapter().getInstance().set("trust proxy", trustedProxies);
    app.setGlobalPrefix("api");
    app.useGlobalFilters(new ChineseErrorFilter(app.getHttpAdapter()));
    app.enableCors({
      origin: [...new Set([process.env.CUSTOMER_WEB_URL, process.env.ADMIN_WEB_URL, process.env.COMPANION_WEB_URL]
        .filter((origin): origin is string => Boolean(origin)).map(origin => new URL(origin).origin))],
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
    });
    if (isolated) {
      await orderEnvironment(app.get(PrismaService));
      await app.listen(isolated.port, isolated.host);
    } else {
      await app.listen(Number(process.env.API_PORT ?? 4000), process.env.API_HOST ?? "0.0.0.0");
    }
  } catch (error) {
    try { await app?.close(); } finally { restoreNetwork?.(); }
    throw error;
  }
}

void bootstrap();
