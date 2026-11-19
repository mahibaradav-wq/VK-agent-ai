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
import { createProductService } from "@/modules/products/product-service";
import { createSocialService } from "@/modules/social/social-service";
import { createWorkspaceService } from "@/modules/workspaces/workspace-service";
import { prisma } from "@/server/db/prisma";
import { createInlineQueue } from "@/server/queue";
import { createTelegramAdapter } from "@/server/social/telegram-adapter";
import { createVkAdapter } from "@/server/social/vk-adapter";
import { isTelegramBotToken, type TelegramApiResult, type TelegramTransport } from "@/server/social/telegram-api";
import type { VkApiResult, VkTransport, VkWallUploadFile } from "@/server/social/vk-api";
import { encodeSlideshowMp4 } from "@/modules/ai/video-encode";
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
const VK_PHOTO_USER_TOKEN = `vk1.a.${"P".repeat(80)}`;
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
    async uploadAlbumPhoto(_uploadUrl, file) {
      methods.push("uploadAlbumPhoto");
      uploads.push(file);
      return { ok: true, response: { server: 11, photos_list: "[album-photos]", hash: "album-hash" } };
    },
    async uploadDocument(_uploadUrl, file) {
      methods.push("uploadDocument");
      uploads.push(file);
      return { ok: true, response: { file: "[uploaded-doc]" } };
    },
    async uploadVideo(_uploadUrl, file) {
      methods.push("uploadVideo");
      uploads.push(file);
      return { ok: true, response: { video_id: 77, owner_id: -242155421 } };
    },
  };
}

