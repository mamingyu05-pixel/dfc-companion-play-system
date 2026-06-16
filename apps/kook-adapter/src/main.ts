import { KookAdapter } from "./index";

try {
  new KookAdapter();
  console.log("DFC KOOK adapter ready.");
  const intervalSeconds = Math.max(60, Number(process.env.ORDER_DRAFT_EXPIRE_CHECK_SECONDS ?? 300));
  setInterval(() => {
    void expireStaleDrafts();
  }, intervalSeconds * 1000);
} catch (error) {
  console.error(error);
  process.exit(1);
}

async function expireStaleDrafts() {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://api-server:4000/api";
  const botToken = process.env.BOT_INTERNAL_TOKEN;
  if (!botToken) return;

  try {
    const response = await fetch(`${apiBaseUrl}/kook/order-drafts/expire-stale`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bot-token": botToken
      },
      body: JSON.stringify({})
    });
    if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`);
    const data = (await response.json().catch(() => ({}))) as { expiredCount?: number };
    if (data.expiredCount) console.log(`Expired stale order drafts: ${data.expiredCount}`);
  } catch (error) {
    console.warn(`Failed to expire stale order drafts: ${error instanceof Error ? error.message : String(error)}`);
  }
}
