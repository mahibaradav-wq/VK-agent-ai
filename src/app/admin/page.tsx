import { PageHeader } from "@/components/marketing/page-header";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { createAdminService } from "@/modules/admin/admin-service";
import { loadAdminPage } from "@/modules/admin/guard";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Админка",
  description: "Обзор платформы. Доступ только у платформенных администраторов.",
  path: "/admin",
});

export default async function AdminHomePage() {
  const { data, error } = await loadAdminPage((userId) => createAdminService(prisma).overview(userId));
  if (error || !data) {
    return <StatusBanner tone="warning">{error}</StatusBanner>;
  }
  const cards = [
    ["Пользователи", data.users],
    ["Workspaces", data.workspaces],
    ["Публикации", data.posts],
    ["Задачи очереди", data.jobs],
    ["Ошибки очереди", data.failedJobs],
    ["Админы платформы", data.admins],
    ["Записи audit", data.audit],
  ] as const;

  return (
    <>
      <PageHeader
        eyebrow="Админка"
        title="Обзор платформы"
        description="Данные агрегированы по всей системе. Обычный участник workspace сюда не попадает."
      />
      <Container className="grid gap-4 pb-20 md:grid-cols-2 lg:grid-cols-4">
        {cards.map(([label, value]) => (
          <Card key={label}>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">{label}</p>
            <p className="mt-2 text-3xl font-black text-ink">{value}</p>
          </Card>
        ))}
      </Container>
    </>
  );
}
