import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createAuthService } from "@/modules/auth/auth-service";
import { createCollaborationService } from "@/modules/collaboration/collaboration-service";
import { createPostService } from "@/modules/posts/post-service";
import { createProjectService } from "@/modules/projects/project-service";
import { createPublishService } from "@/modules/publishing/publish-service";
import { createWorkspaceService } from "@/modules/workspaces/workspace-service";
import { prisma } from "@/server/db/prisma";
import { createInlineQueue } from "@/server/queue";

const auth = createAuthService(prisma, "http://localhost:3000");
const posts = createPostService(prisma);
const projects = createProjectService(prisma);
const workspaces = createWorkspaceService(prisma);
const collab = createCollaborationService(prisma, { siteUrl: "http://localhost:3000" });

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

async function draftPost(owner: { userId: string; workspaceId: string; projectId: string }, title = "На согласование") {
  const created = await posts.create(owner.userId, owner.workspaceId, owner.projectId, title);
  await posts.saveDraft(owner.userId, owner.workspaceId, created.id, {
    title,
    body: "Текст",
    platforms: ["telegram"],
    mediaIds: [],
  });
  return created;
}

describe("collaboration invitations, approval and comments", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores an invitation in the local mailbox and accepts it after register", async () => {
    const owner = await registerOwner("inv-owner");
    const invitedEmail = email("inv-new");
    const sent = await collab.invite(owner.userId, owner.workspaceId, { email: invitedEmail, role: "Editor" });
    expect(sent.mailboxUrl).toBe("/dev/mailbox");
    const mail = await prisma.devMailMessage.findFirstOrThrow({
      where: { to: invitedEmail, kind: "invitation" },
      orderBy: { createdAt: "desc" },
    });
    expect(mail.url).toContain("/accept-invite?token=");
    const token = new URL(mail.url ?? "", "http://localhost:3000").searchParams.get("token") ?? "";

    const registered = await auth.register(invitedEmail, "password123");
    expect(registered.ok).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: invitedEmail } });
    const member = await collab.acceptInvitation(user.id, token);
    expect(member.role).toBe("Editor");
    expect(member.workspaceId).toBe(owner.workspaceId);
  });

  it("lets Approver approve only assigned project, blocks Editor publish without approval, Viewer is read-only", async () => {
    const owner = await registerOwner("col-owner");
    const extraProject = await projects.create(owner.userId, owner.workspaceId, { name: "Второй проект" });
    const approver = await registerOwner("col-appr");
    const editor = await registerOwner("col-edit");
    const viewer = await registerOwner("col-view");
    await workspaces.addMember(owner.userId, owner.workspaceId, approver.address, "Approver");
    await workspaces.addMember(owner.userId, owner.workspaceId, editor.address, "Editor");
    await workspaces.addMember(owner.userId, owner.workspaceId, viewer.address, "Viewer");
    await collab.setProjectAccess(owner.userId, owner.workspaceId, approver.userId, [owner.projectId]);

    const allowed = await posts.create(editor.userId, owner.workspaceId, owner.projectId, "Разрешённый");
    await posts.saveDraft(editor.userId, owner.workspaceId, allowed.id, {
      title: "Разрешённый",
      body: "Текст",
      platforms: ["telegram"],
      mediaIds: [],
    });
    const foreign = await posts.create(editor.userId, owner.workspaceId, extraProject.id, "Чужой проект");
    await posts.saveDraft(editor.userId, owner.workspaceId, foreign.id, {
      title: "Чужой проект",
      body: "Текст",
      platforms: ["telegram"],
      mediaIds: [],
    });

    await expectAccess(
      collab.addComment(viewer.userId, owner.workspaceId, allowed.id, "нельзя"),
      403,
      /Недостаточно прав/,
    );
    const comment = await collab.addComment(editor.userId, owner.workspaceId, allowed.id, "Проверьте тон");
    expect(comment.body).toBe("Проверьте тон");

    await expectAccess(
      createPublishService(prisma, { queue: createInlineQueue() }).enqueue(editor.userId, owner.workspaceId, allowed.id),
      403,
      /согласование текущей версии/,
    );

    await collab.submitForApproval(editor.userId, owner.workspaceId, allowed.id);
    await collab.submitForApproval(editor.userId, owner.workspaceId, foreign.id);

    await expectAccess(collab.approve(editor.userId, owner.workspaceId, allowed.id), 403, /Недостаточно прав/);
    await expectAccess(
      collab.approve(approver.userId, owner.workspaceId, foreign.id),
      403,
      /Нет права согласовывать этот проект/,
    );
    await collab.approve(approver.userId, owner.workspaceId, allowed.id);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: allowed.id } })).status).toBe("approved");

    const notes = await collab.listNotifications(editor.userId, owner.workspaceId);
    expect(notes.some((item) => item.type === "post_approved")).toBe(true);

    const publishing = createPublishService(prisma, { queue: createInlineQueue() });
    const job = await publishing.enqueue(editor.userId, owner.workspaceId, allowed.id);
    expect(job.postId).toBe(allowed.id);

    const next = await posts.create(editor.userId, owner.workspaceId, owner.projectId, "После правки");
    await posts.saveDraft(editor.userId, owner.workspaceId, next.id, {
      title: "После правки",
      body: "Текст",
      platforms: ["telegram"],
      mediaIds: [],
    });
    await collab.submitForApproval(editor.userId, owner.workspaceId, next.id);
    await collab.approve(approver.userId, owner.workspaceId, next.id);
    await posts.saveDraft(editor.userId, owner.workspaceId, next.id, {
      title: "После правки",
      body: "Новый текст после согласования",
      platforms: ["telegram"],
      mediaIds: [],
    });
    await expectAccess(
      publishing.enqueue(editor.userId, owner.workspaceId, next.id),
      403,
      /согласование текущей версии/,
    );
    expect(await prisma.approval.count({ where: { postId: next.id, status: "invalidated" } })).toBe(1);
  });

  it("rejects spoofed post ids and does not send invitation email outside the mailbox", async () => {
    const owner = await registerOwner("col-iso");
    const other = await registerOwner("col-other");
    const post = await draftPost(owner);
    await expectAccess(
      collab.submitForApproval(other.userId, other.workspaceId, post.id),
      403,
      /другому рабочему пространству/,
    );
    await expectAccess(collab.listComments(other.userId, owner.workspaceId, post.id), 404, /не найдено/);
    const invited = email("ghost");
    await collab.invite(owner.userId, owner.workspaceId, { email: invited, role: "Viewer" });
    const mail = await prisma.devMailMessage.findFirstOrThrow({ where: { to: invited, kind: "invitation" } });
    expect(mail.url).toContain("/accept-invite");
    expect(mail.body).toMatch(/не уходило во внешнюю почту/i);
  });
});
