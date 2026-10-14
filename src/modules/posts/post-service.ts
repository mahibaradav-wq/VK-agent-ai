import type { Prisma, PrismaClient, PostStatus, PostTargetStatus } from "@prisma/client";

import { AccessError, assertWorkspaceBound } from "@/modules/access/permissions";
import { createAccessService } from "@/modules/access/access-service";
import { parsePlatforms } from "@/modules/posts/platforms";

const postInclude = {
  versions: { orderBy: { number: "desc" as const } },
  targets: { orderBy: { platform: "asc" as const } },
  media: { include: { media: true }, orderBy: { sortOrder: "asc" as const } },
  project: true,
  schedule: true,
} satisfies Prisma.PostInclude;

export type PostRecord = Prisma.PostGetPayload<{ include: typeof postInclude }>;

function currentVersion(post: PostRecord) {
  return post.versions.find((version) => !version.supersededAt) ?? post.versions[0] ?? null;
}

function fingerprint(input: { title: string; body: string; platforms: string[]; mediaIds: string[] }) {
  return JSON.stringify({
    title: input.title.trim(),
    body: input.body.trim(),
    platforms: [...input.platforms].sort(),
    mediaIds: [...input.mediaIds].sort(),
  });
}

const approvalStatuses: Array<PostStatus | PostTargetStatus> = ["pending_approval", "approved"];

export function createPostService(db: PrismaClient) {
  const access = createAccessService(db);

  async function loadBoundPost(workspaceId: string, postId: string) {
    const post = await db.post.findUnique({
      where: { id: postId },
      include: postInclude,
    });
    assertWorkspaceBound(workspaceId, post, "Публикация");
    return post;
  }

  return {
    currentVersion,

    async list(userId: string, workspaceId: string, projectId?: string) {
      await access.requirePermission(userId, workspaceId, "post.view");
      return db.post.findMany({
        where: { workspaceId, projectId: projectId || undefined },
        include: postInclude,
        orderBy: { updatedAt: "desc" },
      });
    },

    async get(userId: string, workspaceId: string, postId: string) {
      await access.requirePermission(userId, workspaceId, "post.view");
      return loadBoundPost(workspaceId, postId);
    },

    async create(userId: string, workspaceId: string, projectId: string, title?: string) {
      await access.requirePermission(userId, workspaceId, "post.create");
      const project = await db.project.findUnique({ where: { id: projectId } });
      assertWorkspaceBound(workspaceId, project, "Проект");

      const nextTitle = title?.trim() || "Черновик";
      const post = await db.$transaction(async (tx) => {
        const created = await tx.post.create({
          data: {
            workspaceId,
            projectId,
            authorId: userId,
            status: "draft",
            versions: {
              create: {
                number: 1,
                title: nextTitle,
                body: "",
                createdById: userId,
              },
            },
          },
        });
        await tx.auditLog.create({
          data: {
            action: "CREATE_POST",
            entityType: "post",
            entityId: created.id,
            actorId: userId,
            details: projectId,
          },
        });
        return created;
      });

      return loadBoundPost(workspaceId, post.id);
    },

    async saveDraft(
      userId: string,
      workspaceId: string,
      postId: string,
      input: { title: string; body: string; platforms: string[]; mediaIds: string[] },
    ) {
      await access.requirePermission(userId, workspaceId, "post.update");
      const post = await loadBoundPost(workspaceId, postId);
      const title = input.title.trim();
      const body = input.body.trim();
      if (title.length < 2) {
        throw new AccessError(400, "Название черновика должно содержать минимум 2 символа.");
      }

      const platforms = parsePlatforms(input.platforms);
      const requestedMediaIds = [...new Set(input.mediaIds.filter(Boolean))];
      const media = requestedMediaIds.length
        ? await db.mediaAsset.findMany({ where: { id: { in: requestedMediaIds } } })
        : [];

      if (media.length !== requestedMediaIds.length) {
        throw new AccessError(404, "Медиафайл не найден.");
      }

      for (const asset of media) {
        assertWorkspaceBound(workspaceId, asset, "Медиафайл");
      }

      const active = currentVersion(post);
      const currentPrint = fingerprint({
        title: active?.title ?? "",
        body: active?.body ?? "",
        platforms: post.targets.map((target) => target.platform),
        mediaIds: post.media.map((item) => item.mediaId),
      });
      const nextPrint = fingerprint({ title, body, platforms, mediaIds: requestedMediaIds });

      if (currentPrint === nextPrint && active) {
        return { post, version: active, changed: false };
      }

      const nextNumber = (post.versions[0]?.number ?? 0) + 1;
      const updated = await db.$transaction(async (tx) => {
        if (active) {
          await tx.postVersion.update({
            where: { id: active.id },
            data: { supersededAt: new Date() },
          });
        }

        const version = await tx.postVersion.create({
          data: {
            postId: post.id,
            number: nextNumber,
            title,
            body,
            createdById: userId,
          },
        });

        await tx.postMedia.deleteMany({ where: { postId: post.id } });
        if (requestedMediaIds.length) {
          await tx.postMedia.createMany({
            data: requestedMediaIds.map((mediaId, index) => ({
              postId: post.id,
              mediaId,
              sortOrder: index,
            })),
          });
        }

        const existingPlatforms = new Set(post.targets.map((target) => target.platform));
        for (const platform of platforms) {
          if (!existingPlatforms.has(platform)) {
            await tx.postTarget.create({
              data: { postId: post.id, workspaceId, platform, status: "draft" },
            });
          }
        }
        await tx.postTarget.deleteMany({
          where: { postId: post.id, platform: { notIn: platforms } },
        });

        const shouldInvalidate = approvalStatuses.includes(post.status);
        await tx.post.update({
          where: { id: post.id },
          data: { status: shouldInvalidate ? "draft" : post.status },
        });
        if (shouldInvalidate) {
          await tx.postTarget.updateMany({
            where: { postId: post.id, status: { in: ["pending_approval", "approved"] } },
            data: { status: "draft" },
          });
        }

        await tx.auditLog.create({
          data: {
            action: shouldInvalidate ? "INVALIDATE_POST_VERSION" : "SAVE_POST_DRAFT",
            entityType: "post",
            entityId: post.id,
            actorId: userId,
            details: `v${nextNumber}`,
          },
        });

        return version;
      });

      return { post: await loadBoundPost(workspaceId, post.id), version: updated, changed: true };
    },
  };
}
