import { auth } from "@/auth";
import { PageHeader } from "@/components/marketing/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { getAppContext } from "@/modules/access/app-context";
import { hasPermission } from "@/modules/access/permissions";
import { createProject } from "@/modules/projects/actions";
import { createStarterProjectIfMissing } from "@/modules/projects/project-service";
import { selectProject } from "@/modules/workspaces/actions";
import { prisma } from "@/server/db/prisma";
import { SetupForm } from "@/components/forms/setup-form";

export const metadata = createPageMetadata({
  title: "Проекты",
  description: "Выберите клуб, в котором работаете. Каждый проект — свои ВК, Telegram, идеи и товары.",
  path: "/app",
});

export default async function ProjectsHomePage() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  let { activeMembership, projects } = await getAppContext(session.user.id);
  if (activeMembership && projects.length === 0) {
    await createStarterProjectIfMissing(prisma, activeMembership.workspaceId, session.user.id);
    ({ activeMembership, projects } = await getAppContext(session.user.id));
  }

  const projectIds = projects.map((project) => project.id);
  const [postStats, accounts] = activeMembership
    ? await Promise.all([
        prisma.post.groupBy({
          by: ["projectId"],
          where: { workspaceId: activeMembership.workspaceId, projectId: { in: projectIds } },
          _count: { _all: true },
          _max: { updatedAt: true },
        }),
        prisma.socialAccount.findMany({
          where: { workspaceId: activeMembership.workspaceId, projectId: { in: projectIds } },
          orderBy: { createdAt: "asc" },
        }),
      ])
    : [[], []];

  const canCreate = activeMembership ? hasPermission(activeMembership.role, "project.create") : false;

  return (
    <>
      <PageHeader
        eyebrow="Проекты"
        title="Какой клуб ведёте"
        description="Клик по карточке открывает календарь этого проекта. Ключи потом меняете в Подключениях."
      />
      <Container className="grid gap-6 pb-20 lg:grid-cols-[1fr_0.8fr]">
        <div className="grid gap-4">
          {projects.length === 0 ? <StatusBanner tone="info">Проектов пока нет.</StatusBanner> : null}
          {projects.map((project) => {
            const stats = postStats.find((item) => item.projectId === project.id);
            const vk = accounts.find((item) => item.projectId === project.id && item.platform === "vk");
            const telegram = accounts.find((item) => item.projectId === project.id && item.platform === "telegram");
            const lastAt = stats?._max.updatedAt;
            return (
              <Card key={project.id} className="grid gap-3">
                <p className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: project.color }}>
                  {project.name}
                </p>
                <h2 className="text-2xl font-black text-ink">{project.name}</h2>
                <p className="text-sm text-ink/70">ВК: {vk?.displayName || "не задан"}</p>
                <p className="text-sm text-ink/70">Telegram: {telegram?.displayName || "не задан"}</p>
                <p className="text-sm text-ink/60">
                  Постов: {stats?._count._all ?? 0}
                  {lastAt ? ` · последний ${lastAt.toLocaleString("ru-RU")}` : ""}
                </p>
                {activeMembership ? (
                  <form action={selectProject}>
                    <input type="hidden" name="workspaceId" value={activeMembership.workspaceId} />
                    <input type="hidden" name="projectId" value={project.id} />
                    <input type="hidden" name="next" value="/app/calendar" />
                    <Button>Открыть календарь</Button>
                  </form>
                ) : null}
              </Card>
            );
          })}
        </div>
        {canCreate && activeMembership ? (
          <Card>
            <h2 className="text-xl font-black text-ink">Новый проект</h2>
            <p className="mt-2 text-sm text-ink/70">Название и цвет. Клуб и канал подключите сразу после создания, в Подключениях.</p>
            <div className="mt-4">
              <SetupForm
                action={createProject}
                submitLabel="Создать проект"
                fields={[
                  { name: "workspaceId", label: "Workspace", type: "hidden", defaultValue: activeMembership.workspaceId },
                  { name: "name", label: "Название", required: true },
                  { name: "color", label: "Цвет", defaultValue: "#cc7a2b" },
                ]}
              />
            </div>
          </Card>
        ) : (
          <StatusBanner tone="info">Создать проект могут Editor, Admin и Owner.</StatusBanner>
        )}
      </Container>
    </>
  );
}
