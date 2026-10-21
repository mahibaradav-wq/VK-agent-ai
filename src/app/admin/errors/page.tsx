import { PageHeader } from "@/components/marketing/page-header";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { createAdminService } from "@/modules/admin/admin-service";
import { loadAdminPage } from "@/modules/admin/guard";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Ошибки",
  description: "Сбойные задачи и аккаунты.",
  path: "/admin/errors",
});

export default async function AdminErrorsPage() {
  const { data, error } = await loadAdminPage((userId) => createAdminService(prisma).listErrors(userId));
  if (error || !data) {
    return <StatusBanner tone="warning">{error}</StatusBanner>;
  }

  return (
    <>
      <PageHeader eyebrow="Админка" title="Ошибки" description="Failed jobs и аккаунты с token_expired или error." />
      <Container className="grid gap-4 pb-20">
        {data.jobs.length === 0 && data.accounts.length === 0 ? (
          <StatusBanner tone="info">Открытых ошибок нет.</StatusBanner>
        ) : null}
        {data.jobs.map((job) => (
          <Card key={job.id}>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">job · {job.status}</p>
            <h2 className="mt-2 text-lg font-black text-ink">{job.workspace}</h2>
            <p className="mt-2 text-sm text-ink/70">{job.lastError || "без текста ошибки"}</p>
          </Card>
        ))}
        {data.accounts.map((account) => (
          <Card key={account.id}>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">
              {account.platform} · {account.status}
            </p>
            <h2 className="mt-2 text-lg font-black text-ink">{account.workspace}</h2>
            <p className="mt-2 text-sm text-ink/70">{account.lastError || "без текста ошибки"}</p>
          </Card>
        ))}
      </Container>
    </>
  );
}
