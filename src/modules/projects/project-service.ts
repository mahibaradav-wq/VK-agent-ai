import type { Prisma, PrismaClient } from "@prisma/client";

import { AccessError, assertWorkspaceBound } from "@/modules/access/permissions";
import { createAccessService } from "@/modules/access/access-service";
import { getWorkspacePlanLimits } from "@/modules/billing/plans";
import { lockWorkspaceMetric } from "@/modules/billing/usage";

export const STARTER_PROJECT_NAME = "Первый проект";
export const STARTER_PROJECT_DESCRIPTION =
  "Стартовый проект рабочего пространства. Можно переименовать или создать свой.";

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
    assertWorkspaceBound(workspaceId, project, "Проект");
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
        const limits = await getWorkspacePlanLimits(tx, workspaceId);
        const used = await tx.project.count({ where: { workspaceId, archivedAt: null } });
        if (used >= limits.projects) {
          throw new AccessError(400, `Лимит проектов тарифа исчерпан (${limits.projects}).`);
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
  };
}
