import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createAuthService } from "@/modules/auth/auth-service";
import { FIRST_SOCIAL_PLATFORM } from "@/modules/social/catalog";
import { createCollaborationService } from "@/modules/collaboration/collaboration-service";
import { createPostService } from "@/modules/posts/post-service";
import { createProjectService } from "@/modules/projects/project-service";
import { createPublishService } from "@/modules/publishing/publish-service";
import { createMediaService } from "@/modules/media/media-service";
import { createSocialService } from "@/modules/social/social-service";
import { createWorkspaceService } from "@/modules/workspaces/workspace-service";
import { prisma } from "@/server/db/prisma";
import { createInlineQueue } from "@/server/queue";
import { createTelegramAdapter } from "@/server/social/telegram-adapter";
import { createVkAdapter } from "@/server/social/vk-adapter";
import { isTelegramBotToken, type TelegramApiResult, type TelegramTransport } from "@/server/social/telegram-api";
import type { VkApiResult, VkTransport, VkWallUploadFile } from "@/server/social/vk-api";
import { createLocalStorage } from "@/server/storage/local-storage";

const auth = createAuthService(prisma, "http://localhost:3000");
const posts = createPostService(prisma);
const projects = createProjectService(prisma);
const workspaces = createWorkspaceService(prisma);
const collab = createCollaborationService(prisma);

async function approveCurrent(owner: { userId: string; workspaceId: string }, postId: string) {
  await collab.submitForApproval(owner.userId, owner.workspaceId, postId);
  await collab.approve(owner.userId, owner.workspaceId, postId);
}

const BOT_TOKEN = "123456789:AAExampleTokenForTestsAbcdefghijkl";
const VK_COMMUNITY_TOKEN = `vk1.a.${"C".repeat(80)}`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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

function scriptedVk(
  handlers: Record<string, VkApiResult<unknown> | ((params: Record<string, string | number>) => VkApiResult<unknown>)>,
): VkTransport & { methods: string[]; uploads: VkWallUploadFile[] } {
  const methods: string[] = [];
  const uploads: VkWallUploadFile[] = [];
  return {
    methods,
    uploads,
    async call(_token, method, params = {}) {
      methods.push(method);
      const handler = handlers[method];
      if (!handler) {
        return { ok: false, error_code: 3, error_msg: `unexpected ${method}` };
      }
      return typeof handler === "function" ? handler(params) : handler;
    },
    async uploadWallPhoto(_uploadUrl, file) {
      methods.push("uploadWallPhoto");
      uploads.push(file);
      return { ok: true, response: { server: 9, photo: "[uploaded-photo]", hash: "wall-hash" } };
    },
  };
}

function scriptedTelegram(
  script: Record<string, TelegramApiResult<unknown>> | ((method: string) => TelegramApiResult<unknown>),
): TelegramTransport & { calls: Array<{ method: string; token: string }> } {
  const calls: Array<{ method: string; token: string }> = [];
  return {
    calls,
    async request(token, method) {
      calls.push({ method, token });
      return typeof script === "function" ? script(method) : (script[method] ?? { ok: false, error_code: 400, description: "unexpected method" });
    },
  };
}

describe("social platform research", () => {
  it("selects Telegram Bot API as the first official integration and rejects passwords", () => {
    expect(FIRST_SOCIAL_PLATFORM).toBe("telegram");
    expect(isTelegramBotToken("not-a-password")).toBe(false);
    expect(isTelegramBotToken("vk-password-12345678")).toBe(false);
    expect(isTelegramBotToken(BOT_TOKEN)).toBe(true);
  });
});

