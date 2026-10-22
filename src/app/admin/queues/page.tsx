import { PageHeader } from "@/components/marketing/page-header";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { createAdminService } from "@/modules/admin/admin-service";
import { loadAdminPage } from "@/modules/admin/guard";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Очереди",
  description: "PublishJob по всей платформе.",
  path: "/admin/queues",
});

export default async function AdminQueuesPage() {
  const { data, error } = await loadAdminPage((userId) => createAdminService(prisma).listQueues(userId));
  if (error || !data) {
    return <StatusBanner tone="warning">{error}</StatusBanner>;
  }

  return (
    <>
      <PageHeader eyebrow="Админка" title="Очереди" description="Статусы задач автопостинга без фиктивной отправки." />
      <Container className="grid gap-4 pb-20">
        <Card>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Сводка</p>
          <p className="mt-2 text-sm text-ink/70">
            {Object.entries(data.counts)
              .map(([status, count]) => `${status}: ${count}`)
              .join(" · ") || "задач нет"}
          </p>
        </Card>
        {data.jobs.map((job) => (
          <Card key={job.id}>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">
              {job.status} · попыток {job.attemptCount}
            </p>
            <h2 className="mt-2 text-lg font-black text-ink">{job.workspace}</h2>
            <p className="mt-2 text-sm text-ink/70">{job.lastError || "ошибки нет"}</p>
          </Card>
        ))}
      </Container>
    </>
  );
}
