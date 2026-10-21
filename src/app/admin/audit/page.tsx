import { PageHeader } from "@/components/marketing/page-header";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { createAdminService } from "@/modules/admin/admin-service";
import { loadAdminPage } from "@/modules/admin/guard";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Audit",
  description: "Журнал действий платформы.",
  path: "/admin/audit",
});

export default async function AdminAuditPage() {
  const { data, error } = await loadAdminPage((userId) => createAdminService(prisma).listAudit(userId));
  if (error || !data) {
    return <StatusBanner tone="warning">{error}</StatusBanner>;
  }

  return (
    <>
      <PageHeader
        eyebrow="Админка"
        title="Audit"
        description="Критические действия админки (выдача роли, смена лимитов) пишутся сюда же."
      />
      <Container className="grid gap-4 pb-20">
        {data.length === 0 ? <StatusBanner tone="info">Записей пока нет.</StatusBanner> : null}
        {data.map((row) => (
          <Card key={row.id}>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">
              {row.action} · {row.entityType}
            </p>
            <p className="mt-2 text-sm text-ink/80">{row.actor?.email ?? "система"}</p>
            <p className="mt-1 text-sm text-ink/60">{row.details || row.entityId}</p>
            <p className="mt-1 text-xs text-ink/50">{row.createdAt.toISOString()}</p>
          </Card>
        ))}
      </Container>
    </>
  );
}
