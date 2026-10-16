import Link from "next/link";

import { auth } from "@/auth";
import { PageHeader } from "@/components/marketing/page-header";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { getAppContext } from "@/modules/access/app-context";
import { hasPermission } from "@/modules/access/permissions";

export const metadata = createPageMetadata({
  title: "Кабинет",
  description: "Обзор рабочего пространства, роли и активного проекта.",
  path: "/app",
});

export default async function AppHomePage() {
  const session = await auth();

  if (!session?.user?.id) {
    return null;
  }

  const { activeMembership, activeProject, projects } = await getAppContext(session.user.id);

  return (
    <>
      <PageHeader
        eyebrow="Обзор"
        title={activeMembership?.workspace.name ?? "Нет рабочего пространства"}
        description="Данные фильтруются по выбранному workspace. Чужой идентификатор на сервере не откроет проекты."
      />
      <Container className="grid gap-5 pb-20">
        <StatusBanner tone="info">
          {session.user.email} · роль {activeMembership?.role ?? "нет"} · проектов {projects.length}
        </StatusBanner>
        {activeProject ? (
          <Card>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Активный проект</p>
            <h2 className="mt-2 text-2xl font-black text-ink">{activeProject.name}</h2>
            <p className="mt-2 text-ink/70">{activeProject.description || "Описание не задано"}</p>
            <div className="mt-4 flex flex-wrap gap-4 text-sm font-semibold">
              <Link href="/app/calendar" className="text-brand-dark">
                Календарь
              </Link>
              <Link href="/app/posts" className="text-brand-dark">
                Публикации
              </Link>
              <Link href="/app/ai" className="text-brand-dark">
                AI
              </Link>
              <Link href="/app/analytics" className="text-brand-dark">
                Аналитика
              </Link>
              <Link href="/app/queue" className="text-brand-dark">
                Очередь
              </Link>
              <Link href="/app/social-accounts" className="text-brand-dark">
                Аккаунты
              </Link>
              <Link href="/app/media" className="text-brand-dark">
                Медиатека
              </Link>
              <Link href="/app/notifications" className="text-brand-dark">
                Уведомления
              </Link>
            </div>
          </Card>
        ) : (
          <StatusBanner tone="warning">
            {activeMembership && hasPermission(activeMembership.role, "project.create")
              ? "Создайте первый проект в разделе «Проекты»."
              : "Проектов пока нет. Создать проект может Editor, Admin или Owner."}
          </StatusBanner>
        )}
      </Container>
    </>
  );
}
