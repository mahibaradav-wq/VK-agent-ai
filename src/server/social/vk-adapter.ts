import type { PrismaClient } from "@prisma/client";

import { detectMediaType } from "@/modules/media/file-validation";
import { parseShopPrice, withProductLink } from "@/modules/products/shop-labels";
import { decryptToken } from "@/server/crypto/token-cipher";
import {
  createVkTransport,
  describeVkApiError,
  extractSavedWallPhoto,
  type VkApiFailure,
  type VkTransport,
} from "@/server/social/vk-api";
import type { PublishInput, PublishOutcome, SocialAdapter } from "@/server/social/types";
import { createStorageFromEnv, type StorageDriver } from "@/server/storage";

const MAX_VK_WALL_PHOTOS = 10;

function composeText(input: PublishInput, includeLink: boolean) {
  const parts = [input.title.trim(), input.body.trim()].filter(Boolean);
  const text = parts.join("\n\n").slice(0, 15000) || "Публикация Polka Social";
  return includeLink ? withProductLink(text, input.market?.url).slice(0, 15000) : text;
}

function extractMarketItemId(response: unknown) {
  if (!response || typeof response !== "object") {
    return "";
  }
  const body = response as { market_item_id?: unknown; item_id?: unknown };
  const value = body.market_item_id ?? body.item_id;
  if (typeof value === "number" || typeof value === "string") {
    return String(value);
  }
  return "";
}

function ownerIdFromExternal(externalId: string) {
  const numeric = Number(externalId);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return null;
  }
  return numeric > 0 ? -numeric : numeric;
}

function groupIdFromOwner(ownerId: number) {
  return Math.abs(ownerId);
}

function filenameForMime(mimeType: string) {
  if (mimeType === "image/png") {
    return "photo.png";
  }
  if (mimeType === "image/gif") {
    return "photo.gif";
  }
  if (mimeType === "image/webp") {
    return "photo.webp";
  }
  return "photo.jpg";
}

function extractPostId(response: unknown) {
  if (typeof response === "number" && Number.isFinite(response)) {
    return String(response);
  }
  if (response && typeof response === "object" && "post_id" in response) {
    const postId = (response as { post_id?: unknown }).post_id;
    if (typeof postId === "number" || typeof postId === "string") {
      return String(postId);
    }
  }
  return "";
}

function extractUploadUrl(response: unknown) {
  if (response && typeof response === "object" && "upload_url" in response) {
    const url = (response as { upload_url?: unknown }).upload_url;
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      return url;
    }
  }
  return "";
}

function mapVkFailure(error: VkApiFailure): PublishOutcome {
  if (error.error_code === 0) {
    return { kind: "unknown", code: "network_unknown", message: describeVkApiError(error) };
  }
  if (error.error_code === 6 || error.error_code === 9 || error.error_code === 10) {
    return { kind: "temporary_failure", code: `vk_${error.error_code}`, message: describeVkApiError(error) };
  }
  if (error.error_code === 5) {
    return { kind: "permanent_failure", code: "token_expired", message: describeVkApiError(error) };
  }
  if (error.error_code === 15 || error.error_code === 27 || error.error_code === 200 || error.error_code === 214) {
    return { kind: "permanent_failure", code: `vk_${error.error_code}`, message: describeVkApiError(error) };
  }
  return { kind: "permanent_failure", code: `vk_${error.error_code}`, message: describeVkApiError(error) };
}

async function attachWallPhotos(options: {
  transport: VkTransport;
  storage: StorageDriver;
  token: string;
  groupId: number;
  mediaKeys: string[];
}): Promise<{ attachments: string[]; failure?: PublishOutcome }> {
  const keys = options.mediaKeys.slice(0, MAX_VK_WALL_PHOTOS);
  if (keys.length === 0) {
    return { attachments: [] };
  }

  const uploadWallPhoto = options.transport.uploadWallPhoto;
  if (!uploadWallPhoto) {
    return {
      attachments: [],
      failure: {
        kind: "permanent_failure",
        code: "vk_upload_unavailable",
        message: "Загрузка фото на стену VK недоступна на этом сервере.",
      },
    };
  }

  const uploadServer = await options.transport.call(options.token, "photos.getWallUploadServer", {
    group_id: options.groupId,
  });
  if (!uploadServer.ok) {
    return { attachments: [], failure: mapVkFailure(uploadServer) };
  }
  const uploadUrl = extractUploadUrl(uploadServer.response);
  if (!uploadUrl) {
    return {
      attachments: [],
      failure: {
        kind: "permanent_failure",
        code: "vk_upload_url",
        message: "VK не выдал адрес загрузки фото на стену. Проверьте право «Фотографии» у ключа сообщества.",
      },
    };
  }

  const attachments: string[] = [];
  for (const key of keys) {
    let bytes: Uint8Array;
    try {
      bytes = await options.storage.get(key);
    } catch {
      return {
        attachments: [],
        failure: {
          kind: "temporary_failure",
          code: "media_missing",
          message: "Файл публикации не найден в хранилище. Повторите после загрузки медиа.",
        },
      };
    }
    const mimeType = detectMediaType(bytes);
    if (!mimeType) {
      return {
        attachments: [],
        failure: {
          kind: "permanent_failure",
          code: "media_type",
          message: "Во ВК можно прикрепить только изображение JPEG, PNG, GIF или WebP.",
        },
      };
    }

    const uploaded = await uploadWallPhoto(uploadUrl, {
      filename: filenameForMime(mimeType),
      bytes,
      mimeType,
    });
    if (!uploaded.ok) {
      return { attachments: [], failure: mapVkFailure(uploaded) };
    }

    const saved = await options.transport.call(options.token, "photos.saveWallPhoto", {
      group_id: options.groupId,
      photo: uploaded.response.photo,
      server: uploaded.response.server,
      hash: uploaded.response.hash,
    });
    if (!saved.ok) {
      return { attachments: [], failure: mapVkFailure(saved) };
    }
    const photo = extractSavedWallPhoto(saved.response);
    if (!photo) {
      return {
        attachments: [],
        failure: {
          kind: "permanent_failure",
          code: "vk_photo_save",
          message: "VK принял файл, но не вернул вложение для стены.",
        },
      };
    }
    attachments.push(`photo${photo.owner_id}_${photo.id}`);
  }

  return { attachments };
}

