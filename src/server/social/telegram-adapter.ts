import type { PrismaClient } from "@prisma/client";

import { detectMediaType, isVideoMime } from "@/modules/media/file-validation";
import { decryptToken } from "@/server/crypto/token-cipher";
import {
  createTelegramTransport,
  type TelegramChat,
  type TelegramFilePart,
  type TelegramMessage,
  type TelegramTransport,
} from "@/server/social/telegram-api";
import { withProductLink } from "@/modules/products/shop-labels";
import { splitTelegramText, telegramCaptionAndRest } from "@/server/social/telegram-text";
import type { PublishInput, PublishOutcome, SocialAdapter } from "@/server/social/types";
import { createStorageFromEnv, type StorageDriver } from "@/server/storage";

function composeText(input: PublishInput) {
  const parts = [input.title.trim(), input.body.trim()].filter(Boolean);
  return withProductLink(parts.join("\n\n"), input.market?.url);
}

function filenameForMime(mimeType: string) {
  if (isVideoMime(mimeType)) {
    return "video.mp4";
  }
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

function mapTelegramFailure(errorCode: number, description: string, retryAfter?: number): PublishOutcome {
  if (errorCode === 0) {
    return { kind: "unknown", code: "network_unknown", message: description };
  }
  if (errorCode === 429) {
    return {
      kind: "temporary_failure",
      code: "rate_limit",
      message: retryAfter ? `${description} Повтор через ${retryAfter} с.` : description,
    };
  }
  if (errorCode === 401) {
    return { kind: "permanent_failure", code: "token_expired", message: description };
  }
  if (errorCode === 403 || errorCode === 400) {
    return { kind: "permanent_failure", code: `telegram_${errorCode}`, message: description };
  }
  return { kind: "temporary_failure", code: `telegram_${errorCode}`, message: description };
}

export function createTelegramAdapter(options: {
  db: PrismaClient;
  transport?: TelegramTransport;
  storage?: StorageDriver;
}): SocialAdapter {
  const transport = options.transport ?? createTelegramTransport();
  const storage = options.storage ?? createStorageFromEnv();

  return {
    platform: "telegram",
    async publish(input: PublishInput): Promise<PublishOutcome> {
      const target = await options.db.postTarget.findUnique({
        where: { id: input.targetId },
        include: { socialAccount: { include: { capabilities: true } } },
      });

      const account =
        target?.socialAccount ??
        (await options.db.socialAccount.findFirst({
          where: { workspaceId: input.workspaceId, platform: "telegram", status: "connected" },
          include: { capabilities: true },
          orderBy: { updatedAt: "desc" },
        }));

      if (!account || account.workspaceId !== input.workspaceId || account.status !== "connected" || !account.encryptedToken) {
        return {
          kind: "permanent_failure",
          code: "integration_not_configured",
          message: "Публикация в Telegram недоступна: подключите бота официальным токеном @BotFather.",
        };
      }

      if (!account.capabilities.some((item) => item.name === "publish_text" && item.enabled)) {
        return {
          kind: "permanent_failure",
          code: "capability_unavailable",
          message: "У аккаунта нет capability publish_text.",
        };
      }

      if (!account.externalId.trim()) {
        return {
          kind: "permanent_failure",
          code: "telegram_no_chat",
          message:
            "Бот подключён, но канал не указан. Привяжите t.me/dom_po_polochkam — бот уже должен быть там администратором.",
        };
      }

      let token: string;
      try {
        token = decryptToken(account.encryptedToken);
      } catch {
        return {
          kind: "permanent_failure",
          code: "token_corrupted",
          message: "Токен бота не удалось расшифровать. Подключите аккаунт заново.",
        };
      }

      const text = composeText(input);
      const mediaKeys = input.mediaKeys.filter(Boolean).slice(0, 10);
      let sent;

      if (mediaKeys.length > 0) {
        if (!storage.ready) {
          return {
            kind: "permanent_failure",
            code: "storage_unavailable",
            message: storage.setupMessage || "Хранилище не настроено, картинку в Telegram отправить нельзя.",
          };
        }
        const photos: TelegramFilePart[] = [];
        for (const [index, key] of mediaKeys.entries()) {
          let bytes: Uint8Array;
          try {
            bytes = await storage.get(key);
          } catch {
            return {
              kind: "temporary_failure",
              code: "media_missing",
              message: "Файл публикации не найден в хранилище. Повторите после загрузки медиа.",
            };
          }
          const mimeType = detectMediaType(bytes);
          if (!mimeType) {
            return {
              kind: "permanent_failure",
              code: "media_type",
              message: "В Telegram можно прикрепить JPEG, PNG, GIF, WebP или MP4.",
            };
          }
          photos.push({
            field: isVideoMime(mimeType) ? "video" : mediaKeys.length > 1 ? `photo${index}` : "photo",
            filename: filenameForMime(mimeType),
            mimeType,
            bytes,
          });
        }
        const { caption, rest } = telegramCaptionAndRest(text);
        const video = photos.find((item) => isVideoMime(item.mimeType));
        if (video) {
          sent = await transport.request(
            token,
            "sendVideo",
            {
              chat_id: account.externalId,
              caption,
              supports_streaming: true,
            },
            video,
          );
        } else if (photos.length === 1) {
          sent = await transport.request(
            token,
            "sendPhoto",
            {
              chat_id: account.externalId,
              caption,
            },
            photos[0],
          );
        } else {
          sent = await transport.request(
            token,
            "sendMediaGroup",
            {
              chat_id: account.externalId,
              media: JSON.stringify(
                photos.map((photo, index) => ({
                  type: "photo",
                  media: `attach://${photo.field}`,
                  ...(index === 0 ? { caption } : {}),
                })),
              ),
            },
            photos,
          );
        }
        if (sent.ok && rest) {
          for (const chunk of splitTelegramText(rest)) {
            const followUp = await transport.request(token, "sendMessage", {
              chat_id: account.externalId,
              text: chunk,
            });
            if (!followUp.ok) {
              sent = followUp;
              break;
            }
          }
        }
      } else {
        const chunks = splitTelegramText(text);
        sent = { ok: false, error_code: 400, description: "empty text" };
        for (const chunk of chunks) {
          sent = await transport.request(token, "sendMessage", {
            chat_id: account.externalId,
            text: chunk,
          });
          if (!sent.ok) {
            break;
          }
        }
      }

      if (!sent.ok) {
        if (sent.error_code === 401) {
          await options.db.socialAccount.update({
            where: { id: account.id },
            data: { status: "token_expired", lastError: sent.description },
          });
        }
        return mapTelegramFailure(sent.error_code, sent.description, sent.retry_after);
      }

      if (mediaKeys.length > 0) {
        await options.db.socialAccountCapability.upsert({
          where: { socialAccountId_name: { socialAccountId: account.id, name: "publish_media" } },
          update: { enabled: true },
          create: { socialAccountId: account.id, name: "publish_media", enabled: true },
        });
      }

      const first = Array.isArray(sent.result) ? sent.result[0] : sent.result;
      const message = (first ?? {}) as TelegramMessage;
      const chat = message.chat as TelegramChat | undefined;
      return {
        kind: "success",
        externalId: String(message.message_id ?? chat?.id ?? "telegram"),
      };
    },
  };
}
