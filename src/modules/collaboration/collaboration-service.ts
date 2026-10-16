import { randomBytes } from "node:crypto";

import type { Prisma, PrismaClient, WorkspaceRole } from "@prisma/client";

import { AccessError, assertWorkspaceBound, canAssignRole, parseWorkspaceRole } from "@/modules/access/permissions";
import { createAccessService } from "@/modules/access/access-service";
import { hashToken, isValidEmail } from "@/modules/auth/auth-service";
import { APPROVED_STATUS, REJECTED_STATUS, findActiveApproval } from "@/modules/collaboration/approval";
import { createPostService } from "@/modules/posts/post-service";

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const submitableStatuses = ["draft", "scheduled", "failed"] as const;

function currentVersion<T extends { supersededAt: Date | null }>(versions: T[]) {
  return versions.find((version) => !version.supersededAt) ?? versions[0] ?? null;
}

export function createCollaborationService(
  db: PrismaClient,
  options?: { siteUrl?: string; now?: () => Date },
) {
  const access = createAccessService(db);
  const posts = createPostService(db);
  const siteUrl = options?.siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const now = options?.now ?? (() => new Date());

  async function loadBoundPost(workspaceId: string, postId: string) {
    const post = await db.post.findUnique({
      where: { id: postId },
      include: {
        versions: { orderBy: { number: "desc" as const } },
        targets: { orderBy: { platform: "asc" as const } },
        schedule: true,
        author: { select: { id: true, email: true } },
        project: true,
      },
    });
    assertWorkspaceBound(workspaceId, post, "Публикация");
    return post;
  }

  async function notify(
    tx: Prisma.TransactionClient | PrismaClient,
    input: {
      workspaceId: string;
      userIds: string[];
      type: string;
      title: string;
      body: string;
      entityType: string;
      entityId: string;
      exceptUserId?: string;
    },
  ) {
    const recipients = [...new Set(input.userIds)].filter((userId) => userId && userId !== input.exceptUserId);
    if (recipients.length === 0) {
      return;
    }
    await tx.notification.createMany({
      data: recipients.map((userId) => ({
        workspaceId: input.workspaceId,
        userId,
        type: input.type,
        title: input.title,
        body: input.body,
        entityType: input.entityType,
        entityId: input.entityId,
      })),
    });
  }

  async function approvalRecipients(workspaceId: string, projectId: string) {
    const members = await db.workspaceMember.findMany({ where: { workspaceId } });
    const accesses = await db.projectAccess.findMany({ where: { workspaceId, projectId } });
    const allowed = new Set(accesses.map((item) => item.userId));
    return members
      .filter(
        (member) =>
          member.role === "Owner" || member.role === "Admin" || (member.role === "Approver" && allowed.has(member.userId)),
      )
      .map((member) => member.userId);
  }

  async function assertCanApproveProject(userId: string, role: WorkspaceRole, workspaceId: string, projectId: string) {
    if (role === "Owner" || role === "Admin") {
      return;
    }
    const accessRow = await db.projectAccess.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!accessRow || accessRow.workspaceId !== workspaceId) {
      throw new AccessError(403, "Нет права согласовывать этот проект.");
    }
  }

  async function bindProjects(tx: Prisma.TransactionClient, workspaceId: string, userId: string, projectIds: string[]) {
    const unique = [...new Set(projectIds.filter(Boolean))];
    for (const projectId of unique) {
      const project = await tx.project.findUnique({ where: { id: projectId } });
      assertWorkspaceBound(workspaceId, project, "Проект");
      await tx.projectAccess.upsert({
        where: { projectId_userId: { projectId, userId } },
        create: { workspaceId, projectId, userId },
        update: {},
      });
    }
  }

  return {
    async invite(
      actorId: string,
      workspaceId: string,
      input: { email: string; role: string; projectIds?: string[] },
    ) {
      const role = parseWorkspaceRole(input.role);
      const actor = await access.requirePermission(actorId, workspaceId, "members.add");
      if (!canAssignRole(actor.role, role)) {
        throw new AccessError(403, "Нельзя назначить роль не ниже собственной.");
      }
      const email = input.email.trim().toLowerCase();
      if (!isValidEmail(email)) {
        throw new AccessError(400, "Укажите корректный email.");
      }
      const existingMember = await db.user.findUnique({
        where: { email },
        include: { memberships: { where: { workspaceId } } },
      });
      if (existingMember?.memberships[0]) {
        throw new AccessError(403, "Пользователь уже состоит в этом пространстве.");
      }
      const pending = await db.invitation.findFirst({
        where: { workspaceId, email, acceptedAt: null, expiresAt: { gt: now() } },
      });
      const token = randomBytes(32).toString("hex");
      const tokenHash = hashToken(token);
      const expiresAt = new Date(now().getTime() + INVITE_TTL_MS);
      const storedProjectIds = role === "Approver" ? (input.projectIds ?? []).join(",") : "";
      if (role === "Approver") {
        for (const projectId of input.projectIds ?? []) {
          const project = await db.project.findUnique({ where: { id: projectId } });
          assertWorkspaceBound(workspaceId, project, "Проект");
        }
      }
      const invitation = pending
        ? await db.invitation.update({
            where: { id: pending.id },
            data: { role, tokenHash, expiresAt, invitedById: actorId, projectIds: storedProjectIds },
          })
        : await db.invitation.create({
            data: {
              workspaceId,
              email,
              role,
              tokenHash,
              invitedById: actorId,
              expiresAt,
              projectIds: storedProjectIds,
            },
          });

      await db.auditLog.create({
        data: {
          action: pending ? "RESEND_INVITATION" : "CREATE_INVITATION",
          entityType: "invitation",
          entityId: invitation.id,
          actorId,
          details: `${email}:${role}`,
        },
      });
      await db.devMailMessage.create({
        data: {
          to: email,
          subject: "Приглашение в Polka Social",
          body: "Письмо не уходило во внешнюю почту. Откройте ссылку из локального стенда, чтобы принять приглашение.",
          url: `${siteUrl}/accept-invite?token=${token}`,
          kind: "invitation",
        },
      });
      return { invitation, mailboxUrl: "/dev/mailbox", projectIds: input.projectIds ?? [] };
    },

    async listInvitations(userId: string, workspaceId: string) {
      await access.requirePermission(userId, workspaceId, "members.view");
      return db.invitation.findMany({
        where: { workspaceId, acceptedAt: null },
        include: { invitedBy: { select: { email: true } } },
        orderBy: { createdAt: "desc" },
      });
    },

    async peekInvitation(token: string) {
      if (!token) {
        throw new AccessError(400, "Токен приглашения отсутствует.");
      }
      const invitation = await db.invitation.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { workspace: true },
      });
      if (!invitation || invitation.acceptedAt || invitation.expiresAt < now()) {
        throw new AccessError(400, "Приглашение недействительно или просрочено.");
      }
      return {
        email: invitation.email,
        role: invitation.role,
        workspaceName: invitation.workspace.name,
        workspaceId: invitation.workspaceId,
        projectIds: invitation.projectIds.split(",").filter(Boolean),
      };
    },

    async acceptInvitation(userId: string, token: string, projectIds?: string[]) {
      if (!token) {
        throw new AccessError(400, "Токен приглашения отсутствует.");
      }
      const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
      const invitation = await db.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!invitation || invitation.acceptedAt || invitation.expiresAt < now()) {
        throw new AccessError(400, "Приглашение недействительно или просрочено.");
      }
      if (user.email !== invitation.email) {
        throw new AccessError(403, "Войдите с email, на который отправлено приглашение.");
      }
      const existing = await db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId } },
      });
      if (existing) {
        await db.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: now() } });
        return existing;
      }
      const member = await db.$transaction(async (tx) => {
        const created = await tx.workspaceMember.create({
          data: { workspaceId: invitation.workspaceId, userId, role: invitation.role },
        });
        await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: now() } });
        const assigned = projectIds?.length
          ? projectIds
          : invitation.projectIds.split(",").filter(Boolean);
        if (invitation.role === "Approver" && assigned.length) {
          await bindProjects(tx, invitation.workspaceId, userId, assigned);
        }
        await tx.auditLog.create({
          data: {
            action: "ACCEPT_INVITATION",
            entityType: "workspace",
            entityId: invitation.workspaceId,
            actorId: userId,
            details: invitation.role,
          },
        });
        return created;
      });
      return member;
    },

    async setProjectAccess(actorId: string, workspaceId: string, userId: string, projectIds: string[]) {
      await access.requirePermission(actorId, workspaceId, "members.changeRole");
      const member = await db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
      });
      if (!member) {
        throw new AccessError(404, "Участник не найден.");
      }
      if (member.role !== "Approver") {
        throw new AccessError(400, "Проекты согласования назначаются только роли Approver.");
      }
      await db.$transaction(async (tx) => {
        await tx.projectAccess.deleteMany({ where: { workspaceId, userId } });
        await bindProjects(tx, workspaceId, userId, projectIds);
        await tx.auditLog.create({
          data: {
            action: "SET_PROJECT_ACCESS",
            entityType: "workspace_member",
            entityId: member.id,
            actorId,
            details: projectIds.join(",") || "none",
          },
        });
      });
    },

    async listProjectAccess(userId: string, workspaceId: string) {
      await access.requirePermission(userId, workspaceId, "members.view");
      return db.projectAccess.findMany({
        where: { workspaceId },
        include: { project: true, user: { select: { id: true, email: true } } },
      });
    },

    async submitForApproval(userId: string, workspaceId: string, postId: string) {
      await access.requirePermission(userId, workspaceId, "post.update");
      const post = await loadBoundPost(workspaceId, postId);
      if (!submitableStatuses.includes(post.status as (typeof submitableStatuses)[number])) {
        throw new AccessError(403, "В текущем статусе нельзя отправить на согласование.");
      }
      const version = currentVersion(post.versions);
      if (!version || version.title.trim().length < 2) {
        throw new AccessError(400, "Сохраните версию с названием, прежде чем отправлять на согласование.");
      }
      if (post.targets.length === 0) {
        throw new AccessError(400, "Добавьте хотя бы одну цель публикации.");
      }
      const recipients = await approvalRecipients(workspaceId, post.projectId);
      await db.$transaction(async (tx) => {
        await tx.post.update({ where: { id: post.id }, data: { status: "pending_approval" } });
        await tx.postTarget.updateMany({
          where: { postId: post.id, status: { in: ["draft", "scheduled", "failed", "approved"] } },
          data: { status: "pending_approval" },
        });
        await tx.auditLog.create({
          data: {
            action: "SUBMIT_POST_APPROVAL",
            entityType: "post",
            entityId: post.id,
            actorId: userId,
            details: version.id,
          },
        });
        await notify(tx, {
          workspaceId,
          userIds: recipients,
          type: "approval_requested",
          title: "Нужно согласование",
          body: `Версия «${version.title}» ждет согласования.`,
          entityType: "post",
          entityId: post.id,
          exceptUserId: userId,
        });
      });
      return posts.get(userId, workspaceId, post.id);
    },

    async approve(userId: string, workspaceId: string, postId: string, note?: string) {
      const membership = await access.requirePermission(userId, workspaceId, "post.approve");
      const post = await loadBoundPost(workspaceId, postId);
      await assertCanApproveProject(userId, membership.role, workspaceId, post.projectId);
      if (post.status !== "pending_approval") {
        throw new AccessError(403, "Согласовать можно только публикацию в статусе pending_approval.");
      }
      const version = currentVersion(post.versions);
      if (!version) {
        throw new AccessError(400, "У публикации нет версии для согласования.");
      }
      const nextStatus = post.schedule ? "scheduled" : "approved";
      const platforms = post.targets.map((target) => target.platform).join(",");
      await db.$transaction(async (tx) => {
        await tx.approval.create({
          data: {
            workspaceId,
            postId: post.id,
            postVersionId: version.id,
            actorId: userId,
            status: APPROVED_STATUS,
            targetPlatforms: platforms,
            note: note?.trim() || null,
          },
        });
        await tx.post.update({ where: { id: post.id }, data: { status: nextStatus } });
        await tx.postTarget.updateMany({
          where: { postId: post.id, status: "pending_approval" },
          data: { status: nextStatus },
        });
        await tx.auditLog.create({
          data: {
            action: "APPROVE_POST",
            entityType: "post",
            entityId: post.id,
            actorId: userId,
            details: version.id,
          },
        });
        await notify(tx, {
          workspaceId,
          userIds: [post.authorId],
          type: "post_approved",
          title: "Публикация согласована",
          body: `Версия «${version.title}» согласована.`,
          entityType: "post",
          entityId: post.id,
          exceptUserId: userId,
        });
      });
      return posts.get(userId, workspaceId, post.id);
    },

    async reject(userId: string, workspaceId: string, postId: string, note?: string) {
      const membership = await access.requirePermission(userId, workspaceId, "post.approve");
      const post = await loadBoundPost(workspaceId, postId);
      await assertCanApproveProject(userId, membership.role, workspaceId, post.projectId);
      if (post.status !== "pending_approval") {
        throw new AccessError(403, "Отклонить можно только публикацию в статусе pending_approval.");
      }
      const version = currentVersion(post.versions);
      if (!version) {
        throw new AccessError(400, "У публикации нет версии.");
      }
      await db.$transaction(async (tx) => {
        await tx.approval.create({
          data: {
            workspaceId,
            postId: post.id,
            postVersionId: version.id,
            actorId: userId,
            status: REJECTED_STATUS,
            targetPlatforms: post.targets.map((target) => target.platform).join(","),
            note: note?.trim() || null,
          },
        });
        await tx.post.update({ where: { id: post.id }, data: { status: "draft" } });
        await tx.postTarget.updateMany({
          where: { postId: post.id, status: "pending_approval" },
          data: { status: "draft" },
        });
        await tx.auditLog.create({
          data: {
            action: "REJECT_POST",
            entityType: "post",
            entityId: post.id,
            actorId: userId,
            details: version.id,
          },
        });
        await notify(tx, {
          workspaceId,
          userIds: [post.authorId],
          type: "post_rejected",
          title: "Публикация отклонена",
          body: note?.trim() || `Версия «${version.title}» отклонена.`,
          entityType: "post",
          entityId: post.id,
          exceptUserId: userId,
        });
      });
      return posts.get(userId, workspaceId, post.id);
    },

    async addComment(userId: string, workspaceId: string, postId: string, body: string) {
      await access.requirePermission(userId, workspaceId, "comment.create");
      const post = await loadBoundPost(workspaceId, postId);
      const text = body.trim();
      if (text.length < 2) {
        throw new AccessError(400, "Комментарий должен содержать минимум 2 символа.");
      }
      const comment = await db.$transaction(async (tx) => {
        const created = await tx.comment.create({
          data: { workspaceId, postId: post.id, authorId: userId, body: text },
          include: { author: { select: { id: true, email: true } } },
        });
        await tx.auditLog.create({
          data: {
            action: "COMMENT_POST",
            entityType: "post",
            entityId: post.id,
            actorId: userId,
            details: created.id,
          },
        });
        await notify(tx, {
          workspaceId,
          userIds: [post.authorId],
          type: "post_comment",
          title: "Новый комментарий",
          body: text.slice(0, 180),
          entityType: "post",
          entityId: post.id,
          exceptUserId: userId,
        });
        return created;
      });
      return comment;
    },

    async listComments(userId: string, workspaceId: string, postId: string) {
      await access.requirePermission(userId, workspaceId, "post.view");
      await loadBoundPost(workspaceId, postId);
      return db.comment.findMany({
        where: { workspaceId, postId },
        include: { author: { select: { id: true, email: true } } },
        orderBy: { createdAt: "asc" },
      });
    },

    async listApprovals(userId: string, workspaceId: string, postId: string) {
      await access.requirePermission(userId, workspaceId, "post.view");
      await loadBoundPost(workspaceId, postId);
      return db.approval.findMany({
        where: { workspaceId, postId },
        include: { actor: { select: { email: true } }, postVersion: { select: { number: true, title: true } } },
        orderBy: { createdAt: "desc" },
      });
    },

    async listAudit(userId: string, workspaceId: string, postId: string) {
      await access.requirePermission(userId, workspaceId, "post.view");
      await loadBoundPost(workspaceId, postId);
      return db.auditLog.findMany({
        where: { entityType: "post", entityId: postId },
        include: { actor: { select: { email: true } } },
        orderBy: { createdAt: "desc" },
        take: 40,
      });
    },

    async listNotifications(userId: string, workspaceId: string) {
      await access.requireMembership(userId, workspaceId);
      return db.notification.findMany({
        where: { workspaceId, userId },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
    },

    async unreadCount(userId: string, workspaceId: string) {
      await access.requireMembership(userId, workspaceId);
      return db.notification.count({ where: { workspaceId, userId, readAt: null } });
    },

    async markRead(userId: string, workspaceId: string, notificationId?: string) {
      await access.requireMembership(userId, workspaceId);
      if (notificationId) {
        const row = await db.notification.findUnique({ where: { id: notificationId } });
        assertWorkspaceBound(workspaceId, row, "Уведомление");
        if (row.userId !== userId) {
          throw new AccessError(403, "Нельзя отметить чужое уведомление.");
        }
        return db.notification.update({ where: { id: notificationId }, data: { readAt: now() } });
      }
      await db.notification.updateMany({
        where: { workspaceId, userId, readAt: null },
        data: { readAt: now() },
      });
    },

    async currentApproval(postId: string, postVersionId: string) {
      return findActiveApproval(db, postId, postVersionId);
    },
  };
}
