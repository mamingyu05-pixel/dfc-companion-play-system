import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./modules/app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: [process.env.CUSTOMER_WEB_URL, process.env.ADMIN_WEB_URL, process.env.COMPANION_WEB_URL].filter((origin): origin is string => Boolean(origin)),
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
  });
  await app.listen(Number(process.env.API_PORT ?? 4000));
}

void bootstrap();
