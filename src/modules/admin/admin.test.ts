import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createAdminService } from "@/modules/admin/admin-service";
import { requirePlatformAdmin } from "@/modules/admin/access";
import { createAuthService } from "@/modules/auth/auth-service";
import { createCollaborationService } from "@/modules/collaboration/collaboration-service";
import { createProjectService } from "@/modules/projects/project-service";
import { prisma } from "@/server/db/prisma";
import { createDevMailboxEmailAdapter, createUnconfiguredEmailAdapter } from "@/server/notifications";
import { createHttpEmailAdapter } from "@/server/notifications/http-email";

const auth = createAuthService(prisma, "http://localhost:3000");
const projects = createProjectService(prisma);
const admin = createAdminService(prisma);

function email(label: string) {
  return `${label}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;
}

async function expectAccess(promise: Promise<unknown>, status: 400 | 403 | 404, message: RegExp) {
  const error = await promise.then(
    () => {
      throw new Error("expected AccessError");
    },
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AccessError);
  expect(error).toMatchObject({ status, message: expect.stringMatching(message) });
}

async function registerOwner(label: string) {
  const address = email(label);
  const result = await auth.register(address, "password123");
  expect(result.ok).toBe(true);
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: address },
    include: { memberships: true },
  });
  const workspaceId = user.memberships[0]?.workspaceId ?? "";
  const project = await projects.create(user.id, workspaceId, { name: `Проект ${label}` });
  return { address, userId: user.id, workspaceId, projectId: project.id };
}

async function makeSuperadmin(userId: string) {
  return prisma.platformAdmin.create({ data: { userId, role: "Superadmin" } });
}

describe("platform admin and email notifications", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("blocks a regular workspace Owner from admin data", async () => {
    const owner = await registerOwner("adm-owner");
    await expectAccess(admin.overview(owner.userId), 403, /Недостаточно прав для админки/);
    await expectAccess(admin.listUsers(owner.userId), 403, /Недостаточно прав для админки/);
    await expectAccess(admin.listWorkspaces(owner.userId), 403, /Недостаточно прав для админки/);
    await expectAccess(admin.listAudit(owner.userId), 403, /Недостаточно прав для админки/);
    await expectAccess(admin.updatePlanLimits(owner.userId, "start", {
      aiGenerations: 1,
      projects: 1,
      socialAccounts: 1,
      members: 1,
      postsPerMonth: 1,
    }), 403, /Недостаточно прав для админки/);
  });

  it("lets a Superadmin read platform data and records grant/revoke in audit", async () => {
    const actor = await registerOwner("adm-super");
    const target = await registerOwner("adm-target");
    await makeSuperadmin(actor.userId);

    const overview = await admin.overview(actor.userId);
    expect(overview.users).toBeGreaterThanOrEqual(2);
    const users = await admin.listUsers(actor.userId);
    expect(users.some((row) => row.email === target.address)).toBe(true);

    await admin.grantAdmin(actor.userId, target.address, "Support");
    await expectAccess(admin.grantAdmin(actor.userId, target.address, "Support"), 400, /уже является администратором/);
    await expectAccess(admin.updatePlanLimits(target.userId, "start", {
      aiGenerations: 12,
      projects: 3,
      socialAccounts: 2,
      members: 4,
      postsPerMonth: 9,
    }), 403, /только Superadmin/);

    await admin.revokeAdmin(actor.userId, target.userId);
    await expectAccess(admin.overview(target.userId), 403, /Недостаточно прав для админки/);
    await expectAccess(admin.revokeAdmin(actor.userId, actor.userId), 403, /собственную роль/);

    const audit = await admin.listAudit(actor.userId);
    expect(audit.some((row) => row.action === "GRANT_PLATFORM_ADMIN" && row.details?.includes(target.address))).toBe(true);
    expect(audit.some((row) => row.action === "REVOKE_PLATFORM_ADMIN")).toBe(true);
  });

  it("updates plan limits only for Superadmin and keeps the change", async () => {
    const actor = await registerOwner("adm-plan");
    await makeSuperadmin(actor.userId);
    const current = (await admin.listPlans(actor.userId)).find((plan) => plan.slug === "start");
    expect(current).toBeTruthy();
    const updated = await admin.updatePlanLimits(actor.userId, "start", {
      aiGenerations: current!.aiGenerations,
      projects: current!.projects,
      socialAccounts: current!.socialAccounts,
      members: current!.members,
      postsPerMonth: 4242,
    });
    expect(updated.postsPerMonth).toBe(4242);
    const again = await admin.listPlans(actor.userId);
    expect(again.find((plan) => plan.slug === "start")?.postsPerMonth).toBe(4242);
    await admin.updatePlanLimits(actor.userId, "start", {
      aiGenerations: current!.aiGenerations,
      projects: current!.projects,
      socialAccounts: current!.socialAccounts,
      members: current!.members,
      postsPerMonth: current!.postsPerMonth,
    });
    const audit = await prisma.auditLog.findFirst({
      where: { action: "UPDATE_PLAN_LIMITS", actorId: actor.userId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.details).toBe(
      `start:${current!.aiGenerations}/${current!.projects}/${current!.socialAccounts}/${current!.members}/${current!.postsPerMonth}`,
    );
  });

  it("bootstraps Superadmin from ADMIN_EMAILS and hides secrets in integrations", async () => {
    const owner = await registerOwner("adm-boot");
    const previous = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = owner.address;
    try {
      const actor = await requirePlatformAdmin(prisma, owner.userId);
      expect(actor.admin.role).toBe("Superadmin");
      const integrations = await admin.listIntegrations(owner.userId);
      const dumped = JSON.stringify(integrations);
      expect(dumped).not.toMatch(/sk-|whsec_|polka_dev_password|Bearer /);
      expect(integrations.some((item) => item.name === "Почта")).toBe(true);
    } finally {
      process.env.ADMIN_EMAILS = previous;
    }
  });

  it("sends notification email only through the adapter and never fakes an external send", async () => {
    const owner = await registerOwner("adm-mail");
    const editor = await registerOwner("adm-mail-ed");
    const workspaces = (await import("@/modules/workspaces/workspace-service")).createWorkspaceService(prisma);
    await workspaces.addMember(owner.userId, owner.workspaceId, editor.address, "Editor");
    const posts = (await import("@/modules/posts/post-service")).createPostService(prisma);
    const post = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Комментарий для почты");

    const blocked = createCollaborationService(prisma, { email: createUnconfiguredEmailAdapter() });
    await blocked.addComment(editor.userId, owner.workspaceId, post.id, "Текст для автора");
    const mailboxBefore = await prisma.devMailMessage.count({
      where: { to: owner.address, kind: "notification" },
    });
    expect(mailboxBefore).toBe(0);

    const mailbox = createCollaborationService(prisma, { email: createDevMailboxEmailAdapter(prisma) });
    await mailbox.addComment(editor.userId, owner.workspaceId, post.id, "Второй комментарий");
    const mail = await prisma.devMailMessage.findFirst({
      where: { to: owner.address, kind: "notification" },
      orderBy: { createdAt: "desc" },
    });
    expect(mail?.subject).toBe("Новый комментарий");
    expect(mail?.body).toContain("Второй комментарий");

    const calls: Array<{ url: string; authorization?: string }> = [];
    const http = createHttpEmailAdapter({
      apiKey: "sk-mail-secret",
      endpoint: "https://mail.example.test/send",
      from: "noreply@example.test",
      fetchImpl: async (url, init) => {
        const headers = new Headers(init?.headers);
        calls.push({ url: String(url), authorization: headers.get("authorization") ?? undefined });
        return new Response("{}", { status: 200 });
      },
    });
    const sending = createCollaborationService(prisma, { email: http });
    await sending.addComment(editor.userId, owner.workspaceId, post.id, "Третий");
    expect(calls[0]?.authorization).toBe("Bearer sk-mail-secret");
    const notes = await mailbox.listNotifications(owner.userId, owner.workspaceId);
    expect(notes.length).toBeGreaterThanOrEqual(2);
    await mailbox.markRead(owner.userId, owner.workspaceId, notes[0]?.id);
    expect((await mailbox.listNotifications(owner.userId, owner.workspaceId))[0]?.readAt).not.toBeNull();
  });
});
