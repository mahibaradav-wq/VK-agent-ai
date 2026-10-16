import type { Prisma, PrismaClient } from "@prisma/client";

import { AccessError, assertWorkspaceBound } from "@/modules/access/permissions";
import { createAccessService } from "@/modules/access/access-service";
import { getWorkspacePlanLimits } from "@/modules/billing/plans";
import { lockWorkspaceMetric } from "@/modules/billing/usage";
import { encryptToken } from "@/server/crypto/token-cipher";
import { FIRST_SOCIAL_PLATFORM } from "@/modules/social/catalog";
import {
  createTelegramTransport,
  isTelegramBotToken,
  type TelegramChat,
  type TelegramTransport,
  type TelegramUser,
} from "@/server/social/telegram-api";

const accountInclude = {
  capabilities: { orderBy: { name: "asc" as const } },
  project: true,
} satisfies Prisma.SocialAccountInclude;

export type SocialAccountRecord = Prisma.SocialAccountGetPayload<{ include: typeof accountInclude }>;

export type PublicSocialAccount = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  projectName: string | null;
  platform: string;
  displayName: string;
  externalId: string;
  status: SocialAccountRecord["status"];
  lastError: string | null;
  hasToken: boolean;
  capabilities: Array<{ name: string; enabled: boolean }>;
  createdAt: Date;
};

function toPublic(account: SocialAccountRecord): PublicSocialAccount {
  return {
    id: account.id,
    workspaceId: account.workspaceId,
    projectId: account.projectId,
    projectName: account.project?.name ?? null,
    platform: account.platform,
    displayName: account.displayName,
    externalId: account.externalId,
    status: account.status,
    lastError: account.lastError,
    hasToken: Boolean(account.encryptedToken),
    capabilities: account.capabilities.map((item) => ({ name: item.name, enabled: item.enabled })),
    createdAt: account.createdAt,
  };
}

function rejectPassword(input: { password?: string; vkPassword?: string }) {
  if (input.password?.trim() || input.vkPassword?.trim()) {
    throw new AccessError(400, "Пароль социальной сети не принимается. Подключение только официальным API-токеном.");
  }
}

