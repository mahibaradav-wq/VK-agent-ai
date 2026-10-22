import type { PrismaClient } from "@prisma/client";

import { AccessError } from "@/modules/access/permissions";
import { canMutatePlatform, parsePlatformAdminRole, requirePlatformAdmin } from "@/modules/admin/access";
import { ensureCanonicalPlans } from "@/modules/billing/plans";
import { getAiStatus } from "@/server/ai";
import { getBillingStatus } from "@/server/billing";
import { getEmailStatus } from "@/server/notifications";
import { getPublishQueue } from "@/server/queue";
import { storage } from "@/server/storage";

function asLimit(value: number, label: string) {
  if (!Number.isInteger(value) || value < 1 || value > 1_000_000) {
    throw new AccessError(400, `Лимит «${label}» должен быть целым числом от 1.`);
  }
  return value;
}

export function createAdminService(db: PrismaClient) {
  async function requireAdmin(userId: string) {
    return requirePlatformAdmin(db, userId);
  }

  async function requireSuperadmin(userId: string) {
    const actor = await requireAdmin(userId);
    if (!canMutatePlatform(actor.admin.role)) {
      throw new AccessError(403, "Это действие доступно только Superadmin.");
    }
    return actor;
  }

  return {
    async overview(userId: string) {
      await requireAdmin(userId);
      const [users, workspaces, posts, jobs, failedJobs, admins, audit] = await Promise.all([
        db.user.count(),
        db.workspace.count(),
        db.post.count(),
        db.publishJob.count(),
        db.publishJob.count({ where: { status: { in: ["failed", "requires_manual_check"] } } }),
        db.platformAdmin.count(),
        db.auditLog.count(),
      ]);
      return { users, workspaces, posts, jobs, failedJobs, admins, audit };
    },

    async listUsers(userId: string) {
      await requireAdmin(userId);
      const rows = await db.user.findMany({
        orderBy: { createdAt: "desc" },
        take: 200,
        include: {
          platformAdmin: true,
          memberships: { include: { workspace: { select: { name: true } } } },
        },
      });
      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        emailVerified: row.emailVerified,
        createdAt: row.createdAt,
        adminRole: row.platformAdmin?.role ?? null,
        workspaces: row.memberships.map((item) => ({
          id: item.workspaceId,
          name: item.workspace.name,
          role: item.role,
        })),
      }));
    },

    async listWorkspaces(userId: string) {
      await requireAdmin(userId);
      const rows = await db.workspace.findMany({
        orderBy: { createdAt: "desc" },
        take: 200,
        include: {
          members: true,
          subscription: { include: { plan: true } },
          _count: { select: { posts: true, socialAccounts: true } },
        },
      });
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.createdAt,
        members: row.members.length,
        posts: row._count.posts,
        socialAccounts: row._count.socialAccounts,
        plan: row.subscription?.plan.slug ?? "start",
        subscriptionStatus: row.subscription?.status ?? "free",
        paidAt: row.subscription?.paidAt ?? null,
      }));
    },

    async listPlans(userId: string) {
      await requireAdmin(userId);
      await ensureCanonicalPlans(db);
      return db.plan.findMany({
        where: { slug: { in: ["start", "team", "business"] } },
        orderBy: { slug: "asc" },
      });
    },

    async updatePlanLimits(
      userId: string,
      slug: string,
      input: {
        aiGenerations: number;
        projects: number;
        socialAccounts: number;
        members: number;
        postsPerMonth: number;
      },
    ) {
      const actor = await requireSuperadmin(userId);
      const plan = await db.plan.findUnique({ where: { slug } });
      if (!plan || !["start", "team", "business"].includes(slug)) {
        throw new AccessError(404, "Тариф не найден.");
      }
      const updated = await db.plan.update({
        where: { id: plan.id },
        data: {
          aiGenerations: asLimit(input.aiGenerations, "AI"),
          projects: asLimit(input.projects, "проекты"),
          socialAccounts: asLimit(input.socialAccounts, "аккаунты"),
          members: asLimit(input.members, "участники"),
          postsPerMonth: asLimit(input.postsPerMonth, "публикации"),
        },
      });
      await db.auditLog.create({
        data: {
          action: "UPDATE_PLAN_LIMITS",
          entityType: "plan",
          entityId: updated.id,
          actorId: actor.user.id,
          details: `${slug}:${updated.aiGenerations}/${updated.projects}/${updated.socialAccounts}/${updated.members}/${updated.postsPerMonth}`,
        },
      });
      return updated;
    },

    async listIntegrations(userId: string) {
      await requireAdmin(userId);
      const queue = getPublishQueue();
      const ai = getAiStatus();
      return [
        { name: "PostgreSQL", ready: true, provider: "prisma", note: "Основная БД" },
        {
          name: "Очередь",
          ready: queue.driver !== "unconfigured",
          provider: queue.driver,
          note: process.env.REDIS_URL?.trim() ? "REDIS_URL задан" : "inline или не настроена",
        },
        {
          name: "Хранилище",
          ready: storage.ready,
          provider: storage.driver,
          note: storage.setupMessage ?? storage.driver,
        },
        {
          name: "AI",
          ready: ai.ready && ai.imageReady,
          provider: ai.provider,
          note: ai.ready && ai.imageReady ? `${ai.model} / ${ai.imageModel}` : "ключ модели не задан",
        },
        {
          name: "Биллинг",
          ready: getBillingStatus().ready,
          provider: getBillingStatus().provider,
          note: getBillingStatus().ready ? "проверка webhook включена" : "секрет webhook не задан",
        },
        {
          name: "Почта",
          ready: getEmailStatus().ready,
          provider: getEmailStatus().provider,
          note: getEmailStatus().ready ? "адаптер готов" : "почтовый провайдер не задан",
        },
        {
          name: "Telegram",
          ready: true,
          provider: "bot-api",
          note: "Токен хранится на аккаунте workspace, не в глобальном env",
        },
      ];
    },

    async listQueues(userId: string) {
      await requireAdmin(userId);
      const [grouped, recent] = await Promise.all([
        db.publishJob.groupBy({
          by: ["status"],
          _count: { _all: true },
        }),
        db.publishJob.findMany({
          orderBy: { updatedAt: "desc" },
          take: 40,
          include: { workspace: { select: { name: true } }, post: { select: { id: true } } },
        }),
      ]);
      return {
        counts: Object.fromEntries(grouped.map((row) => [row.status, row._count._all])),
        jobs: recent.map((job) => ({
          id: job.id,
          workspace: job.workspace.name,
          postId: job.postId,
          status: job.status,
          attemptCount: job.attemptCount,
          lastError: job.lastError,
          updatedAt: job.updatedAt,
        })),
      };
    },

    async listErrors(userId: string) {
      await requireAdmin(userId);
      const [jobs, accounts] = await Promise.all([
        db.publishJob.findMany({
          where: { status: { in: ["failed", "requires_manual_check"] } },
          orderBy: { updatedAt: "desc" },
          take: 40,
          include: { workspace: { select: { name: true } } },
        }),
        db.socialAccount.findMany({
          where: { status: { in: ["error", "token_expired"] } },
          orderBy: { updatedAt: "desc" },
          take: 40,
          include: { workspace: { select: { name: true } } },
        }),
      ]);
      return {
        jobs: jobs.map((job) => ({
          id: job.id,
          workspace: job.workspace.name,
          status: job.status,
          lastError: job.lastError,
          updatedAt: job.updatedAt,
        })),
        accounts: accounts.map((account) => ({
          id: account.id,
          workspace: account.workspace.name,
          platform: account.platform,
          status: account.status,
          lastError: account.lastError,
          updatedAt: account.updatedAt,
        })),
      };
    },

    async listAudit(userId: string) {
      await requireAdmin(userId);
      return db.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 80,
        include: { actor: { select: { email: true } } },
      });
    },

    async grantAdmin(actorId: string, email: string, role: string) {
      const actor = await requireSuperadmin(actorId);
      const nextRole = parsePlatformAdminRole(role);
      const target = await db.user.findUnique({
        where: { email: email.trim().toLowerCase() },
        include: { platformAdmin: true },
      });
      if (!target) {
        throw new AccessError(404, "Пользователь с таким email не найден.");
      }
      if (target.platformAdmin) {
        throw new AccessError(400, "Пользователь уже является администратором платформы.");
      }
      const created = await db.platformAdmin.create({
        data: { userId: target.id, role: nextRole },
      });
      await db.auditLog.create({
        data: {
          action: "GRANT_PLATFORM_ADMIN",
          entityType: "platform_admin",
          entityId: created.id,
          actorId: actor.user.id,
          details: `${target.email}:${nextRole}`,
        },
      });
      return created;
    },

    async revokeAdmin(actorId: string, targetUserId: string) {
      const actor = await requireSuperadmin(actorId);
      if (actor.user.id === targetUserId) {
        throw new AccessError(403, "Нельзя снять собственную роль администратора.");
      }
      const target = await db.platformAdmin.findUnique({ where: { userId: targetUserId } });
      if (!target) {
        throw new AccessError(404, "Роль администратора не найдена.");
      }
      const superadmins = await db.platformAdmin.count({ where: { role: "Superadmin" } });
      if (target.role === "Superadmin" && superadmins <= 1) {
        throw new AccessError(403, "Нельзя снять последнего Superadmin.");
      }
      await db.platformAdmin.delete({ where: { id: target.id } });
      await db.auditLog.create({
        data: {
          action: "REVOKE_PLATFORM_ADMIN",
          entityType: "platform_admin",
          entityId: target.id,
          actorId: actor.user.id,
          details: targetUserId,
        },
      });
    },
  };
}