export function createVkAdapter(options: {
  db: PrismaClient;
  transport?: VkTransport;
  storage?: StorageDriver;
}): SocialAdapter {
  const transport = options.transport ?? createVkTransport();
  const storage = options.storage ?? createStorageFromEnv();

  return {
    platform: "vk",
    async publish(input: PublishInput): Promise<PublishOutcome> {
      const target = await options.db.postTarget.findUnique({
        where: { id: input.targetId },
        include: { socialAccount: { include: { capabilities: true } } },
      });

      const account =
        target?.socialAccount ??
        (await options.db.socialAccount.findFirst({
          where: { workspaceId: input.workspaceId, platform: "vk", status: "connected" },
          include: { capabilities: true },
          orderBy: { updatedAt: "desc" },
        }));

      if (!account || account.workspaceId !== input.workspaceId || account.status !== "connected" || !account.encryptedToken) {
        return {
          kind: "permanent_failure",
          code: "integration_not_configured",
          message:
            "Публикация во ВКонтакте недоступна: подключите ключ доступа сообщества с правом «Стена». Сервисный ключ приложения и пароль не подходят.",
        };
      }

      if (!account.capabilities.some((item) => item.name === "publish_text" && item.enabled)) {
        return {
          kind: "permanent_failure",
          code: "capability_unavailable",
          message: "У аккаунта нет capability publish_text.",
        };
      }

      const ownerId = ownerIdFromExternal(account.externalId);
      if (!ownerId) {
        return {
          kind: "permanent_failure",
          code: "vk_no_group",
          message: "Ключ сообщества сохранён, но не выбран клуб для стены. Укажите vk.com/club… при подключении.",
        };
      }

      let token: string;
      try {
        token = decryptToken(account.encryptedToken);
      } catch {
        return {
          kind: "permanent_failure",
          code: "token_corrupted",
          message: "Ключ сообщества не удалось расшифровать. Подключите аккаунт заново.",
        };
      }

      const groupId = groupIdFromOwner(ownerId);
      const attached = await attachWallPhotos({
        transport,
        storage,
        token,
        groupId,
        mediaKeys: input.mediaKeys,
      });
      if (attached.failure) {
        return attached.failure;
      }

      const attachments = [...attached.attachments];
      let marketAttached = false;
      if (input.market) {
        const price = parseShopPrice(input.market.priceText) ?? 1;
        const added = await transport.call(token, "market.add", {
          owner_id: ownerId,
          name: input.market.title.slice(0, 100) || "Товар",
          description: composeText(input, true).slice(0, 4000),
          category_id: 1,
          price,
          url: input.market.url,
        });
        if (added.ok) {
          const itemId = extractMarketItemId(added.response);
          if (itemId) {
            attachments.push(`market${ownerId}_${itemId}`);
            marketAttached = true;
          }
        }
      }

      const params: Record<string, string | number> = {
        owner_id: ownerId,
        from_group: 1,
        message: composeText(input, !marketAttached),
        guid: input.targetId,
      };
      if (attachments.length > 0) {
        params.attachments = attachments.join(",");
      }

      const posted = await transport.call(token, "wall.post", params);

      if (!posted.ok) {
        if (posted.error_code === 5) {
          await options.db.socialAccount.update({
            where: { id: account.id },
            data: { status: "token_expired", lastError: describeVkApiError(posted) },
          });
        }
        return mapVkFailure(posted);
      }

      if (attached.attachments.length > 0) {
        await options.db.socialAccountCapability.upsert({
          where: { socialAccountId_name: { socialAccountId: account.id, name: "publish_media" } },
          update: { enabled: true },
          create: { socialAccountId: account.id, name: "publish_media", enabled: true },
        });
      }

      const externalId = extractPostId(posted.response);
      return {
        kind: "success",
        externalId: externalId || `${ownerId}`,
      };
    },
  };
}
