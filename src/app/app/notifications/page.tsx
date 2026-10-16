import { auth } from "@/auth";
import { PageHeader } from "@/components/marketing/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { getAppContext } from "@/modules/access/app-context";
import { markNotificationsRead } from "@/modules/collaboration/actions";
import { createCollaborationService } from "@/modules/collaboration/collaboration-service";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Уведомления",
  description: "Статусы согласования и комментарии текущего пространства.",
  path: "/app/notifications",
});

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }
  const { activeMembership } = await getAppContext(session.user.id);
  if (!activeMembership) {
    return <StatusBanner tone="warning">Нет рабочего пространства.</StatusBanner>;
  }
  const items = await createCollaborationService(prisma).listNotifications(
    session.user.id,
    activeMembership.workspaceId,
  );

  return (
    <>
      <PageHeader
        eyebrow="Команда"
        title="Уведомления"
        description="Согласование, комментарии и статусы. Отметить прочитанным можно только свои записи."
      />
      <Container className="grid gap-4 pb-20">
        {items.length > 0 ? (
          <form action={markNotificationsRead}>
            <input type="hidden" name="workspaceId" value={activeMembership.workspaceId} />
            <Button variant="secondary">Отметить все прочитанными</Button>
          </form>
        ) : (
          <StatusBanner tone="info">Уведомлений пока нет.</StatusBanner>
        )}
        {items.map((item) => (
          <Card key={item.id} className="grid gap-2">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">
              {item.type}
              {item.readAt ? "" : " · новое"}
            </p>
            <h2 className="text-lg font-black text-ink">{item.title}</h2>
            <p className="text-sm text-ink/70">{item.body}</p>
            <p className="text-xs text-ink/50">{item.createdAt.toISOString()}</p>
            {!item.readAt ? (
              <form action={markNotificationsRead}>
                <input type="hidden" name="workspaceId" value={activeMembership.workspaceId} />
                <input type="hidden" name="notificationId" value={item.id} />
                <Button type="submit" variant="ghost">
                  Прочитано
                </Button>
              </form>
            ) : null}
          </Card>
        ))}
      </Container>
    </>
  );
}