function scriptedTelegram(
  script: Record<string, TelegramApiResult<unknown>> | ((method: string) => TelegramApiResult<unknown>),
): TelegramTransport & {
  calls: Array<{ method: string; token: string; body?: Record<string, unknown>; fileName?: string; fileCount?: number }>;
} {
  const calls: Array<{ method: string; token: string; body?: Record<string, unknown>; fileName?: string; fileCount?: number }> = [];
  return {
    calls,
    async request(token, method, body, file) {
      const files = file ? (Array.isArray(file) ? file : [file]) : [];
      calls.push({ method, token, body, fileName: files[0]?.filename, fileCount: files.length });
      if (typeof script === "function") {
        return script(method);
      }
      if (method === "getChatMember" && script.getChatMember === undefined) {
        return { ok: true, result: { status: "administrator" } };
      }
      return script[method] ?? { ok: false, error_code: 400, description: "unexpected method" };
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
    expect(transport.calls.map((item) => item.method)).toEqual(["getMe", "getChat", "getChatMember"]);
  });

  it("binds t.me/dom_po_polochkam to an existing bot without a new token", async () => {
    const owner = await registerOwner("soc-bind-channel");
    const transport = scriptedTelegram({
      getMe: { ok: true, result: { id: 897, is_bot: true, username: "dom_po_polochkam_bot" } },
      getChat: { ok: true, result: { id: -1004392473566, type: "channel", title: "ДОМ по полочкам", username: "dom_po_polochkam" } },
    });
    const social = createSocialService(prisma, { telegram: transport });
    const connected = await social.connectTelegram(owner.userId, owner.workspaceId, { token: BOT_TOKEN });
    expect(connected.externalId).toBe("");

    const bound = await social.bindTelegramChannel(owner.userId, owner.workspaceId, {
      accountId: connected.id,
      chatId: "https://t.me/dom_po_polochkam",
      projectId: owner.projectId,
    });
    expect(bound.externalId).toBe("-1004392473566");
    expect(bound.displayName).toBe("ДОМ по полочкам");
    expect(bound.projectName).toBe(`Проект soc-bind-channel`);
    expect(bound.capabilities.some((item) => item.name === "publish_media" && item.enabled)).toBe(true);
    expect(transport.calls.map((item) => item.method)).toEqual(["getMe", "getMe", "getChat", "getChatMember"]);
    expect(transport.calls.find((item) => item.method === "getChat")?.body).toEqual({ chat_id: "@dom_po_polochkam" });
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
      sendPhoto: { ok: true, result: { message_id: 502, chat: { id: 77 } } },
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

  it("does not auto-retry Telegram after a partial long-text send", async () => {
    const owner = await registerOwner("soc-tg-partial");
    const connect = scriptedTelegram({
      getMe: { ok: true, result: { id: 9, is_bot: true, username: "pub_bot" } },
      getChat: { ok: true, result: { id: 77, title: "Чат" } },
    });
    const social = createSocialService(prisma, { telegram: connect });
    const account = await social.connectTelegram(owner.userId, owner.workspaceId, {
      token: BOT_TOKEN,
      chatId: "77",
    });
    const post = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Длинный");
    await posts.saveDraft(owner.userId, owner.workspaceId, post.id, {
      title: "Длинный",
      body: "А".repeat(4200),
      platforms: ["telegram"],
      mediaIds: [],
    });
    await approveCurrent(owner, post.id);
    let messages = 0;
    const transport = scriptedTelegram((method) => {
      if (method === "getChatMember") {
        return { ok: true, result: { status: "administrator" } };
      }
      if (method === "sendMessage") {
        messages += 1;
        if (messages === 1) {
          return { ok: true, result: { message_id: 11, chat: { id: 77 } } };
        }
        return { ok: false, error_code: 429, description: "Too Many Requests", retry_after: 12 };
      }
      return { ok: false, error_code: 400, description: `unexpected ${method}` };
    });
    const publishing = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: { get: () => createTelegramAdapter({ db: prisma, transport }) },
    });
    const job = await publishing.enqueue(owner.userId, owner.workspaceId, post.id);
    await publishing.processJob(job.id, "worker-tg-partial");
    const attempt = await prisma.publishAttempt.findFirstOrThrow({ where: { jobId: job.id } });
    expect(attempt.kind).toBe("unknown");
    expect(attempt.errorCode).toBe("telegram_partial");
    expect((await prisma.postTarget.findFirstOrThrow({ where: { postId: post.id } })).status).toBe(
      "requires_manual_check",
    );
    expect(account.id).toBeTruthy();
    expect(messages).toBe(2);
  });

  it("publishes a photo to the bound Telegram channel", async () => {
    const owner = await registerOwner("soc-tg-photo");
    const transport = scriptedTelegram({
      getMe: { ok: true, result: { id: 9, is_bot: true, username: "pub_bot" } },
      getChat: { ok: true, result: { id: -1004392473566, type: "channel", title: "ДОМ по полочкам" } },
      sendPhoto: { ok: true, result: { message_id: 88, chat: { id: -1004392473566 } } },
    });
    const social = createSocialService(prisma, { telegram: transport });
    await social.connectTelegram(owner.userId, owner.workspaceId, {
      token: BOT_TOKEN,
      chatId: "https://t.me/dom_po_polochkam",
      projectId: owner.projectId,
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
      platforms: ["telegram"],
      mediaIds: [asset.id],
    });
    await approveCurrent(owner, post.id);
    const publishing = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: {
        get: () => createTelegramAdapter({ db: prisma, transport, storage: createLocalStorage(storageDir) }),
      },
    });
    const job = await publishing.enqueue(owner.userId, owner.workspaceId, post.id);
    await publishing.processJob(job.id, "worker-tg-photo");
    const stored = await prisma.post.findUniqueOrThrow({ where: { id: post.id }, include: { targets: true } });
    expect(stored.status).toBe("published");
    expect(stored.targets[0]?.externalId).toBe("88");
    const photo = transport.calls.find((item) => item.method === "sendPhoto");
    expect(photo?.body).toMatchObject({ chat_id: "-1004392473566" });
    expect(String(photo?.body?.caption)).toContain("Разложили специи.");
    expect(photo?.fileName).toBe("photo.jpg");
    expect(transport.calls.some((item) => item.method === "sendMessage")).toBe(false);
  });

  it("publishes a long Telegram photo as one sendPhoto with a finished caption", async () => {
    const owner = await registerOwner("soc-tg-long-photo");
    const transport = scriptedTelegram({
      getMe: { ok: true, result: { id: 9, is_bot: true, username: "pub_bot" } },
      getChat: { ok: true, result: { id: -1004392473566, type: "channel", title: "ДОМ по полочкам" } },
      sendPhoto: { ok: true, result: { message_id: 88, chat: { id: -1004392473566 } } },
    });
    const social = createSocialService(prisma, { telegram: transport });
    await social.connectTelegram(owner.userId, owner.workspaceId, {
      token: BOT_TOKEN,
      chatId: "https://t.me/dom_po_polochkam",
      projectId: owner.projectId,
    });
    const media = createMediaService(prisma, createLocalStorage(storageDir));
    const asset = await media.upload(owner.userId, owner.workspaceId, {
      filename: "cover.png",
      declaredType: "image/png",
      bytes: png,
    });
    const body = "Стол с ящиками. ".repeat(80);
    const post = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Длинный стол");
    await posts.saveDraft(owner.userId, owner.workspaceId, post.id, {
      title: "Длинный стол",
      body,
      platforms: ["telegram"],
      mediaIds: [asset.id],
    });
    await approveCurrent(owner, post.id);
    const publishing = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: {
        get: () => createTelegramAdapter({ db: prisma, transport, storage: createLocalStorage(storageDir) }),
      },
    });
    const job = await publishing.enqueue(owner.userId, owner.workspaceId, post.id);
    await publishing.processJob(job.id, "worker-tg-long-photo");
    const photo = transport.calls.find((item) => item.method === "sendPhoto");
    expect(String(photo?.body?.caption)).toContain("Длинный стол");
    expect(String(photo?.body?.caption).length).toBeLessThanOrEqual(1024);
    expect(transport.calls.some((item) => item.method === "sendMessage")).toBe(false);
    expect(transport.calls.map((item) => item.method).filter((item) => item === "sendMessage" || item === "sendPhoto")).toEqual([
      "sendPhoto",
    ]);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("published");
  });

  it("publishes an MP4 to Telegram with sendVideo", async () => {
    const owner = await registerOwner("soc-tg-video");
    const transport = scriptedTelegram({
      getMe: { ok: true, result: { id: 9, is_bot: true, username: "pub_bot" } },
      getChat: { ok: true, result: { id: -1004392473566, type: "channel", title: "ДОМ по полочкам" } },
      sendVideo: { ok: true, result: { message_id: 91, chat: { id: -1004392473566 } } },
    });
    const social = createSocialService(prisma, { telegram: transport });
    await social.connectTelegram(owner.userId, owner.workspaceId, {
      token: BOT_TOKEN,
      chatId: "https://t.me/dom_po_polochkam",
      projectId: owner.projectId,
    });
    const mp4 = await encodeSlideshowMp4({ frames: [png, png], seconds: 4, aspect: "9:16" });
    const media = createMediaService(prisma, createLocalStorage(storageDir));
    const asset = await media.upload(owner.userId, owner.workspaceId, {
      filename: "clip.mp4",
      declaredType: "video/mp4",
      bytes: mp4,
    });
    const post = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Ролик");
    await posts.saveDraft(owner.userId, owner.workspaceId, post.id, {
      title: "Ролик",
      body: "Как сложить банки.",
      platforms: ["telegram"],
      mediaIds: [asset.id],
    });
    await approveCurrent(owner, post.id);
    const publishing = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: {
        get: () => createTelegramAdapter({ db: prisma, transport, storage: createLocalStorage(storageDir) }),
      },
    });
    const job = await publishing.enqueue(owner.userId, owner.workspaceId, post.id);
    await publishing.processJob(job.id, "worker-tg-video");
    const video = transport.calls.find((item) => item.method === "sendVideo");
    expect(video?.fileName).toBe("video.mp4");
    expect(String(video?.body?.caption)).toContain("Как сложить банки.");
    expect(transport.calls.some((item) => item.method === "sendPhoto")).toBe(false);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("published");
  });

  it("publishes a Telegram album when the post has several photos", async () => {
    const owner = await registerOwner("soc-tg-album");
    const transport = scriptedTelegram({
      getMe: { ok: true, result: { id: 9, is_bot: true, username: "pub_bot" } },
      getChat: { ok: true, result: { id: -1004392473566, type: "channel", title: "ДОМ по полочкам" } },
      sendMediaGroup: {
        ok: true,
        result: [
          { message_id: 201, chat: { id: -1004392473566 } },
          { message_id: 202, chat: { id: -1004392473566 } },
        ],
      },
    });
    const social = createSocialService(prisma, { telegram: transport });
    await social.connectTelegram(owner.userId, owner.workspaceId, {
      token: BOT_TOKEN,
      chatId: "https://t.me/dom_po_polochkam",
      projectId: owner.projectId,
    });
    const media = createMediaService(prisma, createLocalStorage(storageDir));
    const first = await media.upload(owner.userId, owner.workspaceId, {
      filename: "one.png",
      declaredType: "image/png",
      bytes: png,
    });
    const second = await media.upload(owner.userId, owner.workspaceId, {
      filename: "two.png",
      declaredType: "image/png",
      bytes: png,
    });
    const post = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Карусель");
    await posts.saveDraft(owner.userId, owner.workspaceId, post.id, {
      title: "Карусель",
      body: "Три полки подряд.",
      platforms: ["telegram"],
      mediaIds: [first.id, second.id],
    });
    await approveCurrent(owner, post.id);
    const publishing = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: {
        get: () => createTelegramAdapter({ db: prisma, transport, storage: createLocalStorage(storageDir) }),
      },
    });
    const job = await publishing.enqueue(owner.userId, owner.workspaceId, post.id);
    await publishing.processJob(job.id, "worker-tg-album");
    const stored = await prisma.post.findUniqueOrThrow({ where: { id: post.id }, include: { targets: true } });
    expect(stored.status).toBe("published");
    expect(stored.targets[0]?.externalId).toBe("201");
    const album = transport.calls.find((item) => item.method === "sendMediaGroup");
    expect(album?.fileCount).toBe(2);
    expect(String(album?.body?.media)).toContain("attach://photo0");
    expect(String(album?.body?.media)).toContain("Три полки подряд.");
    expect(transport.calls.some((item) => item.method === "sendPhoto")).toBe(false);
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
    expect(connected.capabilities.some((item) => item.name === "publish_carousel" && item.enabled)).toBe(false);
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

  it("attaches a VK market item for a shop post and falls back to a text link", async () => {
    const owner = await registerOwner("soc-vk-market");
    const transport = scriptedVk({
      "groups.getById": { ok: true, response: [{ id: 242155421, name: "ДОМ по полочкам", screen_name: "club242155421" }] },
      "market.add": { ok: true, response: { market_item_id: 91 } },
      "wall.post": (params) => {
        if (!String(params.message ?? "").trim()) {
          return { ok: false, error_code: 100, error_msg: "message is empty" };
        }
        expect(String(params.attachments)).toContain("market-242155421_91");
        expect(String(params.message)).not.toContain("https://www.ozon.ru/product/korob-1/");
        return { ok: true, response: { post_id: 88 } };
      },
    });
    const social = createSocialService(prisma, { vk: transport });
    await social.connectVk(owner.userId, owner.workspaceId, {
      token: VK_COMMUNITY_TOKEN,
      source: "https://vk.com/club242155421",
    });
    const products = createProductService(prisma);
    const product = await products.addFromUrl(
      owner.userId,
      owner.workspaceId,
      owner.projectId,
      "https://www.ozon.ru/product/korob-1/",
    );
    const post = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Короб");
    await posts.saveDraft(owner.userId, owner.workspaceId, post.id, {
      title: "Короб",
      body: "Для кухни.",
      platforms: ["vk"],
      mediaIds: [],
    });
    await products.attachToPost(owner.userId, owner.workspaceId, product.id, post.id);
    await approveCurrent(owner, post.id);
    const publishing = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: { get: () => createVkAdapter({ db: prisma, transport }) },
    });
    const job = await publishing.enqueue(owner.userId, owner.workspaceId, post.id);
    await publishing.processJob(job.id, "worker-vk-market");
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("published");

    const fallback = scriptedVk({
      "groups.getById": { ok: true, response: [{ id: 242155421, name: "ДОМ по полочкам", screen_name: "club242155421" }] },
      "market.add": { ok: false, error_code: 1403, error_msg: "Market is not enabled" },
      "wall.post": (params) => {
        if (!String(params.message ?? "").trim()) {
          return { ok: false, error_code: 100, error_msg: "message is empty" };
        }
        expect(params.attachments).toBeUndefined();
        expect(String(params.message)).toContain("https://www.ozon.ru/product/korob-1/");
        return { ok: true, response: { post_id: 89 } };
      },
    });
    const socialB = createSocialService(prisma, { vk: fallback });
    const ownerB = await registerOwner("soc-vk-market-fb");
    await socialB.connectVk(ownerB.userId, ownerB.workspaceId, {
      token: VK_COMMUNITY_TOKEN,
      source: "https://vk.com/club242155421",
    });
    const productB = await createProductService(prisma).addFromUrl(
      ownerB.userId,
      ownerB.workspaceId,
      ownerB.projectId,
      "https://www.ozon.ru/product/korob-1/",
    );
    const postB = await posts.create(ownerB.userId, ownerB.workspaceId, ownerB.projectId, "Короб");
    await posts.saveDraft(ownerB.userId, ownerB.workspaceId, postB.id, {
      title: "Короб",
      body: "Для кухни.",
      platforms: ["vk"],
      mediaIds: [],
    });
    await createProductService(prisma).attachToPost(ownerB.userId, ownerB.workspaceId, productB.id, postB.id);
    await approveCurrent(ownerB, postB.id);
    const publishingB = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: { get: () => createVkAdapter({ db: prisma, transport: fallback }) },
    });
    const jobB = await publishingB.enqueue(ownerB.userId, ownerB.workspaceId, postB.id);
    await publishingB.processJob(jobB.id, "worker-vk-market-fb");
    expect((await prisma.post.findUniqueOrThrow({ where: { id: postB.id } })).status).toBe("published");
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
    expect(transport.uploads[0]?.filename).toBe("slide-1.jpg");
    expect(transport.methods).toEqual([
      "groups.getById",
      "wall.post",
      "photos.getWallUploadServer",
      "uploadWallPhoto",
      "photos.saveWallPhoto",
      "wall.post",
    ]);
  });

  it("uploads a video and attaches it to wall.post", async () => {
    const owner = await registerOwner("soc-vk-video");
    const transport = scriptedVk({
      "groups.getById": { ok: true, response: [{ id: 242155421, name: "ДОМ по полочкам", screen_name: "club242155421" }] },
      "video.save": (params) => {
        expect(params.group_id).toBe(242155421);
        return {
          ok: true,
          response: { upload_url: "https://upload.vk.test/video", vid: 77, owner_id: -242155421 },
        };
      },
      "wall.post": (params) => {
        if (!String(params.message ?? "").trim()) {
          return { ok: false, error_code: 100, error_msg: "message is empty" };
        }
        expect(params.attachments).toBe("video-242155421_77");
        return { ok: true, response: { post_id: 21 } };
      },
    });
    const social = createSocialService(prisma, { vk: transport });
    await social.connectVk(owner.userId, owner.workspaceId, {
      token: VK_COMMUNITY_TOKEN,
      source: "https://vk.com/club242155421",
    });
    const mp4 = await encodeSlideshowMp4({ frames: [png, png], seconds: 4, aspect: "9:16" });
    const media = createMediaService(prisma, createLocalStorage(storageDir));
    const asset = await media.upload(owner.userId, owner.workspaceId, {
      filename: "clip.mp4",
      declaredType: "video/mp4",
      bytes: mp4,
    });
    const post = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Ролик");
    await posts.saveDraft(owner.userId, owner.workspaceId, post.id, {
      title: "Ролик",
      body: "Как сложить банки.",
      platforms: ["vk"],
      mediaIds: [asset.id],
    });
    await approveCurrent(owner, post.id);
    const publishing = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: { get: () => createVkAdapter({ db: prisma, transport, storage: createLocalStorage(storageDir) }) },
    });
    const job = await publishing.enqueue(owner.userId, owner.workspaceId, post.id);
    await publishing.processJob(job.id, "worker-vk-video");
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("published");
    expect(transport.methods).toContain("video.save");
    expect(transport.methods).toContain("uploadVideo");
    expect(transport.uploads[0]?.filename).toBe("video.mp4");
  });

  it("asks VK for a fresh wall upload URL for every carousel photo", async () => {
    const owner = await registerOwner("soc-vk-carousel");
    let saved = 0;
    const transport = scriptedVk({
      "groups.getById": { ok: true, response: [{ id: 242155421, name: "ДОМ по полочкам", screen_name: "club242155421" }] },
      "photos.getWallUploadServer": () => ({
        ok: true,
        response: { upload_url: `https://upload.vk.test/wall-${saved + 1}` },
      }),
      "photos.saveWallPhoto": () => {
        saved += 1;
        return { ok: true, response: [{ id: 600 + saved, owner_id: -242155421 }] };
      },
      "wall.post": (params) => {
        if (!String(params.message ?? "").trim()) {
          return { ok: false, error_code: 100, error_msg: "message is empty" };
        }
        expect(String(params.attachments)).toBe("photo-242155421_601,photo-242155421_602,photo-242155421_603");
        return { ok: true, response: { post_id: 91 } };
      },
    });
    const social = createSocialService(prisma, { vk: transport });
    await social.connectVk(owner.userId, owner.workspaceId, {
      token: VK_COMMUNITY_TOKEN,
      source: "https://vk.com/club242155421",
    });
    const media = createMediaService(prisma, createLocalStorage(storageDir));
    const assets = [];
    for (let index = 0; index < 3; index += 1) {
      assets.push(
        await media.upload(owner.userId, owner.workspaceId, {
          filename: `slide-${index + 1}.png`,
          declaredType: "image/png",
          bytes: png,
        }),
      );
    }
    const post = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Карусель");
    await posts.saveDraft(owner.userId, owner.workspaceId, post.id, {
      title: "Карусель",
      body: "Семь карточек в посте.",
      platforms: ["vk"],
      mediaIds: assets.map((asset) => asset.id),
    });
    await approveCurrent(owner, post.id);
    const publishing = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: { get: () => createVkAdapter({ db: prisma, transport, storage: createLocalStorage(storageDir) }) },
    });
    const job = await publishing.publishNow(owner.userId, owner.workspaceId, post.id);
    expect(job.status).toBe("completed");
    expect(transport.methods.filter((method) => method === "photos.getWallUploadServer")).toHaveLength(3);
    expect(transport.uploads).toHaveLength(3);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("published");
  });

  it("uploads a carousel with the admin user key when the community key cannot", async () => {
    const owner = await registerOwner("soc-vk-photo-user");
    let saved = 0;
    const transport = scriptedVk({
      "groups.getById": { ok: true, response: [{ id: 242155421, name: "ДОМ по полочкам", screen_name: "club242155421" }] },
      "photos.getWallUploadServer": () => ({
        ok: true,
        response: { upload_url: `https://upload.vk.test/user-${saved + 1}` },
      }),
      "photos.saveWallPhoto": () => {
        saved += 1;
        return { ok: true, response: [{ id: 900 + saved, owner_id: -242155421 }] };
      },
      "wall.post": (params) => {
        if (!String(params.message ?? "").trim()) {
          return { ok: false, error_code: 100, error_msg: "message is empty" };
        }
        expect(String(params.attachments)).toBe("photo-242155421_901,photo-242155421_902");
        expect(String(params.message)).not.toMatch(/\*\*/);
        return { ok: true, response: { post_id: 95 } };
      },
    });
    const social = createSocialService(prisma, { vk: transport });
    const connected = await social.connectVk(owner.userId, owner.workspaceId, {
      token: VK_COMMUNITY_TOKEN,
      photoToken: VK_PHOTO_USER_TOKEN,
      source: "https://vk.com/club242155421",
    });
    expect(connected.capabilities.some((item) => item.name === "publish_carousel" && item.enabled)).toBe(true);
    const media = createMediaService(prisma, createLocalStorage(storageDir));
    const assets = [];
    for (let index = 0; index < 2; index += 1) {
      assets.push(
        await media.upload(owner.userId, owner.workspaceId, {
          filename: `slide-${index + 1}.png`,
          declaredType: "image/png",
          bytes: png,
        }),
      );
    }
    const post = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Карусель");
    await posts.saveDraft(owner.userId, owner.workspaceId, post.id, {
      title: "**Карусель**",
      body: "Слайды **жирным** не для стены.",
      platforms: ["vk"],
      mediaIds: assets.map((asset) => asset.id),
    });
    await approveCurrent(owner, post.id);
    const publishing = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: { get: () => createVkAdapter({ db: prisma, transport, storage: createLocalStorage(storageDir) }) },
    });
    const job = await publishing.publishNow(owner.userId, owner.workspaceId, post.id);
    expect(job.status).toBe("completed");
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("published");
  });

  it("attaches carousel images from a community album when wall photo upload is blocked", async () => {
    const owner = await registerOwner("soc-vk-album");
    let saved = 0;
    const transport = scriptedVk({
      "groups.getById": { ok: true, response: [{ id: 242155421, name: "ДОМ по полочкам", screen_name: "club242155421" }] },
      "photos.getWallUploadServer": {
        ok: false,
        error_code: 27,
        error_msg: "Group authorization failed: method is unavailable with group auth.",
      },
      "photos.getAlbums": { ok: true, response: { count: 1, items: [{ id: 77, title: "Polka Social" }] } },
      "photos.getUploadServer": () => ({
        ok: true,
        response: { upload_url: `https://upload.vk.test/album-${saved + 1}` },
      }),
      "photos.save": () => {
        saved += 1;
        return { ok: true, response: [{ id: 800 + saved, owner_id: -242155421 }] };
      },
      "wall.post": (params) => {
        if (!String(params.message ?? "").trim()) {
          return { ok: false, error_code: 100, error_msg: "message is empty" };
        }
        expect(String(params.attachments)).toBe("photo-242155421_801,photo-242155421_802");
        return { ok: true, response: { post_id: 93 } };
      },
    });
    const social = createSocialService(prisma, { vk: transport });
    await social.connectVk(owner.userId, owner.workspaceId, {
      token: VK_COMMUNITY_TOKEN,
      source: "https://vk.com/club242155421",
    });
    const media = createMediaService(prisma, createLocalStorage(storageDir));
    const assets = [];
    for (let index = 0; index < 2; index += 1) {
      assets.push(
        await media.upload(owner.userId, owner.workspaceId, {
          filename: `slide-${index + 1}.png`,
          declaredType: "image/png",
          bytes: png,
        }),
      );
    }
    const post = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Карусель");
    await posts.saveDraft(owner.userId, owner.workspaceId, post.id, {
      title: "Карусель",
      body: "Картинки через альбом сообщества.",
      platforms: ["vk"],
      mediaIds: assets.map((asset) => asset.id),
    });
    await approveCurrent(owner, post.id);
    const publishing = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: { get: () => createVkAdapter({ db: prisma, transport, storage: createLocalStorage(storageDir) }) },
    });
    const job = await publishing.publishNow(owner.userId, owner.workspaceId, post.id);
    expect(job.status).toBe("completed");
    expect(transport.methods.filter((method) => method === "photos.getUploadServer")).toHaveLength(2);
    expect(transport.methods.filter((method) => method === "uploadAlbumPhoto")).toHaveLength(2);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("published");
  });

  it("attaches one JPEG document when the community key cannot upload a native photo carousel", async () => {
    const owner = await registerOwner("soc-vk-docs");
    const transport = scriptedVk({
      "groups.getById": { ok: true, response: [{ id: 242155421, name: "ДОМ по полочкам", screen_name: "club242155421" }] },
      "photos.getWallUploadServer": {
        ok: false,
        error_code: 27,
        error_msg: "Group authorization failed: method is unavailable with group auth.",
      },
      "photos.getAlbums": {
        ok: false,
        error_code: 27,
        error_msg: "Group authorization failed: method is unavailable with group auth.",
      },
      "photos.createAlbum": {
        ok: false,
        error_code: 27,
        error_msg: "Group authorization failed: method is unavailable with group auth.",
      },
      "docs.getWallUploadServer": { ok: true, response: { upload_url: "https://upload.vk.test/doc-1" } },
      "docs.save": { ok: true, response: { type: "doc", doc: { id: 701, owner_id: -242155421 } } },
      "wall.post": (params) => {
        if (!String(params.message ?? "").trim()) {
          return { ok: false, error_code: 100, error_msg: "message is empty" };
        }
        expect(String(params.attachments)).toBe("doc-242155421_701");
        return { ok: true, response: { post_id: 99 } };
      },
    });
    const social = createSocialService(prisma, { vk: transport });
    await social.connectVk(owner.userId, owner.workspaceId, {
      token: VK_COMMUNITY_TOKEN,
      source: "https://vk.com/club242155421",
    });
    const media = createMediaService(prisma, createLocalStorage(storageDir));
    const assets = [];
    for (let index = 0; index < 2; index += 1) {
      assets.push(
        await media.upload(owner.userId, owner.workspaceId, {
          filename: `slide-${index + 1}.png`,
          declaredType: "image/png",
          bytes: png,
        }),
      );
    }
    const post = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Карусель");
    await posts.saveDraft(owner.userId, owner.workspaceId, post.id, {
      title: "Карусель",
      body: "Картинки через документы стены.",
      platforms: ["vk"],
      mediaIds: assets.map((asset) => asset.id),
    });
    await approveCurrent(owner, post.id);
    const publishing = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: { get: () => createVkAdapter({ db: prisma, transport, storage: createLocalStorage(storageDir) }) },
    });
    const job = await publishing.publishNow(owner.userId, owner.workspaceId, post.id);
    expect(job.status).toBe("completed");
    const attempt = await prisma.publishAttempt.findFirstOrThrow({ where: { jobId: job.id } });
    expect(attempt.kind).toBe("success");
    expect(attempt.externalId).toBe("99");
    expect(transport.methods).toContain("wall.post");
    expect(transport.methods).toContain("docs.getWallUploadServer");
    expect(transport.uploads[0]?.filename).toBe("slide-1.jpg");
  });

  it("attaches a single image as a titled wall document when photo upload is blocked", async () => {
    const owner = await registerOwner("soc-vk-onedoc");
    const transport = scriptedVk({
      "groups.getById": { ok: true, response: [{ id: 242155421, name: "ДОМ по полочкам", screen_name: "club242155421" }] },
      "photos.getWallUploadServer": {
        ok: false,
        error_code: 27,
        error_msg: "Group authorization failed: method is unavailable with group auth.",
      },
      "photos.getAlbums": {
        ok: false,
        error_code: 27,
        error_msg: "Group authorization failed: method is unavailable with group auth.",
      },
      "photos.createAlbum": {
        ok: false,
        error_code: 27,
        error_msg: "Group authorization failed: method is unavailable with group auth.",
      },
      "docs.getWallUploadServer": { ok: true, response: { upload_url: "https://upload.vk.test/doc-1" } },
      "docs.save": { ok: true, response: { type: "doc", doc: { id: 701, owner_id: -242155421 } } },
      "wall.post": (params) => {
        if (!String(params.message ?? "").trim()) {
          return { ok: false, error_code: 100, error_msg: "message is empty" };
        }
        expect(String(params.attachments)).toBe("doc-242155421_701");
        expect(String(params.message)).toContain("Одна картинка");
        return { ok: true, response: { post_id: 94 } };
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
    const post = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Одна картинка");
    await posts.saveDraft(owner.userId, owner.workspaceId, post.id, {
      title: "Одна картинка",
      body: "Без карусели.",
      platforms: ["vk"],
      mediaIds: [asset.id],
    });
    await approveCurrent(owner, post.id);
    const publishing = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: { get: () => createVkAdapter({ db: prisma, transport, storage: createLocalStorage(storageDir) }) },
    });
    const job = await publishing.publishNow(owner.userId, owner.workspaceId, post.id);
    expect(job.status).toBe("completed");
  });

  it("does not publish a VK text-only post when the community key cannot attach the picture", async () => {
    const owner = await registerOwner("soc-vk-nopic");
    const transport = scriptedVk({
      "groups.getById": { ok: true, response: [{ id: 242155421, name: "ДОМ по полочкам", screen_name: "club242155421" }] },
      "photos.getWallUploadServer": {
        ok: false,
        error_code: 27,
        error_msg: "Group authorization failed: method is unavailable with group auth.",
      },
      "photos.getAlbums": {
        ok: false,
        error_code: 27,
        error_msg: "Group authorization failed: method is unavailable with group auth.",
      },
      "photos.createAlbum": {
        ok: false,
        error_code: 27,
        error_msg: "Group authorization failed: method is unavailable with group auth.",
      },
      "docs.getWallUploadServer": { ok: false, error_code: 15, error_msg: "Access denied: no access to call this method" },
      "wall.post": (params) => {
        if (!String(params.message ?? "").trim()) {
          return { ok: false, error_code: 100, error_msg: "message is empty" };
        }
        throw new Error("wall.post must not run without a picture");
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
    const post = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Без картинки");
    await posts.saveDraft(owner.userId, owner.workspaceId, post.id, {
      title: "Без картинки",
      body: "Текст без визуала недопустим.",
      platforms: ["vk"],
      mediaIds: [asset.id],
    });
    await approveCurrent(owner, post.id);
    const publishing = createPublishService(prisma, {
      queue: createInlineQueue(),
      adapters: { get: () => createVkAdapter({ db: prisma, transport, storage: createLocalStorage(storageDir) }) },
    });
    const job = await publishing.enqueue(owner.userId, owner.workspaceId, post.id);
    await publishing.processJob(job.id, "worker-vk-nopic");
    const attempt = await prisma.publishAttempt.findFirstOrThrow({ where: { jobId: job.id } });
    expect(attempt.kind).toBe("permanent_failure");
    expect(attempt.errorCode).toMatch(/vk_/);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).not.toBe("published");
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
