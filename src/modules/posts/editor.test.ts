import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createAuthService } from "@/modules/auth/auth-service";
import { createMediaService } from "@/modules/media/media-service";
import { createPostService } from "@/modules/posts/post-service";
import { createProjectService } from "@/modules/projects/project-service";
import { prisma } from "@/server/db/prisma";
import { createLocalStorage } from "@/server/storage/local-storage";
import { createUnconfiguredStorage } from "@/server/storage/s3-storage";

const auth = createAuthService(prisma, "http://localhost:3000");
const posts = createPostService(prisma);
const projects = createProjectService(prisma);
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

describe("post editor and media library", () => {
  let storageDir = "";

  beforeAll(async () => {
    await prisma.$connect();
    storageDir = await mkdtemp(path.join(os.tmpdir(), "polka-media-"));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("saves a draft, versions content, and invalidates approval", async () => {
    const owner = await registerOwner("post-draft");
    const created = await posts.create(owner.userId, owner.workspaceId, owner.projectId, "Первый заголовок");
    const first = await posts.saveDraft(owner.userId, owner.workspaceId, created.id, {
      title: "Кухня весной",
      body: "Текст для VK",
      platforms: ["vk"],
      mediaIds: [],
    });

    expect(first.changed).toBe(true);
    expect(first.version.number).toBe(2);
    expect(first.post.status).toBe("draft");
    expect(first.post.targets.map((target) => target.platform)).toEqual(["vk"]);

    await prisma.post.update({ where: { id: created.id }, data: { status: "approved" } });
    await prisma.postTarget.updateMany({ where: { postId: created.id }, data: { status: "approved" } });

    const second = await posts.saveDraft(owner.userId, owner.workspaceId, created.id, {
      title: "Кухня весной",
      body: "Новый текст",
      platforms: ["vk", "telegram"],
      mediaIds: [],
    });

    expect(second.changed).toBe(true);
    expect(second.version.number).toBe(3);
    expect(second.post.status).toBe("draft");
    expect(second.post.targets.every((target) => target.status === "draft")).toBe(true);
    expect(second.post.versions.filter((version) => version.supersededAt).length).toBe(2);
  });

  it("uploads a valid image and rejects a spoofed mediaId", async () => {
    const ownerA = await registerOwner("media-a");
    const ownerB = await registerOwner("media-b");
    const media = createMediaService(prisma, createLocalStorage(storageDir));
    const asset = await media.upload(ownerA.userId, ownerA.workspaceId, {
      filename: "cover.png",
      declaredType: "image/png",
      bytes: png,
    });

    const postB = await posts.create(ownerB.userId, ownerB.workspaceId, ownerB.projectId);
    await expectAccess(media.get(ownerB.userId, ownerB.workspaceId, asset.id), 403, /другому рабочему пространству/);
    await expectAccess(media.get(ownerB.userId, ownerA.workspaceId, asset.id), 404, /не найдено/);
    await expectAccess(
      posts.saveDraft(ownerB.userId, ownerB.workspaceId, postB.id, {
        title: "Чужой файл",
        body: "Нет",
        platforms: ["vk"],
        mediaIds: [asset.id],
      }),
      403,
      /другому рабочему пространству/,
    );
    await expectAccess(
      posts.get(ownerB.userId, ownerB.workspaceId, (await posts.create(ownerA.userId, ownerA.workspaceId, ownerA.projectId)).id),
      403,
      /другому рабочему пространству/,
    );
  });

  it("does not fake an S3 upload when the integration is not configured", async () => {
    const owner = await registerOwner("s3-missing");
    const media = createMediaService(prisma, createUnconfiguredStorage("S3"));
    await expectAccess(
      media.upload(owner.userId, owner.workspaceId, {
        filename: "cover.png",
        declaredType: "image/png",
        bytes: png,
      }),
      400,
      /требуется настройка интеграции/,
    );
  });
});
