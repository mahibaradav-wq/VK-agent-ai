import { PageHeader } from "@/components/marketing/page-header";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { createAdminService } from "@/modules/admin/admin-service";
import { loadAdminPage } from "@/modules/admin/guard";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Интеграции",
  description: "Статусы внешних сервисов без секретов.",
  path: "/admin/integrations",
});

export default async function AdminIntegrationsPage() {
  const { data, error } = await loadAdminPage((userId) => createAdminService(prisma).listIntegrations(userId));
  if (error || !data) {
    return <StatusBanner tone="warning">{error}</StatusBanner>;
  }

  return (
    <>
      <PageHeader
        eyebrow="Админка"
        title="Интеграции"
        description="Ключи и токены на страницу не попадают. Неготовая интеграция не показывается как успешная."
      />
      <Container className="grid gap-4 pb-20 md:grid-cols-2">
        {data.map((item) => (
          <Card key={item.name}>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">
              {item.ready ? "готово" : "требуется настройка"}
            </p>
            <h2 className="mt-2 text-xl font-black text-ink">{item.name}</h2>
            <p className="mt-2 text-sm text-ink/70">
              {item.provider} · {item.note}
            </p>
          </Card>
        ))}
      </Container>
    </>
  );
}
