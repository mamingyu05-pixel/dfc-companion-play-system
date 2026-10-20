import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/modules/app.module";
import { OperationsService } from "../src/modules/admin/operations.service";
import { IntegrationJobsService } from "../src/modules/bot/integration-jobs.service";

test("application wiring: production modules initialize with background delivery disabled", async () => {
  process.env.DFC_BACKGROUND_JOBS_ENABLED = "false";
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    await app.init();
    expect(app.get(OperationsService)).toBeInstanceOf(OperationsService);
    expect(app.get(IntegrationJobsService)).toBeInstanceOf(
      IntegrationJobsService,
    );
  } finally {
    await app.close();
  }
});
