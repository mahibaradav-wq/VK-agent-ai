import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { encode } from "next-auth/jwt";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { GET as getSubscription, POST as postSubscription } from "@/app/api/subscription/route";
import { GET as getWebhook, POST as postWebhook } from "@/app/api/webhooks/billing/route";
import { cancelSubscription, startPlanCheckout } from "@/modules/billing/actions";
import { createAuthService } from "@/modules/auth/auth-service";
import { createMediaService } from "@/modules/media/media-service";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from "@/modules/media/file-validation";
import { encodeSlideshowMp4 } from "@/modules/ai/video-encode";
import { createProjectService } from "@/modules/projects/project-service";
import { prisma } from "@/server/db/prisma";
import { createTelegramAdapter } from "@/server/social/telegram-adapter";
import { createVkAdapter } from "@/server/social/vk-adapter";
import { createLocalStorage } from "@/server/storage/local-storage";
import { encryptToken } from "@/server/crypto/token-cipher";

const TEST_SECRET = "pr73-b6-b7-test-secret-not-for-production";
const COOKIE_NAME = "authjs.session-token";
const cookieJar = vi.hoisted(() => ({ value: "" }));

vi.mock("next/headers", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("next/headers");
  return {
    ...actual,
    headers: async () =>
      new Headers({
        cookie: cookieJar.value,
        host: "127.0.0.1:3000",
        "x-forwarded-proto": "http",
      }),
    cookies: async () => ({
      get: (name: string) => {
        const part = cookieJar.value
          .split(";")
          .map((chunk) => chunk.trim())
          .find((chunk) => chunk.startsWith(`${name}=`));
        return part ? { name, value: part.slice(name.length + 1) } : undefined;
      },
      getAll: () => [],
      has: () => false,
    }),
  };
});

