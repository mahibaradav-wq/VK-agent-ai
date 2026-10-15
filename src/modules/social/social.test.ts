import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createAuthService } from "@/modules/auth/auth-service";
import { FIRST_SOCIAL_PLATFORM } from "@/modules/social/catalog";
import { createPostService } from "@/modules/posts/post-service";
import { createProjectService } from "@/modules/projects/project-service";
import { createPublishService } from "@/modules/publishing/publish-service";
import { createSocialService } from "@/modules/social/social-service";
import { createWorkspaceService } from "@/modules/workspaces/workspace-service";
import { prisma } from "@/server/db/prisma";
import { createInlineQueue } from "@/server/queue";
import { createTelegramAdapter } from "@/server/social/telegram-adapter";
import { isTelegramBotToken, type TelegramApiResult, type TelegramTransport } from "@/server/social/telegram-api";

const auth = createAuthService(prisma, "http://localhost:3000");
const posts = createPostService(prisma);
const projects = createProjectService(prisma);
const workspaces = createWorkspaceService(prisma);

const BOT_TOKEN = "123456789:AAExampleTokenForTestsAbcdefghijkl";

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

  beforeAll(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "stage8-social-tests";
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

  it("does not fake a VK publish and keeps requires_setup until official VK ID exists", async () => {
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
    const publishing = createPublishService(prisma, { queue: createInlineQueue() });
    const job = await publishing.enqueue(owner.userId, owner.workspaceId, post.id);
    await publishing.processJob(job.id, "worker-vk");
    const attempt = await prisma.publishAttempt.findFirstOrThrow({ where: { jobId: job.id } });
    expect(attempt.errorCode).toBe("integration_not_configured");
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).not.toBe("published");
  });
});
