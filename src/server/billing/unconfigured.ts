import { AccessError } from "@/modules/access/permissions";
import type { BillingProvider } from "@/server/billing/types";

export function createUnconfiguredBillingProvider(): BillingProvider {
  return {
    name: "unconfigured",
    ready: false,
    async createCheckout() {
      throw new AccessError(
        400,
        "Оплата недоступна: задайте YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY. Редирект не считается оплатой.",
      );
    },
    async verifyWebhook() {
      throw new AccessError(400, "Проверка webhook недоступна: задайте YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY.");
    },
  };
}
