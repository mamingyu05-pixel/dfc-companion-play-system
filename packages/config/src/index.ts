export interface AppConfig {
  databaseUrl: string;
  jwtSecret: string;
  platformCommissionRate: number;
}

export function loadConfig(): AppConfig {
  const databaseUrl = process.env.DATABASE_URL;
  const jwtSecret = process.env.JWT_SECRET;

  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!jwtSecret) throw new Error("JWT_SECRET is required");

  return {
    databaseUrl,
    jwtSecret,
    platformCommissionRate: Number(process.env.PLATFORM_COMMISSION_RATE ?? "0.2")
  };
}