describe("social accounts", () => {
  const previousKey = process.env.TOKEN_ENCRYPTION_KEY;
  let storageDir = "";

  beforeAll(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "stage8-social-tests";
    storageDir = await mkdtemp(path.join(os.tmpdir(), "polka-vk-media-"));
    await prisma.$connect();
  });

  afterAll(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = previousKey;
    await prisma.$disconnect();
  });

  it("creates requires_setup without a token and never asks for a social password", async () => {
    const owner = await registerOwner("soc-setup");
    const social = createSocialService(prisma, { telegram: scriptedTelegram({}) });
    await expectAccess(
      social.createRequiresSetup(owner.userId, owner.workspaceId, { platform: "telegram", password: "qwerty" }),
      400,
      /Пароль социальной сети не принимается/,
    );
    const account = await social.createRequiresSetup(owner.userId, owner.workspaceId, {
      platform: "telegram",
      projectId: owner.projectId,
    });
    expect(account.status).toBe("requires_setup");
    expect(account.hasToken).toBe(false);
    expect(JSON.stringify(account)).not.toMatch(/encryptedToken|AAExampleToken/);
  });

  it("connects a bot token without a channel and does not call getChat", async () => {
    const owner = await registerOwner("soc-bot-only");
    const transport = scriptedTelegram({
      getMe: { ok: true, result: { id: 897, is_bot: true, username: "dom_po_polochkam_bot", first_name: "ДОМ по полочкам" } },
    });
    const social = createSocialService(prisma, { telegram: transport });
    const connected = await social.connectTelegram(owner.userId, owner.workspaceId, { token: BOT_TOKEN });
    expect(connected.status).toBe("connected");
    expect(connected.displayName).toBe("@dom_po_polochkam_bot");
    expect(connected.externalId).toBe("");
    expect(connected.hasToken).toBe(true);
    expect(connected.lastError).toMatch(/нет своей ленты/);
    expect(transport.calls.map((item) => item.method)).toEqual(["getMe"]);

    const publishing = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: { get: () => createTelegramAdapter({ db: prisma, transport }) },
    });
    const post = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Без канала");
    await posts.saveDraft(owner.userId, owner.workspaceId, post.id, {
      title: "Без канала",
      body: "Текст",
      platforms: ["telegram"],
      mediaIds: [],
    });
    await approveCurrent(owner, post.id);
    const job = await publishing.enqueue(owner.userId, owner.workspaceId, post.id);
    await publishing.processJob(job.id, "worker-bot-only");
    const attempt = await prisma.publishAttempt.findFirstOrThrow({ where: { jobId: job.id } });
    expect(attempt.errorCode).toBe("telegram_no_chat");
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).not.toBe("published");
  });

  it("connects Telegram only after official getMe/getChat and encrypts the token", async () => {
    const owner = await registerOwner("soc-connect");
    const transport = scriptedTelegram({
      getMe: { ok: true, result: { id: 1, is_bot: true, username: "polka_bot", first_name: "Polka" } },
      getChat: { ok: true, result: { id: -100123, type: "channel", title: "Кухня" } },
    });
    const social = createSocialService(prisma, { telegram: transport });
    const connected = await social.connectTelegram(owner.userId, owner.workspaceId, {
      token: BOT_TOKEN,
      chatId: "@kitchen",
      projectId: owner.projectId,
    });
    expect(connected.status).toBe("connected");
    expect(connected.externalId).toBe("-100123");
    expect(connected.hasToken).toBe(true);
    expect(connected.capabilities.some((item) => item.name === "publish_text" && item.enabled)).toBe(true);
    expect(JSON.stringify(connected)).not.toContain(BOT_TOKEN);

    const stored = await prisma.socialAccount.findUniqueOrThrow({ where: { id: connected.id } });
    expect(stored.encryptedToken).toBeTruthy();
    expect(stored.encryptedToken).not.toContain(BOT_TOKEN);
    expect(transport.calls.map((item) => item.method)).toEqual(["getMe", "getChat"]);
  });

  it("does not blame the bot token when Telegram is unreachable", async () => {
    const owner = await registerOwner("soc-net");
    const social = createSocialService(prisma, {
      telegram: scriptedTelegram({
        getMe: { ok: false, error_code: 0, description: "Сеть до api.telegram.org недоступна, результат неопределён." },
      }),
    });
    await expectAccess(
      social.connectTelegram(owner.userId, owner.workspaceId, { token: BOT_TOKEN, chatId: "1" }),
      400,
      /нет сети до Telegram/,
    );
    expect(await prisma.socialAccount.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
  });

  it("does not persist a connection when Telegram rejects the token", async () => {
    const owner = await registerOwner("soc-bad-token");
    const social = createSocialService(prisma, {
      telegram: scriptedTelegram({
        getMe: { ok: false, error_code: 401, description: "Unauthorized" },
      }),
    });
    await expectAccess(
      social.connectTelegram(owner.userId, owner.workspaceId, { token: BOT_TOKEN, chatId: "1" }),
      400,
      /Unauthorized/,
    );
    expect(await prisma.socialAccount.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
  });

  it("blocks Viewer, spoofed ids, and a password-shaped token", async () => {
    const owner = await registerOwner("soc-acl");
    const other = await registerOwner("soc-other");
    const viewer = await registerOwner("soc-viewer");
    await workspaces.addMember(owner.userId, owner.workspaceId, viewer.address, "Viewer");
    const social = createSocialService(prisma, {
      telegram: scriptedTelegram({
        getMe: { ok: true, result: { id: 1, is_bot: true, username: "x" } },
        getChat: { ok: true, result: { id: 2 } },
      }),
    });
    const created = await social.createRequiresSetup(owner.userId, owner.workspaceId, { platform: "telegram" });

    await expectAccess(
      social.connectTelegram(viewer.userId, owner.workspaceId, { token: BOT_TOKEN, chatId: "2" }),
      403,
      /Недостаточно прав/,
    );
    await expectAccess(social.get(other.userId, other.workspaceId, created.id), 403, /другому рабочему пространству/);
    await expectAccess(social.list(other.userId, owner.workspaceId), 404, /не найдено/);
    await expectAccess(
      social.connectTelegram(owner.userId, owner.workspaceId, { token: "mypassword-is-not-a-token", chatId: "2" }),
      400,
      /Пароль аккаунта не принимается/,
    );
  });

  it("publishes through Telegram Bot API and maps token_expired and rate_limit without faking success", async () => {
    const owner = await registerOwner("soc-publish");
    const okTransport = scriptedTelegram({
      getMe: { ok: true, result: { id: 9, is_bot: true, username: "pub_bot" } },
      getChat: { ok: true, result: { id: 77, title: "Чат" } },
    });
    const social = createSocialService(prisma, { telegram: okTransport });
    const account = await social.connectTelegram(owner.userId, owner.workspaceId, {
      token: BOT_TOKEN,
      chatId: "77",
    });
    const post = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "В канал");
    await posts.saveDraft(owner.userId, owner.workspaceId, post.id, {
      title: "В канал",
      body: "Текст",
      platforms: ["telegram"],
      mediaIds: [],
    });
    const bound = await prisma.postTarget.findFirstOrThrow({ where: { postId: post.id } });
    expect(bound.socialAccountId).toBe(account.id);
    await approveCurrent(owner, post.id);

    const sendOk = scriptedTelegram({
      sendMessage: { ok: true, result: { message_id: 501, chat: { id: 77 } } },
    });
    const publishing = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: {
        get: () => createTelegramAdapter({ db: prisma, transport: sendOk }),
      },
    });
    const job = await publishing.enqueue(owner.userId, owner.workspaceId, post.id);
    await publishing.processJob(job.id, "worker-social");
    expect((await prisma.postTarget.findFirstOrThrow({ where: { postId: post.id } })).status).toBe("published");
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("published");

    const expiredPost = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Истёк");
    await posts.saveDraft(owner.userId, owner.workspaceId, expiredPost.id, {
      title: "Истёк",
      body: "Текст",
      platforms: ["telegram"],
      mediaIds: [],
    });
    await approveCurrent(owner, expiredPost.id);
    const expiredTransport = scriptedTelegram({
      sendMessage: { ok: false, error_code: 401, description: "Unauthorized" },
    });
    const expiredPub = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: { get: () => createTelegramAdapter({ db: prisma, transport: expiredTransport }) },
    });
    const expiredJob = await expiredPub.enqueue(owner.userId, owner.workspaceId, expiredPost.id);
    await expiredPub.processJob(expiredJob.id, "worker-social");
    expect((await prisma.publishAttempt.findFirstOrThrow({ where: { jobId: expiredJob.id } })).kind).toBe("permanent_failure");
    expect((await prisma.publishAttempt.findFirstOrThrow({ where: { jobId: expiredJob.id } })).errorCode).toBe("token_expired");
    expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: account.id } })).status).toBe("token_expired");

    const limitedPost = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Лимит");
    await posts.saveDraft(owner.userId, owner.workspaceId, limitedPost.id, {
      title: "Лимит",
      body: "Текст",
      platforms: ["telegram"],
      mediaIds: [],
    });
    await approveCurrent(owner, limitedPost.id);
    await prisma.socialAccount.update({ where: { id: account.id }, data: { status: "connected" } });
    const limited = scriptedTelegram({
      sendMessage: { ok: false, error_code: 429, description: "Too Many Requests", retry_after: 12 },
    });
    const limitedPub = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: { get: () => createTelegramAdapter({ db: prisma, transport: limited }) },
    });
    const limitedJob = await limitedPub.enqueue(owner.userId, owner.workspaceId, limitedPost.id);
    await limitedPub.processJob(limitedJob.id, "worker-social");
    const attempt = await prisma.publishAttempt.findFirstOrThrow({ where: { jobId: limitedJob.id } });
    expect(attempt.kind).toBe("temporary_failure");
    expect(attempt.errorCode).toBe("rate_limit");
  });

  it("does not fake a VK publish while the community token is missing", async () => {
    const owner = await registerOwner("soc-vk");
    const social = createSocialService(prisma);
    const vk = await social.createRequiresSetup(owner.userId, owner.workspaceId, { platform: "vk" });
    expect(vk.status).toBe("requires_setup");
    const post = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Стена");
    await posts.saveDraft(owner.userId, owner.workspaceId, post.id, {
      title: "Стена",
      body: "Текст",
      platforms: ["vk"],
      mediaIds: [],
    });
    await approveCurrent(owner, post.id);
    const publishing = createPublishService(prisma, { queue: createInlineQueue() });
    const job = await publishing.enqueue(owner.userId, owner.workspaceId, post.id);
    await publishing.processJob(job.id, "worker-vk");
    const attempt = await prisma.publishAttempt.findFirstOrThrow({ where: { jobId: job.id } });
    expect(attempt.errorCode).toBe("integration_not_configured");
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).not.toBe("published");
  });

  it("connects a community wall token and publishes through wall.post", async () => {
    const owner = await registerOwner("soc-vk-live");
    const transport = scriptedVk({
      "groups.getById": { ok: true, response: [{ id: 242155421, name: "ДОМ по полочкам", screen_name: "club242155421" }] },
      "wall.post": (params) => {
        if (!String(params.message ?? "").trim()) {
          return { ok: false, error_code: 100, error_msg: "message is empty" };
        }
        expect(params.owner_id).toBe(-242155421);
        expect(params.from_group).toBe(1);
        expect(String(params.message)).not.toMatch(/publish_media|не прикреплено/);
        expect(params.attachments).toBeUndefined();
        return { ok: true, response: { post_id: 77 } };
      },
    });
    const social = createSocialService(prisma, { vk: transport });
    await expectAccess(
      social.connectVk(owner.userId, owner.workspaceId, {
        token: VK_COMMUNITY_TOKEN,
        source: "vk.com/club242155421",
        password: "vk-password",
      }),
      400,
      /Пароль социальной сети не принимается/,
    );
    const connected = await social.connectVk(owner.userId, owner.workspaceId, {
      token: VK_COMMUNITY_TOKEN,
      source: "https://vk.com/club242155421",
    });
    expect(connected.status).toBe("connected");
    expect(connected.platform).toBe("vk");
    expect(connected.externalId).toBe("242155421");
    expect(connected.displayName).toBe("ДОМ по полочкам");
    expect(connected.capabilities.some((item) => item.name === "publish_text" && item.enabled)).toBe(true);
    expect(connected.capabilities.some((item) => item.name === "publish_media" && item.enabled)).toBe(true);
    expect(JSON.stringify(connected)).not.toContain(VK_COMMUNITY_TOKEN);

    const post = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Полки");
    await posts.saveDraft(owner.userId, owner.workspaceId, post.id, {
      title: "Полки",
      body: "Разложили специи.",
      platforms: ["vk"],
      mediaIds: [],
    });
    await approveCurrent(owner, post.id);
    const publishing = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: { get: () => createVkAdapter({ db: prisma, transport }) },
    });
    const job = await publishing.enqueue(owner.userId, owner.workspaceId, post.id);
    await publishing.processJob(job.id, "worker-vk-live");
    const stored = await prisma.post.findUniqueOrThrow({ where: { id: post.id }, include: { targets: true } });
    expect(stored.status).toBe("published");
    expect(stored.targets[0]?.externalId).toBe("77");
    expect(transport.methods.filter((method) => method === "wall.post")).toHaveLength(2);
  });

  it("uploads wall photos and attaches them to wall.post", async () => {
    const owner = await registerOwner("soc-vk-media");
    const transport = scriptedVk({
      "groups.getById": { ok: true, response: [{ id: 242155421, name: "ДОМ по полочкам", screen_name: "club242155421" }] },
      "photos.getWallUploadServer": (params) => {
        expect(params.group_id).toBe(242155421);
        return { ok: true, response: { upload_url: "https://upload.vk.test/wall" } };
      },
      "photos.saveWallPhoto": (params) => {
        expect(params.group_id).toBe(242155421);
        expect(params.photo).toBe("[uploaded-photo]");
        return { ok: true, response: [{ id: 501, owner_id: -242155421 }] };
      },
      "wall.post": (params) => {
        if (!String(params.message ?? "").trim()) {
          return { ok: false, error_code: 100, error_msg: "message is empty" };
        }
        expect(params.attachments).toBe("photo-242155421_501");
        expect(String(params.message)).toContain("Разложили специи.");
        expect(String(params.message)).not.toMatch(/не прикреплено|publish_media/);
        return { ok: true, response: { post_id: 88 } };
      },
    });
    const social = createSocialService(prisma, { vk: transport });
    await social.connectVk(owner.userId, owner.workspaceId, {
      token: VK_COMMUNITY_TOKEN,
      source: "https://vk.com/club242155421",
    });
    const media = createMediaService(prisma, createLocalStorage(storageDir));
    const asset = await media.upload(owner.userId, owner.workspaceId, {
      filename: "cover.png",
      declaredType: "image/png",
      bytes: png,
    });
    const post = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Полки");
    await posts.saveDraft(owner.userId, owner.workspaceId, post.id, {
      title: "Полки",
      body: "Разложили специи.",
      platforms: ["vk"],
      mediaIds: [asset.id],
    });
    await approveCurrent(owner, post.id);
    const publishing = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: { get: () => createVkAdapter({ db: prisma, transport, storage: createLocalStorage(storageDir) }) },
    });
    const job = await publishing.enqueue(owner.userId, owner.workspaceId, post.id);
    await publishing.processJob(job.id, "worker-vk-media");
    const stored = await prisma.post.findUniqueOrThrow({ where: { id: post.id }, include: { targets: true } });
    expect(stored.status).toBe("published");
    expect(stored.targets[0]?.externalId).toBe("88");
    expect(transport.uploads).toHaveLength(1);
    expect(transport.uploads[0]?.filename).toBe("photo.png");
    expect(transport.methods).toEqual([
      "groups.getById",
      "wall.post",
      "photos.getWallUploadServer",
      "uploadWallPhoto",
      "photos.saveWallPhoto",
      "wall.post",
    ]);
  });

  it("fails a media publish when the community key cannot upload photos", async () => {
    const owner = await registerOwner("soc-vk-nophoto");
    const transport = scriptedVk({
      "groups.getById": { ok: true, response: [{ id: 242155421, name: "ДОМ по полочкам", screen_name: "club242155421" }] },
      "photos.getWallUploadServer": { ok: false, error_code: 200, error_msg: "Access denied" },
      "wall.post": (params) => {
        if (!String(params.message ?? "").trim()) {
          return { ok: false, error_code: 100, error_msg: "message is empty" };
        }
        throw new Error("wall.post must not run after a photo upload failure");
      },
    });
    const social = createSocialService(prisma, { vk: transport });
    await social.connectVk(owner.userId, owner.workspaceId, {
      token: VK_COMMUNITY_TOKEN,
      source: "https://vk.com/club242155421",
    });
    const media = createMediaService(prisma, createLocalStorage(storageDir));
    const asset = await media.upload(owner.userId, owner.workspaceId, {
      filename: "cover.png",
      declaredType: "image/png",
      bytes: png,
    });
    const post = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Полки");
    await posts.saveDraft(owner.userId, owner.workspaceId, post.id, {
      title: "Полки",
      body: "Разложили специи.",
      platforms: ["vk"],
      mediaIds: [asset.id],
    });
    await approveCurrent(owner, post.id);
    const publishing = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: { get: () => createVkAdapter({ db: prisma, transport, storage: createLocalStorage(storageDir) }) },
    });
    const job = await publishing.enqueue(owner.userId, owner.workspaceId, post.id);
    await publishing.processJob(job.id, "worker-vk-nophoto");
    const attempt = await prisma.publishAttempt.findFirstOrThrow({ where: { jobId: job.id } });
    expect(attempt.kind).toBe("permanent_failure");
    expect(attempt.errorCode).toBe("vk_200");
    expect(attempt.errorMessage).toMatch(/Фотографии/);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).not.toBe("published");
  });

  it("rejects a VK key that cannot write the community wall", async () => {
    const owner = await registerOwner("soc-vk-no-wall");
    const transport = scriptedVk({
      "groups.getById": { ok: true, response: [{ id: 242155421, name: "ДОМ по полочкам", screen_name: "club242155421" }] },
      "wall.post": { ok: false, error_code: 214, error_msg: "Access to adding post denied" },
    });
    const social = createSocialService(prisma, { vk: transport });
    await expectAccess(
      social.connectVk(owner.userId, owner.workspaceId, {
        token: VK_COMMUNITY_TOKEN,
        source: "https://vk.com/club242155421",
      }),
      400,
      /не умеет писать на стену/,
    );
  });
});
