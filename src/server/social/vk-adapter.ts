import type { PrismaClient } from "@prisma/client";

import { detectMediaType, isVideoMime } from "@/modules/media/file-validation";
import { jpegForVkWall } from "@/modules/media/jpeg-encode";
import { parseShopPrice, withProductLink } from "@/modules/products/shop-labels";
import { decryptToken } from "@/server/crypto/token-cipher";
import {
  createVkTransport,
  describeVkApiError,
  extractSavedVideo,
  extractSavedWallPhoto,
  isPhotoUploadUnavailable,
  resolveVkPublishTokens,
  type VkApiFailure,
  type VkTransport,
} from "@/server/social/vk-api";
import { VK_MANUAL_PHOTO_CODE, VK_MANUAL_PHOTO_MESSAGE } from "@/modules/social/vk-manual";
import { toVkWallText } from "@/modules/social/vk-wall-text";
import {
  isSocialPublishLiveEnabled,
  socialPublishLiveBlockedOutcome,
} from "@/server/social/publish-live-guard";
import { resolvePublishSocialAccount } from "@/server/social/resolve-account";
import type { PublishInput, PublishOutcome, SocialAdapter } from "@/server/social/types";
import { createStorageFromEnv, type StorageDriver } from "@/server/storage";

const MAX_VK_WALL_PHOTOS = 10;
const POLKA_ALBUM_TITLE = "Polka Social";

