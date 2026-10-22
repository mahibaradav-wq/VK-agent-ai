import { auth } from "@/auth";
import { AnalyticsDashboard } from "@/components/app/analytics-dashboard";
import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { getAppContext } from "@/modules/access/app-context";
import { hasPermission } from "@/modules/access/permissions";
import { createAnalyticsService } from "@/modules/analytics/analytics-service";
import { createSocialService } from "@/modules/social/social-service";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Аналитика",
  description: "Нормализованные метрики и сырой payload платформы. Недоступные поля не заполняются нулями.",
  path: "/app/analytics",
});

function readParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

function isoDay(value: Date) {
  return value.toISOString().slice(0, 10);
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const params = await searchParams;
  const { activeMembership, projects } = await getAppContext(session.user.id);
  if (!activeMembership) {
    return <StatusBanner tone="warning">Нет рабочего пространства.</StatusBanner>;
  }

  const filters = {
    from: readParam(params.from),
    to: readParam(params.to),
    projectId: readParam(params.projectId),
    socialAccountId: readParam(params.socialAccountId),
    platform: readParam(params.platform),
  };

  const dashboard = await createAnalyticsService(prisma).dashboard(
    session.user.id,
    activeMembership.workspaceId,
    {
      from: filters.from || undefined,
      to: filters.to || undefined,
      projectId: filters.projectId || undefined,
      socialAccountId: filters.socialAccountId || undefined,
      platform: filters.platform || undefined,
    },
  );
  const accounts = await createSocialService(prisma).list(session.user.id, activeMembership.workspaceId);

  return (
    <>
      <PageHeader
        eyebrow="Аналитика"
        title="Метрики публикаций"
        description="Нормализованный слой отдельно от сырого ответа платформы. Если реальных снимков нет, показывается явная демо-метка."
      />
      <Container className="pb-20">
        <AnalyticsDashboard
          workspaceId={activeMembership.workspaceId}
          canCollect={hasPermission(activeMembership.role, "analytics.collect")}
          mode={dashboard.mode}
          demoUsed={dashboard.demoUsed}
          demoExcluded={dashboard.demoExcluded}
          note={dashboard.note}
          from={isoDay(dashboard.from)}
          to={isoDay(dashboard.to)}
          series={dashboard.series}
          totals={dashboard.totals}
          snapshots={dashboard.snapshots.map((item) => ({
            id: item.id,
            source: item.source,
            platform: item.platform,
            collectedAt: item.collectedAt.toISOString(),
            periodStart: item.periodStart.toISOString(),
            periodEnd: item.periodEnd.toISOString(),
            impressions: item.impressions,
            reach: item.reach,
            followers: item.followers,
            engagement: item.engagement,
            postsPublished: item.postsPublished,
            projectName: item.projectName,
            accountName: item.accountName,
            rawPayload: item.rawPayload,
          }))}
          availability={dashboard.availability}
          projects={projects.map((project) => ({ id: project.id, name: project.name }))}
          accounts={accounts.map((account) => ({
            id: account.id,
            name: `${account.displayName} (${account.platform})`,
          }))}
          filters={{
            ...filters,
            from: filters.from || isoDay(dashboard.from),
            to: filters.to || isoDay(dashboard.to),
          }}
        />
      </Container>
    </>
  );
}
