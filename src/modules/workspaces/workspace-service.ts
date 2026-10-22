import type { PrismaClient } from "@prisma/client";

import { AccessError, canAssignRole, parseWorkspaceRole } from "@/modules/access/permissions";
import { createAccessService } from "@/modules/access/access-service";
import { getWorkspacePlanLimits } from "@/modules/billing/plans";
import { lockWorkspaceMetric } from "@/modules/billing/usage";

export function createWorkspaceService(db: PrismaClient) {
  const access = createAccessService(db);

  return {
    async listForUser(userId: string) {
      return db.workspaceMember.findMany({
        where: { userId },
        include: { workspace: true },
        orderBy: { createdAt: "asc" },
      });
    },

    async listMembers(userId: string, workspaceId: string) {
      await access.requirePermission(userId, workspaceId, "members.view");

      return db.workspaceMember.findMany({
        where: { workspaceId },
        include: { user: { select: { id: true, email: true, name: true } } },
        orderBy: { createdAt: "asc" },
      });
    },

    async addMember(actorId: string, workspaceId: string, email: string, role: string) {
      const nextRole = parseWorkspaceRole(role);
      const actor = await access.requirePermission(actorId, workspaceId, "members.add");
      if (!canAssignRole(actor.role, nextRole)) {
        throw new AccessError(403, "Нельзя назначить роль не ниже собственной.");
      }

      const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
      if (!user) {
        throw new AccessError(404, "Пользователь с таким email не найден.");
      }

      const existing = await db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: user.id } },
      });
      if (existing) {
        throw new AccessError(403, "Пользователь уже состоит в этом пространстве.");
      }

      const member = await db.$transaction(async (tx) => {
        await lockWorkspaceMetric(tx, workspaceId, "members");
        const limits = await getWorkspacePlanLimits(tx, workspaceId);
        const used = await tx.workspaceMember.count({ where: { workspaceId } });
        if (used >= limits.members) {
          throw new AccessError(400, `Лимит участников тарифа исчерпан (${limits.members}).`);
        }
        return tx.workspaceMember.create({
          data: { workspaceId, userId: user.id, role: nextRole },
        });
      });
      await db.auditLog.create({
        data: {
          action: "ADD_MEMBER",
          entityType: "workspace",
          entityId: workspaceId,
          actorId,
          details: `${user.email}:${nextRole}`,
        },
      });
      return member;
    },

    async changeRole(actorId: string, workspaceId: string, targetUserId: string, role: string) {
      const nextRole = parseWorkspaceRole(role);
      const actor = await access.requirePermission(actorId, workspaceId, "members.changeRole");
      const target = await db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      });

      if (!target) {
        throw new AccessError(404, "Участник не найден.");
      }

      access.assertRoleChange(actor.role, actorId, targetUserId, target.role, nextRole);

      const updated = await db.workspaceMember.update({
        where: { id: target.id },
        data: { role: nextRole },
      });
      await db.auditLog.create({
        data: {
          action: "CHANGE_ROLE",
          entityType: "workspace_member",
          entityId: target.id,
          actorId,
          details: `${target.role}->${nextRole}`,
        },
      });
      return updated;
    },
  };
}
