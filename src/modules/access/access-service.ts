import type { PrismaClient, WorkspaceRole } from "@prisma/client";

import { AccessError, canAssignRole, canManageMember, hasPermission, type Permission } from "@/modules/access/permissions";

export function createAccessService(db: PrismaClient) {
  return {
    async requireMembership(userId: string, workspaceId: string) {
      const membership = await db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        include: { workspace: true },
      });

      if (!membership) {
        throw new AccessError(404, "Рабочее пространство не найдено.");
      }

      return membership;
    },

    async requirePermission(userId: string, workspaceId: string, permission: Permission) {
      const membership = await this.requireMembership(userId, workspaceId);

      if (!hasPermission(membership.role, permission)) {
        throw new AccessError(403, "Недостаточно прав для этого действия.");
      }

      return membership;
    },

    assertRoleChange(actorRole: WorkspaceRole, actorUserId: string, targetUserId: string, targetRole: WorkspaceRole, nextRole: WorkspaceRole) {
      if (actorUserId === targetUserId) {
        throw new AccessError(403, "Нельзя изменить собственную роль.");
      }

      if (!canManageMember(actorRole, targetRole)) {
        throw new AccessError(403, "Нельзя изменить участника с равной или более высокой ролью.");
      }

      if (!canAssignRole(actorRole, nextRole)) {
        throw new AccessError(403, "Нельзя назначить роль не ниже собственной.");
      }
    },
  };
}
