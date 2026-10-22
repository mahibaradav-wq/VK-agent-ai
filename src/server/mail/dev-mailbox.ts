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

export async function listDevMail() {
  return prisma.devMailMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}
