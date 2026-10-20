/** Explicit local TEST runtime only. These checks never establish production health. */
type Environment = Readonly<Record<string, string | undefined>>;
export type IsolatedTestConfig = Readonly<{
  host: "127.0.0.1"; port: number; database: string; databasePort: number;
  storeKey: string; subject: string; issuer: "dfc-isolated-local"; audience: "dfc-native-isolated";
}>;

function refuse(field: string): never { throw new Error(`Isolated TEST configuration rejected: ${field}`); }
function port(value: string | undefined, field: string): number {
  if (!value || !/^\d{1,5}$/.test(value) || Number(value) < 1 || Number(value) > 65535) refuse(field);
  return Number(value);
}

export function isolatedTestConfig(env: Environment = process.env): IsolatedTestConfig | null {
  const flag = env.DFC_ISOLATED_API;
  if (flag === undefined || flag === "" || flag === "0") {
    if (env.DFC_ISOLATED_DATABASE || env.DFC_TEST_SUBJECT || env.DFC_OUTBOUND_POLICY) refuse("DFC_ISOLATED_API missing or disabled");
    return null;
  }
  if (flag !== "1") refuse("DFC_ISOLATED_API");
  if (env.NODE_ENV !== "test" || env.DFC_TEST_MODE !== "1") refuse("NODE_ENV/DFC_TEST_MODE");
  if (env.API_HOST !== "127.0.0.1") refuse("API_HOST");
  const apiPort = port(env.API_PORT, "API_PORT");
  if (env.DFC_BACKGROUND_JOBS_ENABLED !== "false") refuse("DFC_BACKGROUND_JOBS_ENABLED");
  if (env.DFC_OUTBOUND_POLICY !== "deny") refuse("DFC_OUTBOUND_POLICY");
  const database = env.DFC_ISOLATED_DATABASE ?? "", storeKey = env.DFC_STORE_KEY ?? "";
  if (!/^dfc_test_[a-z0-9_]{1,40}$/.test(database)) refuse("DFC_ISOLATED_DATABASE");
  if (!/^TEST_[A-Za-z0-9_-]{1,45}$/.test(storeKey)) refuse("DFC_STORE_KEY");
  const subject = env.DFC_TEST_SUBJECT ?? "";
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(subject)) refuse("DFC_TEST_SUBJECT");
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 64 || /\s/.test(env.JWT_SECRET)) refuse("JWT_SECRET");
  // Refuse inherited live integration settings without exposing their values.
  for (const [key, value] of Object.entries(env)) {
    if (value && (/^(KOOK_|DISCORD_|SMTP_|PAYMENT_|WECHAT_|WXPAY_|ALIPAY_|STRIPE_|BOT_)/.test(key) ||
        /^(DOMAIN|TRUSTED_PROXY_CIDRS|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NODE_OPTIONS|NODE_EXTRA_CA_CERTS)$/i.test(key))) refuse(key);
  }
  let url: URL;
  try { url = new URL(env.DATABASE_URL ?? ""); } catch { return refuse("DATABASE_URL"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1" ||
      url.pathname !== "/" + database || !/^dfc_test_[a-z0-9_]+$/.test(url.username) || !url.password || url.hash) refuse("DATABASE_URL");
  const databasePort = port(url.port, "DATABASE_URL port");
  if (databasePort === apiPort) refuse("API/PG ports collide");
  for (const [key, value] of url.searchParams) {
    if (!((key === "connection_limit" && value === "1") || (key === "pool_timeout" && value === "5"))) refuse("DATABASE_URL options");
  }
  return Object.freeze({ host: "127.0.0.1", port: apiPort, database, databasePort, storeKey, subject,
    issuer: "dfc-isolated-local", audience: "dfc-native-isolated" });
}

export function isolatedClaimsMatch(payload: unknown, config: IsolatedTestConfig): boolean {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as Record<string, unknown>;
  return value.sub === config.subject && value.role === "CUSTOMER" && value.iss === config.issuer &&
    value.aud === config.audience && value.testEnvironment === "isolated-test" &&
    value.testDatabase === config.database && value.testStore === config.storeKey;
}

export function isolatedRouteAllowed(method: string, pathname: string): boolean {
  if (method === "GET") return /^\/api\/(orders\/(environment|companions|my)|wallet\/customer-summary|orders\/requests\/[A-Za-z0-9_-]{16,96})\/?$/.test(pathname);
  return method === "POST" && /^\/api\/orders(\/preview)?\/?$/.test(pathname);
}

export function isolatedHttpBoundary(request: { method: string; url: string },
  response: { status(code: number): { json(body: unknown): unknown } }, next: () => void) {
  if (!isolatedRouteAllowed(request.method, request.url.split("?")[0])) {
    response.status(403).json({ message: "隔离测试入口不开放此操作" });
    return;
  }
  next();
}
