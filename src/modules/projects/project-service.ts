import type { Prisma, PrismaClient } from "@prisma/client";

import { AccessError, assertActiveProject, assertWorkspaceBound } from "@/modules/access/permissions";
import { createAccessService } from "@/modules/access/access-service";
import { PERSONAL_ACTIVE_PROJECT_LIMIT } from "@/modules/cabinet/limits";
import { lockWorkspaceMetric } from "@/modules/billing/usage";

export const STARTER_PROJECT_NAME = "Дом по полочкам";
export const STARTER_PROJECT_DESCRIPTION = "Клуб ВК и Telegram-канал этого проекта.";
export { PERSONAL_ACTIVE_PROJECT_LIMIT };

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function createStarterProjectIfMissing(db: DbClient, workspaceId: string, actorId?: string) {
  const existing = await db.project.findFirst({
    where: { workspaceId, archivedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    return { project: existing, created: false };
  }

  const project = await db.project.create({
    data: {
      workspaceId,
      name: STARTER_PROJECT_NAME,
      description: STARTER_PROJECT_DESCRIPTION,
      color: "#cc7a2b",
    },
  });

  if (actorId) {
    await db.auditLog.create({
      data: {
        action: "CREATE_PROJECT",
        entityType: "project",
        entityId: project.id,
        actorId,
        details: workspaceId,
      },
    });
  }

  return { project, created: true };
}

export function createProjectService(db: PrismaClient) {
  const access = createAccessService(db);

  async function loadBoundProject(workspaceId: string, projectId: string) {
    const project = await db.project.findUnique({ where: { id: projectId } });
    assertActiveProject(workspaceId, project);
    return project;
  }

  return {
    async list(userId: string, workspaceId: string) {
      await access.requirePermission(userId, workspaceId, "project.view");
      return db.project.findMany({
        where: { workspaceId, archivedAt: null },
        orderBy: { createdAt: "desc" },
      });
    },

    async listArchived(userId: string, workspaceId: string) {
      await access.requirePermission(userId, workspaceId, "project.view");
      return db.project.findMany({
        where: { workspaceId, archivedAt: { not: null } },
        orderBy: { archivedAt: "desc" },
      });
    },

    async get(userId: string, workspaceId: string, projectId: string) {
      await access.requirePermission(userId, workspaceId, "project.view");
      return loadBoundProject(workspaceId, projectId);
    },

    async create(userId: string, workspaceId: string, input: { name: string; description?: string; color?: string }) {
      await access.requirePermission(userId, workspaceId, "project.create");

      const name = input.name.trim();
      if (name.length < 2) {
        throw new AccessError(403, "Название проекта должно содержать минимум 2 символа.");
      }

      const project = await db.$transaction(async (tx) => {
        await lockWorkspaceMetric(tx, workspaceId, "projects");
        const used = await tx.project.count({ where: { workspaceId, archivedAt: null } });
        if (used >= PERSONAL_ACTIVE_PROJECT_LIMIT) {
          throw new AccessError(400, `Можно держать не больше ${PERSONAL_ACTIVE_PROJECT_LIMIT} активных проектов.`);
        }
        return tx.project.create({
          data: {
            workspaceId,
            name,
            description: input.description?.trim() || null,
            color: input.color?.trim() || "#cc7a2b",
          },
        });
      });
      await db.auditLog.create({
        data: {
          action: "CREATE_PROJECT",
          entityType: "project",
          entityId: project.id,
          actorId: userId,
          details: workspaceId,
        },
      });
      return project;
    },

    async update(
      userId: string,
      workspaceId: string,
      projectId: string,
      input: { name?: string; description?: string; color?: string },
    ) {
      await access.requirePermission(userId, workspaceId, "project.update");
      await loadBoundProject(workspaceId, projectId);

      return db.project.update({
        where: { id: projectId },
        data: {
          name: input.name?.trim(),
          description: input.description?.trim(),
          color: input.color?.trim(),
        },
      });
    },

    async archive(userId: string, workspaceId: string, projectId: string) {
      await access.requirePermission(userId, workspaceId, "project.archive");
      await loadBoundProject(workspaceId, projectId);

      return db.project.update({
        where: { id: projectId },
        data: { archivedAt: new Date() },
      });
    },

    async restore(userId: string, workspaceId: string, projectId: string) {
      await access.requirePermission(userId, workspaceId, "project.archive");
      const project = await db.project.findUnique({ where: { id: projectId } });
      assertWorkspaceBound(workspaceId, project, "Проект");
      if (!project.archivedAt) {
        return project;
      }

      return db.$transaction(async (tx) => {
        await lockWorkspaceMetric(tx, workspaceId, "projects");
        const used = await tx.project.count({ where: { workspaceId, archivedAt: null } });
        if (used >= PERSONAL_ACTIVE_PROJECT_LIMIT) {
          throw new AccessError(400, `Можно держать не больше ${PERSONAL_ACTIVE_PROJECT_LIMIT} активных проектов.`);
        }
        return tx.project.update({
          where: { id: projectId },
          data: { archivedAt: null },
        });
      });
    },
  };
}
