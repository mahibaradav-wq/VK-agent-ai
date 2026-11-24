import type { PrismaClient } from "@prisma/client";

import { AccessError } from "@/modules/access/permissions";
import { COMMERCIAL_BILLING_DISABLED_MESSAGE } from "@/modules/cabinet/commercial";

function refuseCommercial(): never {
  throw new AccessError(403, COMMERCIAL_BILLING_DISABLED_MESSAGE);
}

export function createBillingService(_db?: PrismaClient, _options?: { allowCommercial?: boolean }) {
  return {
    async listPlans() {
      refuseCommercial();
    },
    async getState() {
      refuseCommercial();
    },
    async getCheckout() {
      refuseCommercial();
    },
    async startCheckout() {
      refuseCommercial();
    },
    async cancel() {
      refuseCommercial();
    },
    async handleWebhook() {
      refuseCommercial();
    },
  };
}
