import { diagnoseConfig } from "../../../../../packages/config/src/diagnostics";
import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  check() {
    return {
      ...diagnoseConfig(process.env),
      processAlive: true,
      service: "maycatplay-api",
      timestamp: new Date().toISOString()
    };
  }
}
