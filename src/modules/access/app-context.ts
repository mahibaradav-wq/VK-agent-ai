import { cookies } from "next/headers";

import { prisma } from "@/server/db/prisma";

export const WORKSPACE_COOKIE = "polka-workspace-id";
export const PROJECT_COOKIE = "polka-project-id";

export async function getAppContext(userId: string) {
  const cookieStore = await cookies();
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });

  const requestedWorkspaceId = cookieStore.get(WORKSPACE_COOKIE)?.value;
  const activeMembership =
    memberships.find((item) => item.workspaceId === requestedWorkspaceId) ?? memberships[0] ?? null;

  const projects = activeMembership
    ? await prisma.project.findMany({
        where: { workspaceId: activeMembership.workspaceId, archivedAt: null },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const requestedProjectId = cookieStore.get(PROJECT_COOKIE)?.value;
  const activeProject = projects.find((item) => item.id === requestedProjectId) ?? projects[0] ?? null;

  return {
    memberships,
    activeMembership,
    projects,
    activeProject,
  };
}
