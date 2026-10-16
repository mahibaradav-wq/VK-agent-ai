import { AccessError } from "@/modules/access/permissions";
import type { BillingProvider } from "@/server/billing/types";

export function createUnconfiguredBillingProvider(): BillingProvider {
  return {
    name: "unconfigured",
    ready: false,
    async createCheckout() {
      throw new AccessError(
        400,
        "Оплата недоступна: требуется настройка BILLING_WEBHOOK_SECRET. Редирект не считается оплатой.",
      );
    },
    async verifyWebhook() {
      throw new AccessError(400, "Проверка webhook недоступна: требуется настройка BILLING_WEBHOOK_SECRET.");
    },
  };
}
