import { AsyncLocalStorage } from "node:async_hooks";

const context = new AsyncLocalStorage<{ key: string; unknown: boolean }>();
export class NotificationOutcomeUnknown extends Error {
  constructor() {
    super("NotificationOutcomeUnknown: inspect delivery before any resend");
    this.name = "NotificationOutcomeUnknown";
  }
}
export function deliveryContext() {
  return context.getStore();
}
export function markDeliveryUnknown() {
  const current = context.getStore();
  if (current) current.unknown = true;
}
export async function withDeliveryContext(
  key: string,
  work: () => Promise<void>,
) {
  return context.run({ key, unknown: false }, async () => {
    try {
      await work();
    } finally {
      if (context.getStore()?.unknown) throw new NotificationOutcomeUnknown();
    }
  });
}
