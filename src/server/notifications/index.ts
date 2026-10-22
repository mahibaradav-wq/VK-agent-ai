import { prisma } from "@/server/db/prisma";
import { createDevMailboxEmailAdapter } from "@/server/notifications/dev-mailbox";
import { createHttpEmailAdapter } from "@/server/notifications/http-email";
import { createUnconfiguredEmailAdapter } from "@/server/notifications/unconfigured";
import type { EmailNotificationAdapter } from "@/server/notifications/types";

export type { EmailNotification, EmailNotificationAdapter } from "@/server/notifications/types";
export { createDevMailboxEmailAdapter } from "@/server/notifications/dev-mailbox";
export { createHttpEmailAdapter } from "@/server/notifications/http-email";
export { createUnconfiguredEmailAdapter } from "@/server/notifications/unconfigured";

export type EmailStatus = {
  ready: boolean;
  provider: string;
};

export function createEmailAdapterFromEnv(): EmailNotificationAdapter {
  const apiKey = process.env.EMAIL_API_KEY?.trim();
  const endpoint = process.env.EMAIL_API_URL?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (apiKey && endpoint && from) {
    return createHttpEmailAdapter({ apiKey, endpoint, from });
  }
  if (process.env.AUTH_DEV_MAILBOX === "true") {
    return createDevMailboxEmailAdapter(prisma);
  }
  return createUnconfiguredEmailAdapter();
}

export function getEmailStatus(adapter = createEmailAdapterFromEnv()): EmailStatus {
  return {
    ready: adapter.ready,
    provider: adapter.name,
  };
}

const globalForEmail = globalThis as typeof globalThis & { emailAdapter?: EmailNotificationAdapter };

export function getEmailAdapter(): EmailNotificationAdapter {
  globalForEmail.emailAdapter ??= createEmailAdapterFromEnv();
  return globalForEmail.emailAdapter;
}
