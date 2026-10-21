import { PageHeader } from "@/components/marketing/page-header";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { createAdminService } from "@/modules/admin/admin-service";
import { loadAdminPage } from "@/modules/admin/guard";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Workspaces",
  description: "Все рабочие пространства платформы.",
  path: "/admin/workspaces",
});

export default async function AdminWorkspacesPage() {
  const { data, error } = await loadAdminPage((userId) => createAdminService(prisma).listWorkspaces(userId));
  if (error || !data) {
    return <StatusBanner tone="warning">{error}</StatusBanner>;
  }

  return (
    <>
      <PageHeader eyebrow="Админка" title="Workspaces" description="Тариф и состав каждого пространства." />
      <Container className="grid gap-4 pb-20">
        {data.map((workspace) => (
          <Card key={workspace.id}>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">
              {workspace.plan} · {workspace.subscriptionStatus}
              {workspace.paidAt ? " · оплачен" : " · не оплачен"}
            </p>
            <h2 className="mt-2 text-xl font-black text-ink">{workspace.name}</h2>
            <p className="mt-2 text-sm text-ink/70">
              участников {workspace.members} · публикаций {workspace.posts} · аккаунтов {workspace.socialAccounts}
            </p>
          </Card>
        ))}
      </Container>
    </>
  );
}