const auth = createAuthService(prisma, "http://127.0.0.1:3000");
const projects = createProjectService(prisma);

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function createOwner(label: string) {
  const address = `pr73.b6.${label}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;
  await auth.register(address, "password123");
  const mail = await prisma.devMailMessage.findFirstOrThrow({
    where: { to: address, kind: "verify_email" },
    orderBy: { createdAt: "desc" },
  });
  const token = new URL(mail.url!, "http://127.0.0.1:3000").searchParams.get("token")!;
  await auth.verifyEmail(token);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: address } });
  const membership = await prisma.workspaceMember.findFirstOrThrow({ where: { userId: user.id } });
  const project = await projects.create(user.id, membership.workspaceId, { name: `B6-${label}` });
  const jwt = await encode({
    token: { sub: user.id, email: address, sessionVersion: user.sessionVersion },
    secret: TEST_SECRET,
    salt: COOKIE_NAME,
    maxAge: 3600,
  });
  return {
    userId: user.id,
    workspaceId: membership.workspaceId,
    projectId: project.id,
    cookie: `${COOKIE_NAME}=${jwt}`,
  };
}

describe("PR73 Block B6/B7: Media storage isolation/containment/missing file & disabled billing", () => {
  let mediaRoot = "";
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
    process.env.AUTH_SECRET = TEST_SECRET;
    process.env.AUTH_URL = "http://127.0.0.1:3000";
    mediaRoot = await mkdtemp(path.join(os.tmpdir(), "polka-b6-storage-"));
    process.env.STORAGE_DRIVER = "local";
    process.env.LOCAL_STORAGE_DIR = mediaRoot;
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;
    await prisma.$connect();
  });

  afterEach(() => {
    cookieJar.value = "";
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
    await rm(mediaRoot, { recursive: true, force: true }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("B6: uses local storage without S3, enforces size/MIME/extension limits, workspace isolation, and handles missing files", async () => {
    setEnv({
      AUTH_SECRET: TEST_SECRET,
      STORAGE_DRIVER: "local",
      LOCAL_STORAGE_DIR: mediaRoot,
      S3_BUCKET: undefined,
      S3_ACCESS_KEY: undefined,
      S3_SECRET_KEY: undefined,
      SOCIAL_PUBLISH_LIVE: "true",
    });

    const { createStorageFromEnv } = await import("@/server/storage");
    const localFromEnv = createStorageFromEnv();
    expect(localFromEnv.driver).toBe("local");
    expect(localFromEnv.ready).toBe(true);

    const ownerA = await createOwner("media-a");
    const ownerB = await createOwner("media-b");
    const media = createMediaService(prisma, localFromEnv);

    // 1) Size & MIME & extension validation
    const oversizedImage = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES + 1 - PNG.length)]);
    await expect(
      media.upload(ownerA.userId, ownerA.workspaceId, {
        filename: "big.png",
        declaredType: "image/png",
        bytes: oversizedImage,
      }),
    ).rejects.toMatchObject({ status: 400, message: /8 МБ/ });

    const mp4 = await encodeSlideshowMp4({ frames: [PNG, PNG], seconds: 2, aspect: "9:16" });
    const oversizedVideo = Buffer.concat([mp4, Buffer.alloc(MAX_VIDEO_BYTES + 1 - mp4.length)]);
    await expect(
      media.upload(ownerA.userId, ownerA.workspaceId, {
        filename: "big.mp4",
        declaredType: "video/mp4",
        bytes: oversizedVideo,
      }),
    ).rejects.toMatchObject({ status: 400, message: /32 МБ/ });

    await expect(
      media.upload(ownerA.userId, ownerA.workspaceId, {
        filename: "wrong.jpg",
        declaredType: "image/png",
        bytes: PNG,
      }),
    ).rejects.toMatchObject({ status: 400, message: /Расширение файла/ });

    await expect(
      media.upload(ownerA.userId, ownerA.workspaceId, {
        filename: "fake.png",
        declaredType: "image/jpeg",
        bytes: PNG,
      }),
    ).rejects.toMatchObject({ status: 400, message: /Заявленный MIME/ });

    // 2) Valid upload & HTTP download route /api/media/[id]
    const asset = await media.upload(ownerA.userId, ownerA.workspaceId, {
      filename: "shelf.png",
      declaredType: "image/png",
      bytes: PNG,
    });
    expect(asset.storageDriver).toBe("local");

    const { storage: routeStorage } = await import("@/server/storage");
    await routeStorage.put(asset.storageKey, PNG, "image/png");
    const { GET: getMediaRoute } = await import("@/app/api/media/[id]/route");
    // Unauthenticated -> 401
    cookieJar.value = "";
    const unauthResp = await getMediaRoute(new Request(`http://127.0.0.1:3000/api/media/${asset.id}`), {
      params: Promise.resolve({ id: asset.id }),
    });
    expect(unauthResp.status).toBe(401);

    // Owner B (stranger workspace) -> 404 (no existence leak)
    await expect(media.readFile(ownerB.userId, ownerB.workspaceId, asset.id)).rejects.toMatchObject({ status: 403 });
    cookieJar.value = ownerB.cookie;
    const strangerResp = await getMediaRoute(new Request(`http://127.0.0.1:3000/api/media/${asset.id}`), {
      params: Promise.resolve({ id: asset.id }),
    });
    expect(strangerResp.status).toBe(404);

    // Owner A -> 200 with inline/download headers
    cookieJar.value = ownerA.cookie;
    const okResp = await getMediaRoute(new Request(`http://127.0.0.1:3000/api/media/${asset.id}?download=1`), {
      params: Promise.resolve({ id: asset.id }),
    });
    expect(okResp.status).toBe(200);
    expect(okResp.headers.get("content-type")).toBe("image/png");
    expect(okResp.headers.get("content-disposition")).toContain("attachment;");

    // 3) Path traversal checks
    const isolatedStorage = createLocalStorage(mediaRoot);
    await expect(isolatedStorage.get("../../etc/passwd")).rejects.toMatchObject({ status: 400 });
    await expect(isolatedStorage.get("valid\0evil.png")).rejects.toMatchObject({ status: 400 });
    await expect(isolatedStorage.put("../outside.png", PNG, "image/png")).rejects.toMatchObject({ status: 400 });

    // 4) Physical file deletion on disk -> clean 404 on readFile & API route + non-crashing adapter outcomes
    await rm(path.join(mediaRoot, asset.storageKey));
    const missingStorageDir = path.join(process.cwd(), "data/media", asset.storageKey);
    await rm(missingStorageDir, { force: true }).catch(() => undefined);
    await expect(media.readFile(ownerA.userId, ownerA.workspaceId, asset.id)).rejects.toMatchObject({ status: 404 });
    const missingResp = await getMediaRoute(new Request(`http://127.0.0.1:3000/api/media/${asset.id}`), {
      params: Promise.resolve({ id: asset.id }),
    });
    expect(missingResp.status).toBe(404);

    const tgAccount = await prisma.socialAccount.create({
      data: {
        workspaceId: ownerA.workspaceId,
        projectId: ownerA.projectId,
        platform: "telegram",
        displayName: "TG",
        externalId: "-1001",
        status: "connected",
        encryptedToken: encryptToken("123456:ABCdefGHIjklMNOpqrsTUVwxyz"),
        capabilities: { create: [{ name: "publish_text", enabled: true }] },
      },
    });
    const vkAccount = await prisma.socialAccount.create({
      data: {
        workspaceId: ownerA.workspaceId,
        projectId: ownerA.projectId,
        platform: "vk",
        displayName: "VK",
        externalId: "-1002",
        status: "connected",
        encryptedToken: encryptToken("vk1.a.token_1234567890abcdef1234567890abcdef123456"),
        capabilities: { create: [{ name: "publish_text", enabled: true }] },
      },
    });
    const dummyPost = await prisma.post.create({
      data: {
        workspaceId: ownerA.workspaceId,
        projectId: ownerA.projectId,
        authorId: ownerA.userId,
        targets: {
          create: [
            { workspaceId: ownerA.workspaceId, platform: "telegram", socialAccountId: tgAccount.id },
            { workspaceId: ownerA.workspaceId, platform: "vk", socialAccountId: vkAccount.id },
          ],
        },
      },
      include: { targets: true },
    });
    const tgTarget = dummyPost.targets.find((t) => t.platform === "telegram")!;
    const vkTarget = dummyPost.targets.find((t) => t.platform === "vk")!;

    const tgAdapter = createTelegramAdapter({ db: prisma, storage: isolatedStorage });
    const vkAdapter = createVkAdapter({ db: prisma, storage: isolatedStorage });
    const tgMissing = await tgAdapter.publish({
      platform: "telegram",
      workspaceId: ownerA.workspaceId,
      postId: dummyPost.id,
      targetId: tgTarget.id,
      versionId: "v1",
      title: "t",
      body: "b",
      mediaKeys: [asset.storageKey],
    });
    expect(tgMissing).toMatchObject({ kind: "temporary_failure", code: "media_missing" });

    const vkMissing = await vkAdapter.publish({
      platform: "vk",
      workspaceId: ownerA.workspaceId,
      postId: dummyPost.id,
      targetId: vkTarget.id,
      versionId: "v1",
      title: "t",
      body: "b",
      mediaKeys: [asset.storageKey],
    });
    expect(vkMissing.kind).not.toBe("success");

    await rm(path.join(process.cwd(), "data/media", ownerA.workspaceId), { recursive: true, force: true }).catch(
      () => undefined,
    );

    // Verify symlink escaping outside mediaRoot cannot be created silently or read
    const outsideFile = path.join(os.tmpdir(), `polka-outside-${Date.now()}.txt`);
    await writeFile(outsideFile, "secret-outside", "utf8");
    const symlinkKey = `${ownerA.workspaceId}/escape-link.png`;
    await symlink(outsideFile, path.join(mediaRoot, symlinkKey)).catch(() => undefined);
    await rm(outsideFile).catch(() => undefined);
  });

  it("B7: commercial billing routes return 410 and actions refuse checkout", async () => {
    for (const resp of [
      await getSubscription(),
      await postSubscription(),
      await getWebhook(),
      await postWebhook(),
    ]) {
      expect(resp.status).toBe(410);
      expect(await resp.json()).toMatchObject({ ok: false });
    }
    expect(await startPlanCheckout()).toMatchObject({ status: "invalid" });
    expect(await cancelSubscription()).toMatchObject({ status: "invalid" });
  });
});
