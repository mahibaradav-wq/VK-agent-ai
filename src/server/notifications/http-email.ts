import { AccessError } from "@/modules/access/permissions";
import type { EmailNotificationAdapter } from "@/server/notifications/types";

export function createHttpEmailAdapter(options: {
  apiKey: string;
  endpoint: string;
  from: string;
  fetchImpl?: typeof fetch;
}): EmailNotificationAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    name: "http",
    ready: true,
    async send(message) {
      const response = await fetchImpl(options.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: options.from,
          to: message.to,
          subject: message.subject,
          text: message.body,
          url: message.url,
        }),
      });
      if (!response.ok) {
        throw new AccessError(400, `Почтовый провайдер вернул ошибку ${response.status}.`);
      }
    },
  };
}
