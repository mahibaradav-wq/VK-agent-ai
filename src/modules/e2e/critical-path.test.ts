import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAuthService } from "@/modules/auth/auth-service";
import { createCalendarService } from "@/modules/calendar/calendar-service";
import { createCollaborationService } from "@/modules/collaboration/collaboration-service";
import { createPostService } from "@/modules/posts/post-service";
import { createProjectService } from "@/modules/projects/project-service";
import { createPublishService } from "@/modules/publishing/publish-service";
import { createSocialService } from "@/modules/social/social-service";
import { prisma } from "@/server/db/prisma";
import { createInlineQueue } from "@/server/queue";

const auth = createAuthService(prisma, "http://localhost:3000");
const projects = createProjectService(prisma);
const posts = createPostService(prisma);
const social = createSocialService(prisma);
const calendar = createCalendarService(prisma);
const collab = createCollaborationService(prisma);

describe("minimal vertical SaaS slice", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("goes from register to a real integration_not_configured failure", async () => {
    const address = `slice.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;
    const registered = await auth.register(address, "password123");
    expect(registered.ok).toBe(true);

    const mail = await prisma.devMailMessage.findFirstOrThrow({
      where: { to: address, kind: "verify_email" },
      orderBy: { createdAt: "desc" },
    });
    const token = new URL(mail.url ?? "", "http://localhost:3000").searchParams.get("token") ?? "";
    expect((await auth.verifyEmail(token)).ok).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: address },
      include: { memberships: true },
    });
    const workspaceId = user.memberships[0]?.workspaceId ?? "";
    expect(user.memberships[0]?.role).toBe("Owner");

    const project = await projects.create(user.id, workspaceId, { name: "Срез этапа 14" });
    const account = await social.createRequiresSetup(user.id, workspaceId, {
      platform: "telegram",
      projectId: project.id,
    });
    expect(account.status).toBe("requires_setup");

    const post = await posts.create(user.id, workspaceId, project.id, "Черновик среза");
    const saved = await posts.saveDraft(user.id, workspaceId, post.id, {
      title: "Черновик среза",
      body: "Текст для очереди",
      platforms: ["telegram"],
      mediaIds: [],
    });
    expect(saved.version.number).toBeGreaterThanOrEqual(1);

    await collab.submitForApproval(user.id, workspaceId, post.id);
    await collab.approve(user.id, workspaceId, post.id);
    await calendar.schedule(user.id, workspaceId, post.id, {
      localDateTime: "2026-01-01T12:00",
      timezone: "Europe/Moscow",
    });
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("scheduled");

    const queue = createInlineQueue();
    const publishing = createPublishService(prisma, { queue });
    const jobs = await publishing.enqueueDueSchedules(new Date("2026-10-22T12:00:00.000Z"));
    const job = jobs.find((item) => item.postId === post.id);
    expect(job).toBeTruthy();

    await publishing.processJob(job!.id, "slice-worker");
    const processed = await prisma.post.findUniqueOrThrow({
      where: { id: post.id },
      include: { targets: true },
    });
    expect(processed.status).toBe("failed");
    expect(processed.targets[0]?.status).toMatch(/failed|requires_manual_check/);
    expect(processed.targets[0]?.lastError).toContain("integration_not_configured");

    expect(await prisma.publishAttempt.count({ where: { jobId: job!.id } })).toBeGreaterThan(0);
    expect(
      await prisma.auditLog.count({
        where: { entityId: processed.targets[0]?.id, action: "PUBLISH_ATTEMPT" },
      }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.notification.count({
        where: { workspaceId, entityId: job!.id, type: "publish_job" },
      }),
    ).toBeGreaterThan(0);
  });
});
