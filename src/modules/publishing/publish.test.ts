import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createAuthService } from "@/modules/auth/auth-service";
import { createCalendarService } from "@/modules/calendar/calendar-service";
import { createPostService } from "@/modules/posts/post-service";
import { createProjectService } from "@/modules/projects/project-service";
import { aggregatePostStatus } from "@/modules/publishing/aggregate";
import { nextBackoffMs } from "@/modules/publishing/backoff";
import { createCollaborationService } from "@/modules/collaboration/collaboration-service";
import { createPublishService } from "@/modules/publishing/publish-service";
import { createWorkspaceService } from "@/modules/workspaces/workspace-service";
import { prisma } from "@/server/db/prisma";
import { createInlineQueue } from "@/server/queue";
import { createUnconfiguredQueue } from "@/server/queue/unconfigured-queue";
import { createAdapterRegistry } from "@/server/social";
import type { PublishOutcome, SocialAdapter } from "@/server/social";

const auth = createAuthService(prisma, "http://localhost:3000");
const posts = createPostService(prisma);
const projects = createProjectService(prisma);
const calendar = createCalendarService(prisma);
const workspaces = createWorkspaceService(prisma);
const collab = createCollaborationService(prisma);

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

function scripted(platform: string, script: PublishOutcome[] | ((n: number) => PublishOutcome)): SocialAdapter & { calls: number } {
  const adapter = {
    platform,
    calls: 0,
    async publish() {
      adapter.calls += 1;
      if (typeof script === "function") {
        return script(adapter.calls);
      }
      return script[Math.min(adapter.calls - 1, script.length - 1)] ?? script[0]!;
    },
  };
  return adapter;
}

async function draftWithTargets(
  owner: { userId: string; workspaceId: string; projectId: string },
  platforms: string[],
  title = "Очередь",
) {
  const created = await posts.create(owner.userId, owner.workspaceId, owner.projectId, title);
  await posts.saveDraft(owner.userId, owner.workspaceId, created.id, {
    title,
    body: "Текст для очереди",
    platforms,
    mediaIds: [],
  });
  return created;
}

async function approveCurrent(owner: { userId: string; workspaceId: string }, postId: string) {
  await collab.submitForApproval(owner.userId, owner.workspaceId, postId);
  await collab.approve(owner.userId, owner.workspaceId, postId);
}

describe("publish aggregation helpers", () => {
  it("aggregates post status from targets and computes backoff", () => {
    expect(aggregatePostStatus([{ status: "published" }, { status: "published" }])).toBe("published");
    expect(aggregatePostStatus([{ status: "published" }, { status: "queued" }])).toBe("queued");
    expect(aggregatePostStatus([{ status: "published" }, { status: "failed" }])).toBe("failed");
    expect(aggregatePostStatus([{ status: "published" }, { status: "requires_manual_check" }])).toBe("failed");
    expect(nextBackoffMs(1, [10, 20, 40])).toBe(10);
    expect(nextBackoffMs(3, [10, 20, 40])).toBe(40);
    expect(nextBackoffMs(9, [10, 20, 40])).toBe(40);
  });
});

