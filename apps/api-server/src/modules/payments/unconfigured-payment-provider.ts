import { PaymentBoundary, PaymentProviderUnavailable } from "./payment-boundary";
import type { PaymentOrderSnapshot, PaymentProvider, RawPaymentNotification, PaymentObservation } from "./payment-boundary";

// No environment variable, test AppID or placeholder credential can enable this adapter.
// Replace it only with a reviewed implementation of real verification and authenticated querying.
export class UnconfiguredPaymentProvider implements PaymentProvider {
  constructor(readonly id: string) {}
  assertConfigured(): void { throw new PaymentProviderUnavailable(); }
  async verifyNotification(_input: RawPaymentNotification): Promise<PaymentObservation> { throw new PaymentProviderUnavailable(); }
  async queryPayment(_order: PaymentOrderSnapshot): Promise<PaymentObservation> { throw new PaymentProviderUnavailable(); }
}

export function createPaymentBoundary(providerId: string): PaymentBoundary {
  return new PaymentBoundary(new UnconfiguredPaymentProvider(providerId));
}
