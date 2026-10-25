import { AUTOMATED_MAILBOX_DOMAIN } from "@/lib/mailbox-url";
import { prisma } from "@/server/db/prisma";

export function isDevMailboxEnabled() {
  return process.env.AUTH_DEV_MAILBOX === "true";
}

export async function storeDevMail(input: {
  to: string;
  subject: string;
  body: string;
  url?: string;
  kind: "verify_email" | "reset_password" | "contact" | "invitation" | "notification";
}) {
  return prisma.devMailMessage.create({
    data: input,
  });
}

export async function listDevMail(options?: { includeAutomated?: boolean }) {
  return prisma.devMailMessage.findMany({
    where: options?.includeAutomated
      ? undefined
      : { NOT: { to: { endsWith: `@${AUTOMATED_MAILBOX_DOMAIN}` } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function countAutomatedDevMail() {
  return prisma.devMailMessage.count({
    where: { to: { endsWith: `@${AUTOMATED_MAILBOX_DOMAIN}` } },
  });
}
