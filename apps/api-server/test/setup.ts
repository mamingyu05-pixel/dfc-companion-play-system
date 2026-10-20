import "reflect-metadata";

const database = new URL(process.env.DATABASE_URL || "http://invalid");
if (
  process.env.DFC_TEST_MODE !== "1" ||
  !["127.0.0.1", "localhost"].includes(database.hostname) ||
  database.pathname !== "/dfc_synthetic"
) {
  throw new Error(
    "Tests require the dedicated loopback dfc_synthetic database and DFC_TEST_MODE=1",
  );
}
for (const key of Object.keys(process.env)) {
  if (/DISCORD|KOOK|SMTP|OPENAI|ANTHROPIC|DEEPSEEK|PAYMENT|PAYOUT/.test(key))
    delete process.env[key];
}
global.fetch = jest.fn(async (input: string | URL | Request) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (!["127.0.0.1", "localhost"].includes(url.hostname))
    throw new Error("External network disabled in synthetic tests");
  throw new Error("Use an explicit local HTTP client for interface tests");
}) as typeof fetch;
