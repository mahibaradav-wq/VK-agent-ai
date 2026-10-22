import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { AccessError, assertWorkspaceBound } from "@/modules/access/permissions";
import { createAccessService } from "@/modules/access/access-service";
import { validateMediaFile } from "@/modules/media/file-validation";
import type { StorageDriver } from "@/server/storage/types";

export function createMediaService(db: PrismaClient, storage: StorageDriver) {
  const access = createAccessService(db);

  return {
    storageStatus() {
      return {
        ready: storage.ready,
        driver: storage.driver,
        setupMessage: storage.setupMessage,
      };
    },

    async list(userId: string, workspaceId: string) {
      await access.requirePermission(userId, workspaceId, "media.view");
      return db.mediaAsset.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "desc" },
      });
    },

    async get(userId: string, workspaceId: string, mediaId: string) {
      await access.requirePermission(userId, workspaceId, "media.view");
      const media = await db.mediaAsset.findUnique({ where: { id: mediaId } });
      assertWorkspaceBound(workspaceId, media, "Медиафайл");
      return media;
    },

    async readFile(userId: string, workspaceId: string, mediaId: string) {
      const media = await this.get(userId, workspaceId, mediaId);
      const bytes = await storage.get(media.storageKey);
      return { media, bytes };
    },

    async upload(
      userId: string,
      workspaceId: string,
      input: { filename: string; declaredType?: string; bytes: Uint8Array },
    ) {
      await access.requirePermission(userId, workspaceId, "media.upload");

      if (!storage.ready) {
        throw new AccessError(400, storage.setupMessage ?? "Хранилище не настроено.");
      }

      const validated = validateMediaFile(input);
      const key = `${workspaceId}/${randomUUID()}`;
      const stored = await storage.put(key, input.bytes, validated.mimeType);

      const media = await db.mediaAsset.create({
        data: {
          workspaceId,
          uploadedById: userId,
          originalName: input.filename.trim() || "file",
          mimeType: validated.mimeType,
          sizeBytes: validated.sizeBytes,
          storageKey: stored.key,
          storageDriver: stored.driver,
        },
      });
      await db.auditLog.create({
        data: {
          action: "UPLOAD_MEDIA",
          entityType: "media",
          entityId: media.id,
          actorId: userId,
          details: `${validated.mimeType}:${validated.sizeBytes}`,
        },
      });
      return media;
    },
  };
}