describe("publishing queue", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("enqueues once per version and does not fake a successful social publish", async () => {
    const owner = await registerOwner("pub-idemp");
    const post = await draftWithTargets(owner, ["vk", "telegram"]);
    await approveCurrent(owner, post.id);
    const queue = createInlineQueue();
    const publishing = createPublishService(prisma, { queue });

    const first = await publishing.enqueue(owner.userId, owner.workspaceId, post.id);
    const second = await publishing.enqueue(owner.userId, owner.workspaceId, post.id);
    expect(second.id).toBe(first.id);
    expect(await prisma.publishJob.count({ where: { postId: post.id } })).toBe(1);
    expect(queue.jobs).toHaveLength(2);

    await publishing.processJob(first.id, "worker-a");
    const processed = await prisma.post.findUniqueOrThrow({
      where: { id: post.id },
      include: { targets: true },
    });
    expect(processed.status).toBe("failed");
    expect(processed.targets.every((target) => target.status === "failed")).toBe(true);
    expect(processed.targets.every((target) => target.lastError?.includes("integration_not_configured"))).toBe(true);
    expect(await prisma.publishAttempt.count({ where: { jobId: first.id } })).toBe(2);
    expect((await prisma.publishJob.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("failed");
  });

  it("retries only temporary failures and never resends a successful target", async () => {
    const owner = await registerOwner("pub-partial");
    const post = await draftWithTargets(owner, ["vk", "telegram"], "Частичный успех");
    await approveCurrent(owner, post.id);
    const vk = scripted("vk", [{ kind: "success", externalId: "vk-1" }]);
    const telegram = scripted("telegram", [
      { kind: "temporary_failure", code: "rate_limit", message: "Подождите" },
      { kind: "success", externalId: "tg-2" },
    ]);
    const queue = createInlineQueue();
    const publishing = createPublishService(prisma, {
      queue,
      adapters: createAdapterRegistry([vk, telegram]),
      backoff: [5, 10, 20],
    });

    const job = await publishing.enqueue(owner.userId, owner.workspaceId, post.id);
    const t0 = new Date("2026-10-14T12:00:00.000Z");
    await publishing.processJob(job.id, "worker-b", t0);

    const afterFirst = await prisma.post.findUniqueOrThrow({
      where: { id: post.id },
      include: { targets: true },
    });
    expect(afterFirst.status).toBe("queued");
    expect(afterFirst.targets.find((target) => target.platform === "vk")?.status).toBe("published");
    expect(afterFirst.targets.find((target) => target.platform === "telegram")?.status).toBe("queued");
    expect(vk.calls).toBe(1);
    expect(telegram.calls).toBe(1);

    const waiting = await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(waiting.status).toBe("pending");
    expect(waiting.nextAttemptAt?.toISOString()).toBe("2026-10-14T12:00:00.005Z");

    await publishing.processJob(job.id, "worker-b", t0);
    expect(vk.calls).toBe(1);
    expect(telegram.calls).toBe(1);

    const t1 = new Date("2026-10-14T12:00:00.005Z");
    await publishing.processJob(job.id, "worker-b", t1);
    expect(vk.calls).toBe(1);
    expect(telegram.calls).toBe(2);

    const done = await prisma.post.findUniqueOrThrow({
      where: { id: post.id },
      include: { targets: true },
    });
    expect(done.status).toBe("published");
    expect(done.targets.every((target) => target.status === "published")).toBe(true);
    expect((await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("completed");
  });

  it("moves unknown adapter results to requires_manual_check and does not auto-retry them", async () => {
    const owner = await registerOwner("pub-unknown");
    const post = await draftWithTargets(owner, ["vk"]);
    await approveCurrent(owner, post.id);
    const vk = scripted("vk", [{ kind: "unknown", code: "timeout", message: "Нет ответа" }]);
    const publishing = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: createAdapterRegistry([vk]),
    });
    const job = await publishing.enqueue(owner.userId, owner.workspaceId, post.id);
    await publishing.processJob(job.id, "worker-c");
    const target = await prisma.postTarget.findFirstOrThrow({ where: { postId: post.id } });
    expect(target.status).toBe("requires_manual_check");
    expect((await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("requires_manual_check");
    expect(vk.calls).toBe(1);

    await expectAccess(
      publishing.enqueue(owner.userId, owner.workspaceId, post.id),
      400,
      /неопределённые цели повторно не отправляются/,
    );
    expect(vk.calls).toBe(1);
  });

  it("claims a job atomically so only one worker processes it", async () => {
    const owner = await registerOwner("pub-claim");
    const post = await draftWithTargets(owner, ["vk"]);
    await approveCurrent(owner, post.id);
    const publishing = createPublishService(prisma, { queue: createInlineQueue() });
    const job = await publishing.enqueue(owner.userId, owner.workspaceId, post.id);
    const [first, second] = await Promise.all([
      publishing.claim(job.id, "w-1"),
      publishing.claim(job.id, "w-2"),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(await prisma.publishJob.count({ where: { id: job.id, status: "claimed" } })).toBe(1);
  });

  it("blocks a Viewer and a spoofed postId, and rejects an unconfigured Redis dispatcher as success", async () => {
    const owner = await registerOwner("pub-acl");
    const other = await registerOwner("pub-other");
    const viewer = await registerOwner("pub-viewer");
    await workspaces.addMember(owner.userId, owner.workspaceId, viewer.address, "Viewer");
    const post = await draftWithTargets(owner, ["vk"], "Права очереди");
    await approveCurrent(owner, post.id);
    const publishing = createPublishService(prisma, { queue: createInlineQueue() });

    await expectAccess(publishing.enqueue(viewer.userId, owner.workspaceId, post.id), 403, /Недостаточно прав/);
    await expectAccess(
      publishing.enqueue(other.userId, other.workspaceId, post.id),
      403,
      /другому рабочему пространству/,
    );
    await expectAccess(publishing.list(other.userId, owner.workspaceId), 404, /не найдено/);

    const unsafe = createPublishService(prisma, { queue: createUnconfiguredQueue() });
    const lonely = await draftWithTargets(owner, ["telegram"], "Без Redis");
    await approveCurrent(owner, lonely.id);
    await expectAccess(
      unsafe.enqueue(owner.userId, owner.workspaceId, lonely.id),
      400,
      /требуется настройка интеграции Redis/,
    );
    const stored = await prisma.post.findUniqueOrThrow({ where: { id: lonely.id } });
    expect(stored.status).toBe("queued");
    expect(stored.status).not.toBe("published");
  });

  it("enqueues a due schedule without publishing to a real network", async () => {
    const owner = await registerOwner("pub-due");
    const created = await calendar.createOnDate(owner.userId, owner.workspaceId, owner.projectId, {
      date: "2026-01-01",
      timezone: "Europe/Moscow",
      title: "Просроченный слот",
    });
    await posts.saveDraft(owner.userId, owner.workspaceId, created.id, {
      title: "Просроченный слот",
      body: "Автопостинг",
      platforms: ["vk"],
      mediaIds: [],
    });
    await approveCurrent(owner, created.id);
    await calendar.schedule(owner.userId, owner.workspaceId, created.id, {
      localDateTime: "2026-01-01T12:00",
      timezone: "Europe/Moscow",
    });

    const queue = createInlineQueue();
    const publishing = createPublishService(prisma, { queue });
    const jobs = await publishing.enqueueDueSchedules(new Date("2026-10-14T12:00:00.000Z"));
    expect(jobs.some((job) => job.postId === created.id)).toBe(true);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("queued");
    expect(queue.jobs.length).toBeGreaterThan(0);
  });

  it("lets an Owner publish a draft immediately without a separate approval click", async () => {
    const owner = await registerOwner("pub-now");
    const post = await draftWithTargets(owner, ["telegram"], "Сразу в Telegram");
    const telegram = scripted("telegram", [{ kind: "success", externalId: "42" }]);
    const publishing = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: createAdapterRegistry([telegram]),
    });

    const job = await publishing.publishNow(owner.userId, owner.workspaceId, post.id);
    const stored = await prisma.post.findUniqueOrThrow({
      where: { id: post.id },
      include: { targets: true },
    });

    expect(telegram.calls).toBe(1);
    expect(stored.status).toBe("published");
    expect(stored.targets[0]?.status).toBe("published");
    expect(job?.attempts[0]?.kind).toBe("success");
  });

  it("does not publish an empty draft immediately", async () => {
    const owner = await registerOwner("pub-now-empty");
    const post = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Пусто");
    const publishing = createPublishService(prisma, { queue: createInlineQueue() });

    await expectAccess(
      publishing.publishNow(owner.userId, owner.workspaceId, post.id),
      400,
      /Сохраните заголовок и текст/,
    );
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("draft");
  });

  it("does not let an Editor skip approval via publishNow", async () => {
    const owner = await registerOwner("pub-now-own");
    const editor = await registerOwner("pub-now-ed");
    await workspaces.addMember(owner.userId, owner.workspaceId, editor.address, "Editor");
    const post = await draftWithTargets(owner, ["telegram"], "Только Owner");
    const publishing = createPublishService(prisma, { queue: createInlineQueue() });

    await expectAccess(
      publishing.publishNow(editor.userId, owner.workspaceId, post.id),
      403,
      /Owner и Admin/,
    );
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("draft");
  });
});
