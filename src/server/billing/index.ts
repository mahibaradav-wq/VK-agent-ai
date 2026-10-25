import { createHmacBillingProvider } from "@/server/billing/hmac-provider";
import { createUnconfiguredBillingProvider } from "@/server/billing/unconfigured";
import { createYookassaBillingProvider } from "@/server/billing/yookassa";
import type { BillingProvider } from "@/server/billing/types";

export type { BillingCheckout, BillingCheckoutInput, BillingEventType, BillingProvider, VerifiedBillingEvent } from "@/server/billing/types";
export { createHmacBillingProvider } from "@/server/billing/hmac-provider";
export { createUnconfiguredBillingProvider } from "@/server/billing/unconfigured";
export { createYookassaBillingProvider } from "@/server/billing/yookassa";
export { createBillingSignature, verifyBillingSignature } from "@/server/billing/signature";

export type BillingStatus = {
  ready: boolean;
  provider: string;
};

export function createBillingProviderFromEnv(): BillingProvider {
  const shopId = process.env.YOOKASSA_SHOP_ID?.trim();
  const secretKey = process.env.YOOKASSA_SECRET_KEY?.trim();
  if (shopId && secretKey) {
    return createYookassaBillingProvider({ shopId, secretKey });
  }
  const secret = process.env.BILLING_WEBHOOK_SECRET?.trim();
  if (secret) {
    return createHmacBillingProvider({ secret });
  }
  return createUnconfiguredBillingProvider();
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