export function createSocialService(
  db: PrismaClient,
  options?: {
    telegram?: TelegramTransport;
  },
) {
  const access = createAccessService(db);
  const telegram = options?.telegram ?? createTelegramTransport();

  async function loadBoundAccount(workspaceId: string, accountId: string) {
    const account = await db.socialAccount.findUnique({
      where: { id: accountId },
      include: accountInclude,
    });
    assertWorkspaceBound(workspaceId, account, "Социальный аккаунт");
    return account;
  }

  return {
    toPublic,

    async list(userId: string, workspaceId: string) {
      await access.requirePermission(userId, workspaceId, "social.view");
      const rows = await db.socialAccount.findMany({
        where: { workspaceId, status: { not: "disconnected" } },
        include: accountInclude,
        orderBy: { createdAt: "desc" },
      });
      return rows.map(toPublic);
    },

    async get(userId: string, workspaceId: string, accountId: string) {
      await access.requirePermission(userId, workspaceId, "social.view");
      return toPublic(await loadBoundAccount(workspaceId, accountId));
    },

    async createRequiresSetup(
      userId: string,
      workspaceId: string,
      input: { platform?: string; displayName?: string; projectId?: string; password?: string },
    ) {
      await access.requirePermission(userId, workspaceId, "social.connect");
      rejectPassword(input);
      const platform = input.platform?.trim() || FIRST_SOCIAL_PLATFORM;
      if (platform !== "telegram" && platform !== "vk") {
        throw new AccessError(400, "Неизвестная платформа.");
      }
      if (input.projectId) {
        const project = await db.project.findUnique({ where: { id: input.projectId } });
        assertWorkspaceBound(workspaceId, project, "Проект");
      }

      const account = await db.$transaction(async (tx) => {
        await lockWorkspaceMetric(tx, workspaceId, "social_accounts");
        const limits = await getWorkspacePlanLimits(tx, workspaceId);
        const used = await tx.socialAccount.count({
          where: { workspaceId, status: { not: "disconnected" } },
        });
        if (used >= limits.socialAccounts) {
          throw new AccessError(400, `Лимит социальных аккаунтов тарифа исчерпан (${limits.socialAccounts}).`);
        }
        const created = await tx.socialAccount.create({
          data: {
            workspaceId,
            projectId: input.projectId || null,
            platform,
            displayName: input.displayName?.trim() || (platform === "telegram" ? "Telegram (требуется настройка)" : "VK (требуется настройка)"),
            status: "requires_setup",
            capabilities: {
              create: { name: "publish_text", enabled: platform === "telegram" },
            },
          },
          include: accountInclude,
        });
        await tx.auditLog.create({
          data: {
            action: "CREATE_SOCIAL_ACCOUNT",
            entityType: "social_account",
            entityId: created.id,
            actorId: userId,
            details: `${platform}:requires_setup`,
          },
        });
        return created;
      });
      return toPublic(account);
    },

    async connectTelegram(
      userId: string,
      workspaceId: string,
      input: { token: string; chatId: string; displayName?: string; projectId?: string; accountId?: string; password?: string },
    ) {
      await access.requirePermission(userId, workspaceId, "social.connect");
      rejectPassword(input);

      const token = input.token.trim();
      const chatId = input.chatId.trim();
      if (!token || !chatId) {
        throw new AccessError(400, "Нужны токен бота от @BotFather и chat_id канала или чата.");
      }
      if (!isTelegramBotToken(token)) {
        throw new AccessError(
          400,
          "Это не токен Telegram Bot API. Пароль аккаунта не принимается. Получите токен у @BotFather.",
        );
      }
      if (input.projectId) {
        const project = await db.project.findUnique({ where: { id: input.projectId } });
        assertWorkspaceBound(workspaceId, project, "Проект");
      }

      const me = await telegram.request(token, "getMe");
      if (!me.ok) {
        throw new AccessError(400, `Telegram отклонил токен: ${me.description}`);
      }
      const bot = me.result as TelegramUser;
      const chat = await telegram.request(token, "getChat", { chat_id: chatId });
      if (!chat.ok) {
        throw new AccessError(400, `Telegram не подтвердил чат: ${chat.description}`);
      }
      const chatInfo = chat.result as TelegramChat;
      const encryptedToken = encryptToken(token);
      const displayName =
        input.displayName?.trim() ||
        (bot.username ? `@${bot.username}` : bot.first_name) ||
        chatInfo.title ||
        "Telegram";
      const externalId = String(chatInfo.id ?? chatId);

      const account = await db.$transaction(async (tx) => {
        let saved;
        if (input.accountId) {
          const existing = await tx.socialAccount.findUnique({ where: { id: input.accountId } });
          assertWorkspaceBound(workspaceId, existing, "Социальный аккаунт");
          if (existing.platform !== "telegram") {
            throw new AccessError(400, "Этот аккаунт не Telegram.");
          }
          saved = await tx.socialAccount.update({
            where: { id: existing.id },
            data: {
              projectId: input.projectId || existing.projectId,
              displayName,
              externalId,
              status: "connected",
              encryptedToken,
              lastError: null,
            },
            include: accountInclude,
          });
        } else {
          await lockWorkspaceMetric(tx, workspaceId, "social_accounts");
          const limits = await getWorkspacePlanLimits(tx, workspaceId);
          const used = await tx.socialAccount.count({
            where: { workspaceId, status: { not: "disconnected" } },
          });
          if (used >= limits.socialAccounts) {
            throw new AccessError(400, `Лимит социальных аккаунтов тарифа исчерпан (${limits.socialAccounts}).`);
          }
          saved = await tx.socialAccount.create({
            data: {
              workspaceId,
              projectId: input.projectId || null,
              platform: "telegram",
              displayName,
              externalId,
              status: "connected",
              encryptedToken,
            },
            include: accountInclude,
          });
        }

        await tx.socialAccountCapability.upsert({
          where: { socialAccountId_name: { socialAccountId: saved.id, name: "publish_text" } },
          update: { enabled: true },
          create: { socialAccountId: saved.id, name: "publish_text", enabled: true },
        });
        await tx.postTarget.updateMany({
          where: { workspaceId, platform: "telegram", socialAccountId: null },
          data: { socialAccountId: saved.id },
        });
        await tx.auditLog.create({
          data: {
            action: "CONNECT_SOCIAL_ACCOUNT",
            entityType: "social_account",
            entityId: saved.id,
            actorId: userId,
            details: `telegram:${externalId}`,
          },
        });
        return tx.socialAccount.findUniqueOrThrow({ where: { id: saved.id }, include: accountInclude });
      });

      return toPublic(account);
    },

    async disconnect(userId: string, workspaceId: string, accountId: string) {
      await access.requirePermission(userId, workspaceId, "social.connect");
      const account = await loadBoundAccount(workspaceId, accountId);
      const updated = await db.socialAccount.update({
        where: { id: account.id },
        data: {
          status: "disconnected",
          encryptedToken: null,
          lastError: null,
        },
        include: accountInclude,
      });
      await db.auditLog.create({
        data: {
          action: "DISCONNECT_SOCIAL_ACCOUNT",
          entityType: "social_account",
          entityId: account.id,
          actorId: userId,
          details: account.platform,
        },
      });
      return toPublic(updated);
    },
  };
}
