import "reflect-metadata";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./modules/app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const uploadRoot = process.env.UPLOAD_DIR || join(process.cwd(), "uploads");
  if (!existsSync(uploadRoot)) mkdirSync(uploadRoot, { recursive: true });
  app.useStaticAssets(uploadRoot, { prefix: "/uploads/" });
  app.setGlobalPrefix("api");
  app.enableCors();
  await app.listen(Number(process.env.API_PORT ?? 4000));
}

void bootstrap();
