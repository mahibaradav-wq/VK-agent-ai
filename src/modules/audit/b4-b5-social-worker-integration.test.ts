import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createAuthService } from "@/modules/auth/auth-service";
import { createCalendarService } from "@/modules/calendar/calendar-service";
import { createCollaborationService } from "@/modules/collaboration/collaboration-service";
import { createPostService } from "@/modules/posts/post-service";
import { createProjectService } from "@/modules/projects/project-service";
import { createPublishService } from "@/modules/publishing/publish-service";
import { encryptToken } from "@/server/crypto/token-cipher";
import { prisma } from "@/server/db/prisma";
import { createInlineQueue, createQueueFromEnv } from "@/server/queue";
import { createTelegramAdapter } from "@/server/social/telegram-adapter";
import { createVkAdapter } from "@/server/social/vk-adapter";
import { createLocalStorage } from "@/server/storage/local-storage";

const auth = createAuthService(prisma, "http://127.0.0.1:3000");
const projects = createProjectService(prisma);
const posts = createPostService(prisma);
const calendar = createCalendarService(prisma);
const collab = createCollaborationService(prisma);

async function createOwner(label: string) {
  const address = `pr73.b4.${label}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;
  await auth.register(address, "password123");
  const mail = await prisma.devMailMessage.findFirstOrThrow({
    where: { to: address, kind: "verify_email" },
    orderBy: { createdAt: "desc" },
  });
  const token = new URL(mail.url!, "http://127.0.0.1:3000").searchParams.get("token")!;
  await auth.verifyEmail(token);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: address } });
  const membership = await prisma.workspaceMember.findFirstOrThrow({ where: { userId: user.id } });
  const project = await projects.create(user.id, membership.workspaceId, { name: `B4-${label}` });
  return { userId: user.id, workspaceId: membership.workspaceId, projectId: project.id };
}

async function seedConnectedSocials(
  workspaceId: string,
  projectId: string | null,
  options?: { corruptTokens?: boolean },
) {
  const tgToken = options?.corruptTokens ? "not-valid-encrypted-token" : encryptToken("123456:ABCdefGHIjklMNOpqrsTUVwxyz");
  const vkToken = options?.corruptTokens ? "not-valid-encrypted-token" : encryptToken("vk1.a.spy_community_token_1234567890abcdef1234567890");
  await prisma.socialAccount.create({
    data: {
      workspaceId,
      projectId,
      platform: "telegram",
      displayName: "Spy TG",
      externalId: "-1001234567890",
      status: "connected",
      encryptedToken: tgToken,
      capabilities: { create: [{ name: "publish_text", enabled: true }] },
    },
  });
  await prisma.socialAccount.create({
    data: {
      workspaceId,
      projectId,
      platform: "vk",
      displayName: "Spy VK",
      externalId: "-987654321",
      status: "connected",
      encryptedToken: vkToken,
      capabilities: { create: [{ name: "publish_text", enabled: true }] },
    },
  });
}

describe("PR73 Block B4/B5: VK & Telegram local HTTP spy + Queue & Worker lifecycle", () => {
  let spyServer: Server;
  let spyOrigin = "";
  let tgRequests: Array<{ url: string; body: string }> = [];
  let vkRequests: Array<{ url: string; body: string }> = [];
  let tgBehavior: "ok" | "temp_502" | "perm_403" | "drop_socket" = "ok";
  let vkBehavior: "ok" | "temp_502" | "perm_15" | "drop_socket" = "ok";
  let onTgHit: (() => Promise<void> | void) | null = null;
  let storageDir = "";

  const savedEnv: Record<string, string | undefined> = {};
  function setEnv(vars: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(vars)) {
      if (!(k in savedEnv)) {
        savedEnv[k] = process.env[k];
      }
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }

  beforeAll(async () => {
    await prisma.$connect();
    storageDir = await mkdtemp(path.join(os.tmpdir(), "polka-b4-media-"));
    spyServer = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks).toString("utf8");
      const url = req.url ?? "";

      if (url.startsWith("/bot")) {
        tgRequests.push({ url, body });
        if (onTgHit) {
          await onTgHit();
        }
        if (tgBehavior === "drop_socket") {
          res.socket?.destroy();
          return;
        }
        if (tgBehavior === "temp_502") {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error_code: 502, description: "Bad Gateway" }));
          return;
        }
        if (tgBehavior === "perm_403") {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot kicked" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, result: { message_id: 700 + tgRequests.length } }));
        return;
      }

      if (url.startsWith("/method/")) {
        vkRequests.push({ url, body });
        if (vkBehavior === "drop_socket") {
          res.socket?.destroy();
          return;
        }
        if (vkBehavior === "temp_502") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { error_code: 10, error_msg: "Internal server error" } }));
          return;
        }
        if (vkBehavior === "perm_15") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { error_code: 15, error_msg: "Access denied" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ response: { post_id: 900 + vkRequests.length } }));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => spyServer.listen(0, "127.0.0.1", resolve));
    spyOrigin = `http://127.0.0.1:${(spyServer.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    tgRequests = [];
    vkRequests = [];
    tgBehavior = "ok";
    vkBehavior = "ok";
    onTgHit = null;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
      delete savedEnv[k];
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => spyServer.close(() => resolve()));
    await rm(storageDir, { recursive: true, force: true }).catch(() => undefined);
    await prisma.$disconnect();
  });

  function realAdapters() {
    const storage = createLocalStorage(storageDir);
    const tg = createTelegramAdapter({ db: prisma, storage });
    const vk = createVkAdapter({ db: prisma, storage });
    return {
      get(platform: string) {
        if (platform === "telegram") return tg;
        if (platform === "vk") return vk;
        throw new Error(`Unsupported test platform: ${platform}`);
      },
    };
  }

  it("B4: blocks network & skips token decryption unless SOCIAL_PUBLISH_LIVE === 'true', and refuses global fallback token", async () => {
    const owner = await createOwner("guard");
    setEnv({
      AUTH_SECRET: "pr73-cipher-secret-not-for-production",
      VK_API_BASE_URL: spyOrigin,
      TELEGRAM_API_BASE_URL: spyOrigin,
    });

    // Global workspace-level account (projectId: null) must NOT be used as fallback
    await seedConnectedSocials(owner.workspaceId, null);
    const post = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Пост без привязки");
    await posts.saveDraft(owner.userId, owner.workspaceId, post.id, {
      title: "Пост без привязки",
      body: "Текст",
      platforms: ["telegram", "vk"],
      mediaIds: [],
    });

    setEnv({ SOCIAL_PUBLISH_LIVE: "true" });
    const publishing = createPublishService(prisma, { queue: createInlineQueue(), adapters: realAdapters() });
    const noFallbackJob = await publishing.publishNow(owner.userId, owner.workspaceId, post.id);
    expect(noFallbackJob.status).toBe("failed");
    expect(tgRequests).toHaveLength(0);
    expect(vkRequests).toHaveLength(0);

    // Now bind project accounts with corrupted tokens — must block BEFORE decryptToken when SOCIAL_PUBLISH_LIVE !== "true"
    const p2 = await projects.create(owner.userId, owner.workspaceId, { name: "Guard Project" });
    await seedConnectedSocials(owner.workspaceId, p2.id, { corruptTokens: true });
    const post2 = await posts.create(owner.userId, owner.workspaceId, p2.id, "Проверка live guard");
    await posts.saveDraft(owner.userId, owner.workspaceId, post2.id, {
      title: "Проверка live guard",
      body: "Текст",
      platforms: ["telegram", "vk"],
      mediaIds: [],
    });

    for (const flag of [undefined, "false", "1", "TRUE", "yes"]) {
      setEnv({ SOCIAL_PUBLISH_LIVE: flag });
      const postLoop = await posts.create(owner.userId, owner.workspaceId, p2.id, `Guard ${flag ?? "unset"}`);
      await posts.saveDraft(owner.userId, owner.workspaceId, postLoop.id, {
        title: `Guard ${flag ?? "unset"}`,
        body: "Текст",
        platforms: ["telegram", "vk"],
        mediaIds: [],
      });
      const job = await publishing.publishNow(owner.userId, owner.workspaceId, postLoop.id);
      expect(job.status).toBe("failed");
      expect(tgRequests).toHaveLength(0);
      expect(vkRequests).toHaveLength(0);
      const targets = await prisma.postTarget.findMany({ where: { postId: postLoop.id } });
      expect(targets.every((t) => t.lastError?.includes("social_publish_disabled") && !t.lastError.includes("расшифровать"))).toBe(true);
    }
  });

  it("B4 & B5: manual/scheduled publish, retries, permanent stop, unknown socket drop, no blind resend, concurrent lock, and mid-publish archive", async () => {
    const owner = await createOwner("spy-live");
    setEnv({
      AUTH_SECRET: "pr73-cipher-secret-not-for-production",
      VK_API_BASE_URL: spyOrigin,
      TELEGRAM_API_BASE_URL: spyOrigin,
      SOCIAL_PUBLISH_LIVE: "true",
    });

    await seedConnectedSocials(owner.workspaceId, owner.projectId);
    const queue = createInlineQueue();
    const publishing = createPublishService(prisma, { queue, adapters: realAdapters() });

    // 1) Manual publish via spy servers
    const p1 = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Ручная публикация");
    await posts.saveDraft(owner.userId, owner.workspaceId, p1.id, {
      title: "Ручная публикация",
      body: "Текст для обоих каналов",
      platforms: ["telegram", "vk"],
      mediaIds: [],
    });
    const manualJob = await publishing.publishNow(owner.userId, owner.workspaceId, p1.id);
    expect(manualJob.status).toBe("completed");
    expect(tgRequests).toHaveLength(1);
    expect(vkRequests).toHaveLength(1);

    // 2) Scheduled publish -> temporary failure -> retry -> success
    tgRequests = [];
    vkRequests = [];
    const p2 = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Отложенный retry");
    await posts.saveDraft(owner.userId, owner.workspaceId, p2.id, {
      title: "Отложенный retry",
      body: "Пост по расписанию",
      platforms: ["telegram", "vk"],
      mediaIds: [],
    });
    await collab.submitForApproval(owner.userId, owner.workspaceId, p2.id);
    await collab.approve(owner.userId, owner.workspaceId, p2.id, "Готово к расписанию");
    await calendar.schedule(owner.userId, owner.workspaceId, p2.id, {
      localDateTime: "2026-01-01T10:00",
      timezone: "Europe/Moscow",
    });
    const scheduledJobs = await publishing.enqueueDueSchedules(new Date("2026-02-01T00:00:00Z"));
    const schedJob = scheduledJobs.find((j) => j.postId === p2.id)!;
    expect(schedJob).toBeTruthy();

    tgBehavior = "temp_502";
    vkBehavior = "perm_15";
    await publishing.processJob(schedJob.id, "worker-1");
    let afterFirst = await prisma.publishJob.findUniqueOrThrow({ where: { id: schedJob.id } });
    expect(afterFirst.status).toBe("pending"); // temporary TG keeps job pending for retry

    // Second attempt: TG succeeds, VK was already permanent_failure so VK is NOT retried!
    tgBehavior = "ok";
    await prisma.publishJob.update({ where: { id: schedJob.id }, data: { nextAttemptAt: new Date(0) } });
    await publishing.processJob(schedJob.id, "worker-1");
    afterFirst = await prisma.publishJob.findUniqueOrThrow({ where: { id: schedJob.id } });
    expect(afterFirst.status).toBe("failed");
    expect(tgRequests).toHaveLength(2);
    expect(vkRequests).toHaveLength(1);

    // 3) Unknown network drop -> requires_manual_check & NO blind resend
    tgRequests = [];
    vkRequests = [];
    const p3 = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Неизвестный обрыв");
    await posts.saveDraft(owner.userId, owner.workspaceId, p3.id, {
      title: "Неизвестный обрыв",
      body: "Текст при обрыве",
      platforms: ["telegram"],
      mediaIds: [],
    });
    tgBehavior = "drop_socket";
    const unknownJob = await publishing.publishNow(owner.userId, owner.workspaceId, p3.id);
    expect(unknownJob.status).toBe("requires_manual_check");
    expect(tgRequests).toHaveLength(1);
    await expect(publishing.enqueue(owner.userId, owner.workspaceId, p3.id)).rejects.toMatchObject({ status: 400 });
    expect(tgRequests).toHaveLength(1);

    // 4) Concurrent worker claim lock + idempotency
    tgRequests = [];
    tgBehavior = "ok";
    const p4 = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Конкурентный worker");
    await posts.saveDraft(owner.userId, owner.workspaceId, p4.id, {
      title: "Конкурентный worker",
      body: "Один раз",
      platforms: ["telegram"],
      mediaIds: [],
    });
    await collab.submitForApproval(owner.userId, owner.workspaceId, p4.id);
    await collab.approve(owner.userId, owner.workspaceId, p4.id, "Одобрено");
    const enq4 = await publishing.enqueue(owner.userId, owner.workspaceId, p4.id);
    const [rA, rB] = await Promise.all([
      publishing.processJob(enq4.id, "worker-a"),
      publishing.processJob(enq4.id, "worker-b"),
    ]);
    expect([rA.skipped, rB.skipped].sort()).toEqual([false, true]);
    expect(tgRequests).toHaveLength(1);

    // 5) Worker restart recovery: stale processing job parked without blind resend
    const p5 = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Зависший worker");
    await posts.saveDraft(owner.userId, owner.workspaceId, p5.id, {
      title: "Зависший worker",
      body: "После рестарта",
      platforms: ["telegram"],
      mediaIds: [],
    });
    await collab.submitForApproval(owner.userId, owner.workspaceId, p5.id);
    await collab.approve(owner.userId, owner.workspaceId, p5.id, "Одобрено");
    const enq5 = await publishing.enqueue(owner.userId, owner.workspaceId, p5.id);
    await prisma.publishJob.update({
      where: { id: enq5.id },
      data: { status: "processing", claimedAt: new Date(Date.now() - 10 * 60_000), claimedBy: "crashed-worker" },
    });
    await prisma.postTarget.updateMany({ where: { postId: p5.id }, data: { status: "publishing" } });
    tgRequests = [];
    await publishing.processDueJobs("restarted-worker");
    expect(tgRequests).toHaveLength(0);
    const parked = await prisma.publishJob.findUniqueOrThrow({ where: { id: enq5.id } });
    expect(parked.status).toBe("requires_manual_check");

    // 6) Archiving project mid-publish stops further targets
    tgRequests = [];
    vkRequests = [];
    const p6 = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Архивация в процессе");
    await posts.saveDraft(owner.userId, owner.workspaceId, p6.id, {
      title: "Архивация в процессе",
      body: "Остановить VK",
      platforms: ["telegram", "vk"],
      mediaIds: [],
    });
    onTgHit = async () => {
      await prisma.project.update({ where: { id: owner.projectId }, data: { archivedAt: new Date() } });
    };
    const archiveJob = await publishing.publishNow(owner.userId, owner.workspaceId, p6.id);
    expect(archiveJob.status).toBe("completed");
    expect(tgRequests).toHaveLength(1);
    expect(vkRequests).toHaveLength(0);
  });

  it("B5: unconfigured queue refuses enqueue when QUEUE_DRIVER=redis without REDIS_URL", async () => {
    setEnv({ QUEUE_DRIVER: "redis", REDIS_URL: "" });
    const queue = createQueueFromEnv();
    expect(queue.driver).toBe("unconfigured");
    expect(queue.ready).toBe(false);
    await expect(queue.addPublishJob("job-1")).rejects.toMatchObject({ status: 400 });
  });
});
