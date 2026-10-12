import { auth } from "@/auth";
import { SetupForm } from "@/components/forms/setup-form";
import { PageHeader } from "@/components/marketing/page-header";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { getAppContext } from "@/modules/access/app-context";
import { hasPermission } from "@/modules/access/permissions";
import { archiveProject, createProject } from "@/modules/projects/actions";

export const metadata = createPageMetadata({
  title: "Проекты",
  description: "Проекты текущего рабочего пространства Polka Social.",
  path: "/app/projects",
});

export default async function ProjectsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const { activeMembership, projects } = await getAppContext(session.user.id);
  const canCreate = activeMembership ? hasPermission(activeMembership.role, "project.create") : false;
  const canArchive = activeMembership ? hasPermission(activeMembership.role, "project.archive") : false;

  return (
    <>
      <PageHeader
        eyebrow="Проекты"
        title="Проекты пространства"
        description="Список строится только из текущего workspace. Подмена projectId на сервере отклоняется."
      />
      <Container className="grid gap-6 pb-20 lg:grid-cols-[1fr_0.8fr]">
        <div className="grid gap-4">
          {projects.length === 0 ? <StatusBanner tone="info">В этом пространстве ещё нет проектов.</StatusBanner> : null}
          {projects.map((project) => (
            <Card key={project.id}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: project.color }}>
                    {project.color}
                  </p>
                  <h2 className="mt-2 text-xl font-black text-ink">{project.name}</h2>
                  <p className="mt-2 text-ink/70">{project.description || "Без описания"}</p>
                </div>
                {canArchive ? (
                  <form action={archiveProject}>
                    <input type="hidden" name="workspaceId" value={activeMembership?.workspaceId} />
                    <input type="hidden" name="projectId" value={project.id} />
                    <button type="submit" className="text-sm font-semibold text-danger">
                      В архив
                    </button>
                  </form>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
        {canCreate && activeMembership ? (
          <Card>
            <h2 className="text-xl font-black text-ink">Новый проект</h2>
            <div className="mt-4">
              <SetupForm
                action={createProject}
                submitLabel="Создать проект"
                fields={[
                  { name: "workspaceId", label: "Workspace", type: "hidden", defaultValue: activeMembership.workspaceId },
                  { name: "name", label: "Название", required: true },
                  { name: "description", label: "Описание" },
                  { name: "color", label: "Цвет", defaultValue: "#cc7a2b" },
                ]}
              />
            </div>
          </Card>
        ) : (
          <StatusBanner tone="info">Создание проектов недоступно для текущей роли.</StatusBanner>
        )}
      </Container>
    </>
  );
}
