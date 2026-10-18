/** Offline configuration inspection only. Presence never proves connectivity. */
export type Environment = Readonly<Record<string, string | undefined>>;
type FieldStatus = "MISSING" | "PLACEHOLDER" | "INVALID" | "PRESENT_UNVERIFIED";
type Check = { configurationValid: boolean; verified: false; status: string;
  fields: Record<string, FieldStatus>; blockers: string[] };

export const TEST_WECHAT_APP_ID = "wxe2812f4a7cbb2c64";

export function placeholder(value: string): boolean {
  return /replace[-_ ]?with|change[-_ ]?me|your[-_ ]|example\.(com|org|net)|\$\{|<[^>]+>|dfc_password|^(test|demo|dummy|placeholder|fixture)([-_ ]|$)|^x{4,}$/i.test(value);
}

function checkFields(env: Environment, rules: Record<string, (value: string) => boolean>): Check {
  const fields: Record<string, FieldStatus> = {};
  for (const [key, validate] of Object.entries(rules)) {
    const value = env[key]?.trim();
    fields[key] = !value ? "MISSING" : placeholder(value) ? "PLACEHOLDER"
      : validate(value) ? "PRESENT_UNVERIFIED" : "INVALID";
  }
  const blockers = Object.entries(fields).filter(([, status]) => status !== "PRESENT_UNVERIFIED")
    .map(([key, status]) => `${key}:${status}`);
  return { configurationValid: blockers.length === 0, verified: false,
    status: blockers.length ? "BLOCKED" : "CONFIGURED_UNVERIFIED", fields, blockers };
}

const text = (value: string) => !/\s/.test(value);
const numericId = (value: string) => /^[1-9]\d*$/.test(value);
const strong = (value: string) => value.length >= 64 && text(value);
function publicHost(value: string): boolean {
  return value.includes(".") && !/^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[|::)/i.test(value)
    && !/\.(local|localhost|test|invalid|example)$/i.test(value) && !placeholder(value);
}
function https(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && publicHost(url.hostname);
  } catch { return false; }
}

export function diagnoseKook(env: Environment): Check {
  return checkFields(env, { KOOK_TOKEN: text, KOOK_VERIFY_TOKEN: text,
    KOOK_GUILD_ID: numericId, KOOK_ORDER_CHANNEL_ID: numericId,
    KOOK_DISPATCH_CHANNEL_ID: numericId, BOT_INTERNAL_TOKEN: strong });
}

export function diagnoseConfig(env: Environment, miniapp?: { appId?: string; simulation?: boolean }) {
  const deployment = checkFields(env, {
    NODE_ENV: value => value === "production",
    DOMAIN: value => /^[a-z0-9.-]+$/i.test(value) && publicHost(value),
    DATABASE_URL: value => {
      try { const url = new URL(value); return ["postgresql:", "postgres:"].includes(url.protocol)
        && Boolean(url.hostname && url.username && url.password && url.pathname.length > 1)
        && !placeholder(decodeURIComponent(url.password)); } catch { return false; }
    },
    JWT_SECRET: strong, BOT_INTERNAL_TOKEN: strong,
    CUSTOMER_WEB_URL: https, COMPANION_WEB_URL: https, ADMIN_WEB_URL: https,
  });
  for (const key of ["CUSTOMER_WEB_URL", "COMPANION_WEB_URL", "ADMIN_WEB_URL"]) {
    if (deployment.fields[key] === "PRESENT_UNVERIFIED" && env.DOMAIN?.trim()
      && new URL(env[key]!.trim()).hostname !== env.DOMAIN.trim().toLowerCase()) {
      deployment.fields[key] = "INVALID";
      deployment.blockers.push(`${key}:DOMAIN_MISMATCH`);
      deployment.configurationValid = false;
      deployment.status = "BLOCKED";
    }
  }
  const appId = miniapp?.appId?.trim();
  const appIdStatus = !appId ? "MISSING" : appId === TEST_WECHAT_APP_ID ? "TEST_ONLY"
    : /^wx[0-9a-f]{16}$/.test(appId) ? "PRESENT_UNVERIFIED" : "INVALID";
  return {
    ok: false, scope: "offline_configuration", productionReady: false,
    status: "BLOCKED", externalChecksPerformed: false,
    checks: {
      deployment: { ...deployment, blockers: [...deployment.blockers, "NEW_DEPLOYMENT_NOT_VERIFIED"] },
      kook: diagnoseKook(env),
      backgroundJobs: { enabled: env.DFC_BACKGROUND_JOBS_ENABLED === "true", verified: false,
        status: env.DFC_BACKGROUND_JOBS_ENABLED === "true" ? "ENABLED_UNVERIFIED" : "BLOCKED",
        blockers: env.DFC_BACKGROUND_JOBS_ENABLED === "true" ? ["WORKER_HEARTBEAT_NOT_VERIFIED"] : ["BACKGROUND_JOBS_DISABLED"] },
      miniapp: { verified: false, appIdStatus, status: "BLOCKED",
        blockers: ["WECHAT_LOGIN_BINDING_NOT_IMPLEMENTED", "MINIAPP_API_NOT_BOUND",
          ...(miniapp?.simulation !== false ? ["SIMULATION_ONLY"] : []),
          ...(appIdStatus === "TEST_ONLY" ? ["TEST_APPID_IS_NOT_PAYMENT_AUTHORIZATION"] : [])] },
      payment: { verified: false, status: "BLOCKED", manualRechargeImplemented: true,
        blockers: ["PAYMENT_CHANNEL_AND_MERCHANT_NOT_CONFIRMED", "LIVE_PAYMENT_ADAPTER_NOT_BOUND",
          "SIGNED_CALLBACK_AND_PERSISTENT_LEDGER_NOT_BOUND"] },
    },
  };
}
