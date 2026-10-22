import { AccessError } from "@/modules/access/permissions";
import type { EmailNotificationAdapter } from "@/server/notifications/types";

export function createUnconfiguredEmailAdapter(): EmailNotificationAdapter {
  return {
    name: "unconfigured",
    ready: false,
    async send() {
      throw new AccessError(
        400,
        "Почтовые уведомления недоступны: требуется AUTH_DEV_MAILBOX или EMAIL_API_KEY. Внешняя отправка не имитируется.",
      );
    },
  };
}
