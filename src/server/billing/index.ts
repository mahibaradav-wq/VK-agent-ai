import { createUnconfiguredBillingProvider } from "@/server/billing/unconfigured";
import type { BillingProvider } from "@/server/billing/types";

export type { BillingCheckout, BillingCheckoutInput, BillingEventType, BillingProvider, VerifiedBillingEvent } from "@/server/billing/types";
export { createUnconfiguredBillingProvider } from "@/server/billing/unconfigured";

export type BillingStatus = {
  ready: boolean;
  provider: string;
};

export function createBillingProviderFromEnv(): BillingProvider {
  return createUnconfiguredBillingProvider();
}

export function getBillingStatus(): BillingStatus {
  return { ready: false, provider: "disabled" };
}

export function getBillingProvider(): BillingProvider {
  return createUnconfiguredBillingProvider();
}
