import http from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createAuthService } from "@/modules/auth/auth-service";
import { createCalendarService } from "@/modules/calendar/calendar-service";
import { createCollaborationService } from "@/modules/collaboration/collaboration-service";
import { createPostService } from "@/modules/posts/post-service";
import { createProjectService } from "@/modules/projects/project-service";
import { createPublishService } from "@/modules/publishing/publish-service";
import { prisma } from "@/server/db/prisma";
import { encryptToken } from "@/server/crypto/token-cipher";
import { createInlineQueue } from "@/server/queue";
import { isSocialPublishLiveEnabled, socialPublishLiveBlockedOutcome } from "@/server/social/publish-live-guard";
import { createTelegramTransport } from "@/server/social/telegram-api";
import { createVkTransport } from "@/server/social/vk-api";

const auth = createAuthService(prisma, "http://localhost:3000");
const projects = createProjectService(prisma);
const posts = createPostService(prisma);
const calendar = createCalendarService(prisma);
const collab = createCollaborationService(prisma);

const envStore = process.env as Record<string, string | undefined>;
const ENV_KEYS = [
  "NODE_ENV",
  "SOCIAL_PUBLISH_LIVE",
  "POLKA_REQUIRE_PROD_SECRETS",
  "VK_API_BASE_URL",
  "TELEGRAM_API_BASE_URL",
  "TOKEN_ENCRYPTION_KEY",
  "AUTH_SECRET",
] as const;

const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  savedEnv[key] = envStore[key];
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete envStore[key];
    } else {
      envStore[key] = savedEnv[key];
    }
  }
}

