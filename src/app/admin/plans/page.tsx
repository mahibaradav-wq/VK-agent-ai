import { PlanLimitsForm } from "@/components/app/admin-forms";
import { PageHeader } from "@/components/marketing/page-header";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { canMutatePlatform, requirePlatformAdmin } from "@/modules/admin/access";
import { createAdminService } from "@/modules/admin/admin-service";
import { loadAdminPage } from "@/modules/admin/guard";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Тарифы",
  description: "Ресурсные лимиты тарифов. Изменение доступно Superadmin и пишется в audit.",
  path: "/admin/plans",
});

export default async function AdminPlansPage() {
  const { userId, data, error } = await loadAdminPage((id) => createAdminService(prisma).listPlans(id));
  if (error || !data || !userId) {
    return <StatusBanner tone="warning">{error}</StatusBanner>;
  }
  const actor = await requirePlatformAdmin(prisma, userId);
  const canMutate = canMutatePlatform(actor.admin.role);

  return (
    <>
      <PageHeader
        eyebrow="Админка"
        title="Тарифы"
        description="Таблица Plan сохранена для обратимости. Рабочий личный кабинет не берёт отсюда лимиты проектов и постов."
      />
      <Container className="pb-6">
        <StatusBanner tone="info">
          Операционные лимиты кабинета заданы в коде: 10 активных проектов. Checkout и смена тарифа выключены.
        </StatusBanner>
      </Container>
      <Container className="grid gap-5 pb-20 lg:grid-cols-3">
        {data.map((plan) => (
          <Card key={plan.id} className="grid gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">{plan.slug}</p>
              <h2 className="mt-2 text-2xl font-black text-ink">{plan.name}</h2>
              <p className="mt-2 text-sm text-ink/70">{plan.description}</p>
            </div>
            {canMutate ? (
              <PlanLimitsForm
                slug={plan.slug}
                projects={plan.projects}
                socialAccounts={plan.socialAccounts}
                members={plan.members}
                postsPerMonth={plan.postsPerMonth}
              />
            ) : (
              <p className="text-sm text-ink/70">
                Проекты {plan.projects} · аккаунты {plan.socialAccounts} · участники{" "}
                {plan.members} · посты {plan.postsPerMonth}
              </p>
            )}
          </Card>
        ))}
      </Container>
    </>
  );
}
