import type { PrismaClient } from "@prisma/client";

import { decryptToken } from "@/server/crypto/token-cipher";
import {
  createTelegramTransport,
  type TelegramChat,
  type TelegramMessage,
  type TelegramTransport,
} from "@/server/social/telegram-api";
import type { PublishInput, PublishOutcome, SocialAdapter } from "@/server/social/types";

function composeText(input: PublishInput) {
  const parts = [input.title.trim(), input.body.trim()].filter(Boolean);
  if (input.mediaKeys.length > 0) {
    parts.push("Медиа в Telegram не отправлено: capability publish_media не включена.");
  }
  return parts.join("\n\n") || "Публикация Polka Social";
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
}): SocialAdapter {
  const transport = options.transport ?? createTelegramTransport();

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

      const sent = await transport.request(token, "sendMessage", {
        chat_id: account.externalId,
        text: composeText(input),
      });

      if (!sent.ok) {
        if (sent.error_code === 401) {
          await options.db.socialAccount.update({
            where: { id: account.id },
            data: { status: "token_expired", lastError: sent.description },
          });
        }
        return mapTelegramFailure(sent.error_code, sent.description, sent.retry_after);
      }

      const message = sent.result as TelegramMessage;
      const chat = message.chat as TelegramChat | undefined;
      return {
        kind: "success",
        externalId: String(message.message_id ?? chat?.id ?? "telegram"),
      };
    },
  };
}
