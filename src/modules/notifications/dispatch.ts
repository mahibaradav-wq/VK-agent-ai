import type { Prisma, PrismaClient } from "@prisma/client";

import { getEmailAdapter, type EmailNotificationAdapter } from "@/server/notifications";

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function deliverNotifications(
  db: DbClient,
  input: {
    workspaceId: string;
    userIds: string[];
    type: string;
    title: string;
    body: string;
    entityType: string;
    entityId: string;
    exceptUserId?: string;
    url?: string;
  },
  email: EmailNotificationAdapter = getEmailAdapter(),
) {
  const recipients = [...new Set(input.userIds)].filter((userId) => userId && userId !== input.exceptUserId);
  if (recipients.length === 0) {
    return { delivered: 0, emailed: 0 };
  }
  await db.notification.createMany({
    data: recipients.map((userId) => ({
      workspaceId: input.workspaceId,
      userId,
      type: input.type,
      title: input.title,
      body: input.body,
      entityType: input.entityType,
      entityId: input.entityId,
    })),
  });
  if (!email.ready) {
    return { delivered: recipients.length, emailed: 0 };
  }
  const users = await db.user.findMany({
    where: { id: { in: recipients } },
    select: { email: true },
  });
  let emailed = 0;
  for (const user of users) {
    try {
      await email.send({
        to: user.email,
        subject: input.title,
        body: input.body,
        url: input.url,
        kind: "notification",
      });
      emailed += 1;
    } catch {
      // In-app запись уже сохранена. Сбой почты не имитирует успешную отправку.
    }
  }
  return { delivered: recipients.length, emailed };
}