function composeText(input: PublishInput, includeLink: boolean) {
  const parts = [toVkWallText(input.title), toVkWallText(input.body)].filter(Boolean);
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

function filenameForMime(mimeType: string, index = 0) {
  const ext =
    mimeType === "image/png" ? "png" : mimeType === "image/gif" ? "gif" : mimeType === "image/webp" ? "webp" : "jpg";
  return `slide-${index + 1}.${ext}`;
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

function extractAlbumId(response: unknown) {
  if (!response || typeof response !== "object") {
    return 0;
  }
  const body = response as { id?: unknown; items?: unknown[] };
  const direct = typeof body.id === "number" ? body.id : Number(body.id);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }
  if (!Array.isArray(body.items)) {
    return 0;
  }
  for (const item of body.items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const id = typeof (item as { id?: unknown }).id === "number" ? (item as { id: number }).id : Number((item as { id?: unknown }).id);
    if (Number.isFinite(id) && id > 0) {
      return id;
    }
  }
  return 0;
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

function mapVkFailure(error: VkApiFailure, stage: "upload" | "publish" = "publish"): PublishOutcome {
  if (error.error_code === 0) {
    return {
      kind: stage === "upload" ? "temporary_failure" : "unknown",
      code: stage === "upload" ? "network_error" : "network_unknown",
      message: describeVkApiError(error),
    };
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

async function readImageFiles(options: {
  storage: StorageDriver;
  mediaKeys: string[];
}): Promise<{ files: Array<{ bytes: Uint8Array; mimeType: string }>; failure?: PublishOutcome }> {
  const files: Array<{ bytes: Uint8Array; mimeType: string }> = [];
  for (const key of options.mediaKeys) {
    let bytes: Uint8Array;
    try {
      bytes = await options.storage.get(key);
    } catch {
      return {
        files: [],
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
        files: [],
        failure: {
          kind: "permanent_failure",
          code: "media_type",
          message: "Во ВК можно прикрепить JPEG, PNG, GIF, WebP или MP4.",
        },
      };
    }
    files.push(await jpegForVkWall({ bytes, mimeType }));
  }
  return { files };
}

async function attachFromWallAlbum(options: {
  transport: VkTransport;
  token: string;
  groupId: number;
  files: Array<{ bytes: Uint8Array; mimeType: string }>;
}): Promise<{ attachments: string[]; blocked?: boolean; failure?: PublishOutcome }> {
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

  const attachments: string[] = [];
  for (const [index, file] of options.files.entries()) {
    const uploadServer = await options.transport.call(options.token, "photos.getWallUploadServer", {
      group_id: options.groupId,
    });
    if (!uploadServer.ok) {
      if (isPhotoUploadUnavailable(uploadServer)) {
        return { attachments: [], blocked: true };
      }
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

    const uploaded = await uploadWallPhoto(uploadUrl, {
      filename: filenameForMime(file.mimeType, index),
      bytes: file.bytes,
      mimeType: file.mimeType,
    });
    if (!uploaded.ok) {
      return { attachments: [], failure: mapVkFailure(uploaded, "upload") };
    }

    const saved = await options.transport.call(options.token, "photos.saveWallPhoto", {
      group_id: options.groupId,
      photo: uploaded.response.photo,
      server: uploaded.response.server,
      hash: uploaded.response.hash,
    });
    if (!saved.ok) {
      if (isPhotoUploadUnavailable(saved)) {
        return { attachments: [], blocked: true };
      }
      return { attachments: [], failure: mapVkFailure(saved, "upload") };
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

async function resolveCommunityAlbum(options: {
  transport: VkTransport;
  token: string;
  groupId: number;
}): Promise<{ albumId: number } | { blocked: true }> {
  const listed = await options.transport.call(options.token, "photos.getAlbums", {
    owner_id: -options.groupId,
  });
  if (listed.ok) {
    const albumId = extractAlbumId(listed.response);
    if (albumId) {
      return { albumId };
    }
  }

  const created = await options.transport.call(options.token, "photos.createAlbum", {
    title: POLKA_ALBUM_TITLE,
    group_id: options.groupId,
    description: "Карточки из Студии Polka Social",
    upload_by_admins_only: 1,
  });
  if (created.ok) {
    const albumId = extractAlbumId(created.response);
    if (albumId) {
      return { albumId };
    }
  }
  return { blocked: true };
}

async function attachFromCommunityAlbum(options: {
  transport: VkTransport;
  token: string;
  groupId: number;
  files: Array<{ bytes: Uint8Array; mimeType: string }>;
}): Promise<{ attachments: string[]; blocked?: boolean; failure?: PublishOutcome }> {
  const uploadAlbumPhoto = options.transport.uploadAlbumPhoto;
  if (!uploadAlbumPhoto) {
    return { attachments: [], blocked: true };
  }

  const album = await resolveCommunityAlbum({
    transport: options.transport,
    token: options.token,
    groupId: options.groupId,
  });
  if ("blocked" in album) {
    return { attachments: [], blocked: true };
  }

  const attachments: string[] = [];
  for (const [index, file] of options.files.entries()) {
    const uploadServer = await options.transport.call(options.token, "photos.getUploadServer", {
      album_id: album.albumId,
      group_id: options.groupId,
    });
    if (!uploadServer.ok) {
      return isPhotoUploadUnavailable(uploadServer)
        ? { attachments: [], blocked: true }
        : { attachments: [], failure: mapVkFailure(uploadServer, "upload") };
    }
    const uploadUrl = extractUploadUrl(uploadServer.response);
    if (!uploadUrl) {
      return { attachments: [], blocked: true };
    }

    const uploaded = await uploadAlbumPhoto(uploadUrl, {
      filename: filenameForMime(file.mimeType, index),
      bytes: file.bytes,
      mimeType: file.mimeType,
    });
    if (!uploaded.ok) {
      return { attachments: [], failure: mapVkFailure(uploaded, "upload") };
    }

    const saved = await options.transport.call(options.token, "photos.save", {
      album_id: album.albumId,
      group_id: options.groupId,
      server: uploaded.response.server,
      photos_list: uploaded.response.photos_list,
      hash: uploaded.response.hash,
    });
    if (!saved.ok) {
      return isPhotoUploadUnavailable(saved)
        ? { attachments: [], blocked: true }
        : { attachments: [], failure: mapVkFailure(saved, "upload") };
    }
    const photo = extractSavedWallPhoto(saved.response);
    if (!photo) {
      return {
        attachments: [],
        failure: {
          kind: "permanent_failure",
          code: "vk_photo_save",
          message: "VK принял файл в альбом, но не вернул вложение для стены.",
        },
      };
    }
    attachments.push(`photo${photo.owner_id}_${photo.id}`);
  }

  return { attachments };
}

function nativeWallPhotoFailure(): PublishOutcome {
  return {
    kind: "unknown",
    code: VK_MANUAL_PHOTO_CODE,
    message: VK_MANUAL_PHOTO_MESSAGE,
  };
}

async function attachWallPhotos(options: {
  transport: VkTransport;
  storage: StorageDriver;
  token: string;
  photoToken?: string;
  groupId: number;
  mediaKeys: string[];
}): Promise<{ attachments: string[]; failure?: PublishOutcome }> {
  const keys = options.mediaKeys.slice(0, MAX_VK_WALL_PHOTOS);
  if (keys.length === 0) {
    return { attachments: [] };
  }

  const images = await readImageFiles({ storage: options.storage, mediaKeys: keys });
  if (images.failure) {
    return { attachments: [], failure: images.failure };
  }

  const tokens = [options.photoToken?.trim(), options.token].filter((item): item is string => Boolean(item));
  for (const token of tokens) {
    const wall = await attachFromWallAlbum({
      transport: options.transport,
      token,
      groupId: options.groupId,
      files: images.files,
    });
    if (!wall.blocked) {
      if (wall.failure) {
        return wall;
      }
      if (wall.attachments.some((item) => !item.startsWith("photo"))) {
        return { attachments: [], failure: nativeWallPhotoFailure() };
      }
      return wall;
    }
    const album = await attachFromCommunityAlbum({
      transport: options.transport,
      token,
      groupId: options.groupId,
      files: images.files,
    });
    if (!album.blocked) {
      if (album.failure) {
        return album;
      }
      if (album.attachments.some((item) => !item.startsWith("photo"))) {
        return { attachments: [], failure: nativeWallPhotoFailure() };
      }
      return album;
    }
  }

  return { attachments: [], failure: nativeWallPhotoFailure() };
}

async function attachWallVideo(options: {
  transport: VkTransport;
  token: string;
  groupId: number;
  title?: string;
  file: { bytes: Uint8Array; mimeType: string };
}): Promise<{ attachments: string[]; failure?: PublishOutcome; blocked?: boolean }> {
  const uploadVideo = options.transport.uploadVideo;
  if (!uploadVideo) {
    return {
      attachments: [],
      failure: {
        kind: "permanent_failure",
        code: "vk_upload_unavailable",
        message: "Загрузка ролика во ВК недоступна на этом сервере.",
      },
    };
  }

  const saved = await options.transport.call(options.token, "video.save", {
    group_id: options.groupId,
    name: options.title?.trim().slice(0, 128) || "Ролик",
    wallpost: 0,
  });
  if (!saved.ok) {
    if (isPhotoUploadUnavailable(saved)) {
      return { attachments: [], blocked: true };
    }
    return { attachments: [], failure: mapVkFailure(saved, "upload") };
  }

  const uploadUrl = extractUploadUrl(saved.response);
  const fromSave = extractSavedVideo(saved.response);
  if (!uploadUrl) {
    return {
      attachments: [],
      failure: {
        kind: "permanent_failure",
        code: "vk_upload_url",
        message: "VK не выдал адрес загрузки ролика. В ключе сообщества нужно право «Видеозаписи».",
      },
    };
  }

  const uploaded = await uploadVideo(uploadUrl, {
    filename: "video.mp4",
    bytes: options.file.bytes,
    mimeType: "video/mp4",
  });
  if (!uploaded.ok) {
    return { attachments: [], failure: mapVkFailure(uploaded, "upload") };
  }

  const video =
    uploaded.response.video_id && uploaded.response.owner_id
      ? uploaded.response
      : fromSave;
  if (!video || !video.video_id || !video.owner_id) {
    return {
      attachments: [],
      failure: {
        kind: "permanent_failure",
        code: "vk_video_save",
        message: "VK принял ролик, но не вернул вложение для стены.",
      },
    };
  }

  return { attachments: [`video${video.owner_id}_${video.video_id}`] };
}

export function createVkAdapter(options: {
  db: PrismaClient;
  transport?: VkTransport;
  storage?: StorageDriver;
}): SocialAdapter {
  const usingInjectedTransport = Boolean(options.transport);
  const transport = options.transport ?? createVkTransport();
  const storage = options.storage ?? createStorageFromEnv();

  return {
    platform: "vk",
    async publish(input: PublishInput): Promise<PublishOutcome> {
      const account = await resolvePublishSocialAccount(options.db, input, "vk");

      if (!account || account.workspaceId !== input.workspaceId || account.status !== "connected" || !account.encryptedToken) {
        return {
          kind: "permanent_failure",
          code: "integration_not_configured",
          message:
            "Публикация во ВКонтакте недоступна: подключите ключ админа клуба с правом «Фотографии» или ключ сообщества с правом «Стена». Сервисный ключ приложения и пароль не подходят.",
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

      if (!usingInjectedTransport && !isSocialPublishLiveEnabled()) {
        return socialPublishLiveBlockedOutcome();
      }

      let packed: string;
      try {
        packed = decryptToken(account.encryptedToken);
      } catch {
        return {
          kind: "permanent_failure",
          code: "token_corrupted",
          message: "Ключ сообщества не удалось расшифровать. Подключите аккаунт заново.",
        };
      }
      const tokens = resolveVkPublishTokens(packed);
      const token = tokens.wall;
      if (!token) {
        return {
          kind: "permanent_failure",
          code: "token_corrupted",
          message: "Ключ ВКонтакте не удалось разобрать. Подключите аккаунт заново.",
        };
      }

      const groupId = groupIdFromOwner(ownerId);
      const media = input.mediaKeys.length
        ? await readImageFiles({ storage, mediaKeys: input.mediaKeys })
        : { files: [] as Array<{ bytes: Uint8Array; mimeType: string }> };
      if (media.failure) {
        return media.failure;
      }
      const video = media.files.find((item) => isVideoMime(item.mimeType));
      const attached = video
        ? await attachWallVideo({
            transport,
            token,
            groupId,
            title: input.title,
            file: video,
          })
        : await attachWallPhotos({
            transport,
            storage,
            token,
            photoToken: tokens.photo,
            groupId,
            mediaKeys: input.mediaKeys,
          });
      if (attached.failure) {
        return attached.failure;
      }
      if (input.mediaKeys.length > 0 && attached.attachments.length === 0) {
        return nativeWallPhotoFailure();
      }
      if (attached.attachments.some((item) => item.startsWith("doc"))) {
        return nativeWallPhotoFailure();
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
