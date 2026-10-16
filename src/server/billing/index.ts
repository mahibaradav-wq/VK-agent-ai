import { createHmacBillingProvider } from "@/server/billing/hmac-provider";
import { createUnconfiguredBillingProvider } from "@/server/billing/unconfigured";
import type { BillingProvider } from "@/server/billing/types";

export type { BillingCheckout, BillingCheckoutInput, BillingEventType, BillingProvider, VerifiedBillingEvent } from "@/server/billing/types";
export { createHmacBillingProvider } from "@/server/billing/hmac-provider";
export { createUnconfiguredBillingProvider } from "@/server/billing/unconfigured";
export { createBillingSignature, verifyBillingSignature } from "@/server/billing/signature";

export type BillingStatus = {
  ready: boolean;
  provider: string;
};

export function createBillingProviderFromEnv(): BillingProvider {
  const secret = process.env.BILLING_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return createUnconfiguredBillingProvider();
  }
  return createHmacBillingProvider({ secret });
}

export function getBillingStatus(provider = createBillingProviderFromEnv()): BillingStatus {
  return {
    ready: provider.ready,
    provider: provider.name,
  };
}

const globalForBilling = globalThis as typeof globalThis & { billingProvider?: BillingProvider };

export function getBillingProvider(): BillingProvider {
  globalForBilling.billingProvider ??= createBillingProviderFromEnv();
  return globalForBilling.billingProvider;
}
