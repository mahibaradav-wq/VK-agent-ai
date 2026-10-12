import { selectProject, selectWorkspace } from "@/modules/workspaces/actions";
import type { Project, Workspace, WorkspaceMember } from "@prisma/client";

type Membership = WorkspaceMember & { workspace: Workspace };

export function WorkspaceSwitcher({
  memberships,
  activeMembership,
  projects,
  activeProject,
}: {
  memberships: Membership[];
  activeMembership: Membership | null;
  projects: Project[];
  activeProject: Project | null;
}) {
  return (
    <div className="grid gap-3 rounded-3xl bg-white/80 p-4 shadow-soft ring-1 ring-ink/10 md:grid-cols-2">
      <form action={selectWorkspace} className="grid gap-2">
        <label className="text-sm font-semibold text-ink" htmlFor="workspaceId">
          Рабочее пространство
        </label>
        <select
          id="workspaceId"
          name="workspaceId"
          defaultValue={activeMembership?.workspaceId}
          className="min-h-11 rounded-2xl border border-ink/10 bg-white px-3"
        >
          {memberships.map((item) => (
            <option key={item.workspaceId} value={item.workspaceId}>
              {item.workspace.name} · {item.role}
            </option>
          ))}
        </select>
        <button type="submit" className="text-left text-sm font-semibold text-brand-dark">
          Переключить пространство
        </button>
      </form>
      <form action={selectProject} className="grid gap-2">
        <input type="hidden" name="workspaceId" value={activeMembership?.workspaceId ?? ""} />
        <label className="text-sm font-semibold text-ink" htmlFor="projectId">
          Проект
        </label>
        <select
          id="projectId"
          name="projectId"
          defaultValue={activeProject?.id}
          className="min-h-11 rounded-2xl border border-ink/10 bg-white px-3"
        >
          {projects.length === 0 ? <option value="">Нет проектов</option> : null}
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <button type="submit" className="text-left text-sm font-semibold text-brand-dark">
          Переключить проект
        </button>
      </form>
    </div>
  );
}