async function setupConnectedWorkspace(tag: string) {
  const email = `live-guard.${tag}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;
  await auth.register(email, "password123");
  const mail = await prisma.devMailMessage.findFirstOrThrow({
    where: { to: email, kind: "verify_email" },
    orderBy: { createdAt: "desc" },
  });
  const token = new URL(mail.url ?? "", "http://localhost:3000").searchParams.get("token") ?? "";
  await auth.verifyEmail(token);

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    include: { memberships: true },
  });
  const workspaceId = user.memberships[0]!.workspaceId;
  const project = await projects.create(user.id, workspaceId, { name: `Проект ${tag}` });

  envStore.AUTH_SECRET = envStore.AUTH_SECRET || "test-auth-secret-material-at-least-32-chars";
  envStore.TOKEN_ENCRYPTION_KEY = "test-token-encryption-key-material-32-chars";

  await prisma.socialAccount.create({
    data: {
      workspaceId,
      projectId: project.id,
      platform: "vk",
      displayName: "VK Test Club",
      externalId: "242155421",
      encryptedToken: encryptToken("vk1.a.test-community-token-for-guard-tests-0000000000000000000000"),
      status: "connected",
      capabilities: { create: [{ name: "publish_text", enabled: true }] },
    },
  });

  await prisma.socialAccount.create({
    data: {
      workspaceId,
      projectId: project.id,
      platform: "telegram",
      displayName: "TG Test Channel",
      externalId: "-1001234567890",
      encryptedToken: encryptToken("123456:test_bot_token_abcdefghijklmnopqrstuvwxyz"),
      status: "connected",
      capabilities: { create: [{ name: "publish_text", enabled: true }] },
    },
  });

  return { userId: user.id, workspaceId, projectId: project.id };
}

describe("social publish live guard", () => {
  let spyHits: string[] = [];
  let spyServer: http.Server;
  let spyBaseUrl = "";

  beforeAll(async () => {
    await prisma.$connect();
    spyServer = http.createServer((req, res) => {
      spyHits.push(`${req.method ?? "GET"} ${req.url ?? "/"}`);
      res.setHeader("content-type", "application/json");
      if ((req.url ?? "").includes("/method/wall.post")) {
        res.end(JSON.stringify({ response: { post_id: 999 } }));
        return;
      }
      if ((req.url ?? "").includes("/sendMessage")) {
        res.end(JSON.stringify({ ok: true, result: { message_id: 555, chat: { id: -1001234567890 } } }));
        return;
      }
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error_code: 500, description: "unexpected spy call" }));
    });
    await new Promise<void>((resolve) => {
      spyServer.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = spyServer.address();
    if (!addr || typeof addr === "string") {
      throw new Error("Failed to bind local spy HTTP server");
    }
    spyBaseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      spyServer.close((err) => (err ? reject(err) : resolve()));
    });
    await prisma.$disconnect();
  });

  afterEach(() => {
    spyHits = [];
    restoreEnv();
  });

  it.each(["production", "development", "test"] as const)(
    "blocks live publishing by default and allows only strict SOCIAL_PUBLISH_LIVE=true in NODE_ENV=%s",
    (nodeEnv) => {
      envStore.NODE_ENV = nodeEnv;
      for (const prodSecrets of [undefined, "false", "true"]) {
        if (prodSecrets === undefined) {
          delete envStore.POLKA_REQUIRE_PROD_SECRETS;
        } else {
          envStore.POLKA_REQUIRE_PROD_SECRETS = prodSecrets;
        }

        delete envStore.SOCIAL_PUBLISH_LIVE;
        expect(isSocialPublishLiveEnabled()).toBe(false);

        for (const nonTrue of ["", "false", "0", "1", "TRUE", "True", "yes", "true "]) {
          envStore.SOCIAL_PUBLISH_LIVE = nonTrue;
          expect(isSocialPublishLiveEnabled()).toBe(false);
        }

        envStore.SOCIAL_PUBLISH_LIVE = "true";
        expect(isSocialPublishLiveEnabled()).toBe(true);
      }
    },
  );

  it("blocks direct default-transport publish calls without hitting network when SOCIAL_PUBLISH_LIVE is not true", async () => {
    envStore.VK_API_BASE_URL = spyBaseUrl;
    envStore.TELEGRAM_API_BASE_URL = spyBaseUrl;
    delete envStore.SOCIAL_PUBLISH_LIVE;

    const vk = createVkTransport();
    const tg = createTelegramTransport();

    const vkCall = await vk.call("vk1.a.fake", "wall.post", { owner_id: -1, message: "hi" });
    expect(vkCall).toMatchObject({ ok: false, error_code: 403 });

    const vkUpload = await vk.uploadWallPhoto!(`${spyBaseUrl}/upload`, {
      filename: "a.jpg",
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/jpeg",
    });
    expect(vkUpload).toMatchObject({ ok: false, error_code: 403 });

    const tgMsg = await tg.request("123:abc", "sendMessage", { chat_id: -100, text: "hi" });
    expect(tgMsg).toMatchObject({ ok: false, error_code: 403 });

    envStore.SOCIAL_PUBLISH_LIVE = "TRUE";
    const tgPhoto = await tg.request("123:abc", "sendPhoto", { chat_id: -100, caption: "hi" });
    expect(tgPhoto).toMatchObject({ ok: false, error_code: 403 });

    expect(spyHits).toEqual([]);
  });

  it.each(["production", "development", "test"] as const)(
    "blocks manual, scheduled, worker, and retry publish paths in NODE_ENV=%s when SOCIAL_PUBLISH_LIVE is not true",
    async (nodeEnv) => {
      envStore.NODE_ENV = nodeEnv;
      envStore.VK_API_BASE_URL = spyBaseUrl;
      envStore.TELEGRAM_API_BASE_URL = spyBaseUrl;
      delete envStore.SOCIAL_PUBLISH_LIVE;

      const owner = await setupConnectedWorkspace(`paths-${nodeEnv}`);
      const publishing = createPublishService(prisma, { queue: createInlineQueue() });

      // 1. Ручной путь (publishNow)
      const manualPost = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Ручной пост");
      await posts.saveDraft(owner.userId, owner.workspaceId, manualPost.id, {
        title: "Ручной пост",
        body: "Текст для ручной отправки",
        platforms: ["vk", "telegram"],
        mediaIds: [],
      });
      const manualJob = await publishing.publishNow(owner.userId, owner.workspaceId, manualPost.id);
      expect(manualJob.status).toBe("failed");
      const manualStored = await prisma.post.findUniqueOrThrow({
        where: { id: manualPost.id },
        include: { targets: true },
      });
      expect(manualStored.status).toBe("failed");
      expect(manualStored.targets.every((t) => t.status === "failed" && t.lastError?.includes("social_publish_disabled"))).toBe(true);

      // 2. Отложенный путь + 3. Worker путь (schedule -> enqueueDueSchedules -> processDueJobs)
      const schedPost = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Отложенный пост");
      await posts.saveDraft(owner.userId, owner.workspaceId, schedPost.id, {
        title: "Отложенный пост",
        body: "Текст для отложенной отправки",
        platforms: ["vk", "telegram"],
        mediaIds: [],
      });
      await collab.submitForApproval(owner.userId, owner.workspaceId, schedPost.id);
      await collab.approve(owner.userId, owner.workspaceId, schedPost.id);
      await calendar.schedule(owner.userId, owner.workspaceId, schedPost.id, {
        localDateTime: "2026-01-01T12:00",
        timezone: "Europe/Moscow",
      });

      const dueJobs = await publishing.enqueueDueSchedules(new Date("2026-10-22T12:00:00.000Z"), owner.workspaceId);
      expect(dueJobs.some((j) => j.postId === schedPost.id)).toBe(true);
      await publishing.processDueJobs("test-worker", new Date("2026-10-22T12:00:01.000Z"));

      const schedStored = await prisma.post.findUniqueOrThrow({
        where: { id: schedPost.id },
        include: { targets: true },
      });
      expect(schedStored.status).toBe("failed");
      expect(schedStored.targets.every((t) => t.status === "failed" && t.lastError?.includes("social_publish_disabled"))).toBe(true);

      // 4. Retry путь (нестрогое SOCIAL_PUBLISH_LIVE="TRUE" также должно блокировать и не ставить auto-retry)
      envStore.SOCIAL_PUBLISH_LIVE = "TRUE";
      const retriedJob = await publishing.enqueue(owner.userId, owner.workspaceId, schedPost.id);
      await publishing.processJob(retriedJob.id, "test-worker-retry");
      const retryStored = await prisma.publishJob.findUniqueOrThrow({ where: { id: retriedJob.id } });
      expect(retryStored.status).toBe("failed");
      expect(retryStored.nextAttemptAt).toBeNull();

      expect(spyHits).toEqual([]);
    },
  );

  it("allows publishing to configured API root only when SOCIAL_PUBLISH_LIVE is strictly 'true'", async () => {
    envStore.NODE_ENV = "test";
    envStore.VK_API_BASE_URL = spyBaseUrl;
    envStore.TELEGRAM_API_BASE_URL = spyBaseUrl;
    envStore.SOCIAL_PUBLISH_LIVE = "true";

    const owner = await setupConnectedWorkspace("strict-true");
    const publishing = createPublishService(prisma, { queue: createInlineQueue() });
    const post = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Явный opt-in");
    await posts.saveDraft(owner.userId, owner.workspaceId, post.id, {
      title: "Явный opt-in",
      body: "Доходит до локального spy-сервера только при === 'true'",
      platforms: ["vk", "telegram"],
      mediaIds: [],
    });

    const job = await publishing.publishNow(owner.userId, owner.workspaceId, post.id);
    expect(job.status).toBe("completed");
    expect(spyHits).toContain("POST /method/wall.post");
    expect(spyHits.some((hit) => hit.endsWith("/sendMessage"))).toBe(true);
  });

  it("returns a permanent failure outcome when blocked", () => {
    expect(socialPublishLiveBlockedOutcome()).toMatchObject({
      kind: "permanent_failure",
      code: "social_publish_disabled",
    });
  });
});
