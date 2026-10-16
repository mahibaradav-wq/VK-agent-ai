import { prisma } from "@/server/db/prisma";

export async function storeDevMail(input: {
  to: string;
  subject: string;
  body: string;
  url?: string;
  kind: "verify_email" | "reset_password" | "contact" | "invitation";
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
