import { auth } from "@/auth";
import { QueueBoard } from "@/components/app/queue-board";
import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { getAppContext } from "@/modules/access/app-context";
import { hasPermission } from "@/modules/access/permissions";
import { createPublishService } from "@/modules/publishing/publish-service";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Очередь публикаций",
  description: "PublishJob, попытки и агрегированный статус без фиктивной отправки в соцсети.",
  path: "/app/queue",
});

export default async function QueuePage() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const { activeMembership } = await getAppContext(session.user.id);
  if (!activeMembership) {
    return <StatusBanner tone="warning">Нет рабочего пространства.</StatusBanner>;
  }

  const jobs = await createPublishService(prisma).list(session.user.id, activeMembership.workspaceId);

  return (
    <>
      <PageHeader
        eyebrow="Очередь"
        title="Автопостинг"
        description="Задачи пишутся в PostgreSQL с ключом идемпотентности. Worker забирает их атомарно. Без официальной интеграции адаптер возвращает integration_not_configured, а не фиктивный успех."
      />
      <Container className="grid gap-6 pb-20">
        <QueueBoard
          workspaceId={activeMembership.workspaceId}
          canProcess={hasPermission(activeMembership.role, "post.update")}
          jobs={jobs.map((job) => ({
            id: job.id,
            status: job.status,
            attemptCount: job.attemptCount,
            maxAttempts: job.maxAttempts,
            lastError: job.lastError,
            nextAttemptAt: job.nextAttemptAt?.toISOString() ?? null,
            postId: job.postId,
            title: job.post.versions.find((version) => !version.supersededAt)?.title ?? "Без названия",
            postStatus: job.post.status,
            targets: job.post.targets.map((target) => ({
              id: target.id,
              platform: target.platform,
              status: target.status,
              lastError: target.lastError,
            })),
            attempts: job.attempts.map((attempt) => ({
              id: attempt.id,
              platform: attempt.platform,
              kind: attempt.kind,
              attemptNumber: attempt.attemptNumber,
              errorCode: attempt.errorCode,
              errorMessage: attempt.errorMessage,
              finishedAt: attempt.finishedAt.toISOString(),
            })),
          }))}
        />
      </Container>
    </>
  );
}
