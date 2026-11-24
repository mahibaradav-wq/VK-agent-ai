import { AccessError } from "@/modules/access/permissions";
import { COMMERCIAL_BILLING_DISABLED_MESSAGE } from "@/modules/cabinet/commercial";
import type { BillingProvider } from "@/server/billing/types";

export function createUnconfiguredBillingProvider(): BillingProvider {
  return {
    name: "disabled",
    ready: false,
    async createCheckout() {
      throw new AccessError(403, COMMERCIAL_BILLING_DISABLED_MESSAGE);
    },
    async verifyWebhook() {
      throw new AccessError(403, COMMERCIAL_BILLING_DISABLED_MESSAGE);
    },
  };
}
