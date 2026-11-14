import type { PrismaClient } from "@prisma/client";

import { decryptToken } from "@/server/crypto/token-cipher";
import {
  createVkTransport,
  describeVkApiError,
  type VkApiFailure,
  type VkTransport,
} from "@/server/social/vk-api";
import type { PublishInput, PublishOutcome, SocialAdapter } from "@/server/social/types";

function composeText(input: PublishInput) {
  const parts = [input.title.trim(), input.body.trim()].filter(Boolean);
  if (input.mediaKeys.length > 0) {
    parts.push("Медиа во ВК не прикреплено: capability publish_media не включена.");
  }
  return parts.join("\n\n").slice(0, 15000) || "Публикация Polka Social";
}

function ownerIdFromExternal(externalId: string) {
  const numeric = Number(externalId);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return null;
  }
  return numeric > 0 ? -numeric : numeric;
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
  if (error.error_code === 15 || error.error_code === 27 || error.error_code === 214) {
    return { kind: "permanent_failure", code: `vk_${error.error_code}`, message: describeVkApiError(error) };
  }
  return { kind: "permanent_failure", code: `vk_${error.error_code}`, message: describeVkApiError(error) };
}

export function createVkAdapter(options: { db: PrismaClient; transport?: VkTransport }): SocialAdapter {
  const transport = options.transport ?? createVkTransport();

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

      const posted = await transport.call(token, "wall.post", {
        owner_id: ownerId,
        from_group: 1,
        message: composeText(input),
        guid: input.targetId,
      });

      if (!posted.ok) {
        if (posted.error_code === 5) {
          await options.db.socialAccount.update({
            where: { id: account.id },
            data: { status: "token_expired", lastError: describeVkApiError(posted) },
          });
        }
        return mapVkFailure(posted);
      }

      const externalId = extractPostId(posted.response);
      return {
        kind: "success",
        externalId: externalId || `${ownerId}`,
      };
    },
  };
}
