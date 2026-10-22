import type { PrismaClient } from "@prisma/client";

import type { EmailNotificationAdapter } from "@/server/notifications/types";

export function createDevMailboxEmailAdapter(db: PrismaClient): EmailNotificationAdapter {
  return {
    name: "dev-mailbox",
    ready: true,
    async send(message) {
      await db.devMailMessage.create({
        data: {
          to: message.to,
          subject: message.subject,
          body: message.body,
          url: message.url,
          kind: message.kind || "notification",
        },
      });
    },
  };
}
