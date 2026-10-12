import type { WorkspaceRole } from "@prisma/client";

export const workspaceRoles = ["Viewer", "Approver", "Editor", "Admin", "Owner"] as const satisfies readonly WorkspaceRole[];

export const roleRank: Record<WorkspaceRole, number> = {
  Viewer: 0,
  Approver: 1,
  Editor: 2,
  Admin: 3,
  Owner: 4,
};

export type Permission =
  | "workspace.view"
  | "workspace.update"
  | "members.view"
  | "members.add"
  | "members.changeRole"
  | "project.view"
  | "project.create"
  | "project.update"
  | "project.archive";

const rolePermissions: Record<WorkspaceRole, Permission[]> = {
  Viewer: ["workspace.view", "members.view", "project.view"],
  Approver: ["workspace.view", "members.view", "project.view"],
  Editor: ["workspace.view", "members.view", "project.view", "project.create", "project.update"],
  Admin: [
    "workspace.view",
    "workspace.update",
    "members.view",
    "members.add",
    "members.changeRole",
    "project.view",
    "project.create",
    "project.update",
    "project.archive",
  ],
  Owner: [
    "workspace.view",
    "workspace.update",
    "members.view",
    "members.add",
    "members.changeRole",
    "project.view",
    "project.create",
    "project.update",
    "project.archive",
  ],
};

export function hasPermission(role: WorkspaceRole, permission: Permission) {
  return rolePermissions[role].includes(permission);
}

export function canAssignRole(actorRole: WorkspaceRole, nextRole: WorkspaceRole) {
  return roleRank[actorRole] > roleRank[nextRole];
}

export function canManageMember(actorRole: WorkspaceRole, targetRole: WorkspaceRole) {
  return roleRank[actorRole] > roleRank[targetRole];
}

export function assignableRoles(actorRole: WorkspaceRole) {
  return workspaceRoles.filter((role) => canAssignRole(actorRole, role));
}

export function parseWorkspaceRole(value: string): WorkspaceRole {
  if ((workspaceRoles as readonly string[]).includes(value)) {
    return value as WorkspaceRole;
  }

  throw new AccessError(403, "Неизвестная роль.");
}

export class AccessError extends Error {
  constructor(
    public status: 403 | 404,
    message: string,
  ) {
    super(message);
  }
}

export function assertWorkspaceBound<T extends { workspaceId: string }>(
  workspaceId: string,
  resource: T | null,
  label: string,
): asserts resource is T {
  if (!resource) {
    throw new AccessError(404, `${label} не найден.`);
  }

  if (resource.workspaceId !== workspaceId) {
    throw new AccessError(403, `${label} принадлежит другому рабочему пространству.`);
  }
}
