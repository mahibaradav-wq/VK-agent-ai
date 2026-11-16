import type { Prisma, PrismaClient } from "@prisma/client";

import { AccessError, assertWorkspaceBound } from "@/modules/access/permissions";
import { createAccessService } from "@/modules/access/access-service";
import { getWorkspacePlanLimits } from "@/modules/billing/plans";
import { lockWorkspaceMetric } from "@/modules/billing/usage";
import { decryptToken, encryptToken } from "@/server/crypto/token-cipher";
import { FIRST_SOCIAL_PLATFORM } from "@/modules/social/catalog";
import { parseTelegramChatSource } from "@/modules/social/telegram-chat";
import { parseVkCommunitySource } from "@/modules/watch/parse";
import {
  createTelegramTransport,
  isTelegramBotToken,
  type TelegramChat,
  type TelegramTransport,
  type TelegramUser,
} from "@/server/social/telegram-api";
import {
  createVkTransport,
  describeVkApiError,
  extractVkGroup,
  isVkAccessToken,
  packVkTokens,
  type VkTransport,
} from "@/server/social/vk-api";

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
    vk?: VkTransport;
  },
) {
  const access = createAccessService(db);
  const telegram = options?.telegram ?? createTelegramTransport();
  const vk = options?.vk ?? createVkTransport();

  async function assertBotAdminsChat(token: string, botId: number, chatSource: string) {
    const chatId = parseTelegramChatSource(chatSource);
    const chat = await telegram.request(token, "getChat", { chat_id: chatId });
    if (!chat.ok) {
      throw new AccessError(
        400,
        chat.error_code === 0
          ? `С этого сервера нет сети до Telegram: ${chat.description}`
          : `Telegram не подтвердил канал: ${chat.description}`,
      );
    }
    const info = chat.result as TelegramChat;
    const member = await telegram.request(token, "getChatMember", {
      chat_id: info.id ?? chatId,
      user_id: botId,
    });
    if (!member.ok) {
      throw new AccessError(
        400,
        member.error_code === 0
          ? `С этого сервера нет сети до Telegram: ${member.description}`
          : `Бот не виден в канале ${chatId}: ${member.description}`,
      );
    }
    const status = (member.result as { status?: string }).status;
    if (status !== "administrator" && status !== "creator") {
      throw new AccessError(
        400,
        `Бот не администратор канала ${chatId}. Добавьте его администратором с правом публиковать сообщения.`,
      );
    }
    return {
      externalId: String(info.id ?? chatId),
      title: info.title?.trim() || "",
      username: info.username?.trim() || "",
    };
  }

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
      input: { token: string; chatId?: string; displayName?: string; projectId?: string; accountId?: string; password?: string },
    ) {
      await access.requirePermission(userId, workspaceId, "social.connect");
      rejectPassword(input);

      const token = input.token.trim();
      const chatId = input.chatId?.trim() ?? "";
      if (!token) {
        throw new AccessError(400, "Нужен токен бота от @BotFather.");
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
        throw new AccessError(
          400,
          me.error_code === 0
            ? `С этого сервера нет сети до Telegram: ${me.description}`
            : `Telegram отклонил токен: ${me.description}`,
        );
      }
      const bot = me.result as TelegramUser;
      const destination = chatId ? await assertBotAdminsChat(token, bot.id, chatId) : null;
      const encryptedToken = encryptToken(token);
      const displayName =
        input.displayName?.trim() ||
        destination?.title ||
        (destination?.username ? `@${destination.username}` : "") ||
        (bot.username ? `@${bot.username}` : bot.first_name) ||
        "Telegram";
      const externalId = destination?.externalId ?? "";
      const lastError = externalId
        ? null
        : "Бот подключён. У бота нет своей ленты — укажите канал t.me/dom_po_polochkam, куда он может писать.";

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
              lastError,
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
              lastError,
            },
            include: accountInclude,
          });
        }

        await tx.socialAccountCapability.upsert({
          where: { socialAccountId_name: { socialAccountId: saved.id, name: "publish_text" } },
          update: { enabled: true },
          create: { socialAccountId: saved.id, name: "publish_text", enabled: true },
        });
        if (externalId) {
          await tx.socialAccountCapability.upsert({
            where: { socialAccountId_name: { socialAccountId: saved.id, name: "publish_media" } },
            update: { enabled: true },
            create: { socialAccountId: saved.id, name: "publish_media", enabled: true },
          });
        }
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

    async bindTelegramChannel(
      userId: string,
      workspaceId: string,
      input: { accountId: string; chatId: string; projectId?: string; password?: string },
    ) {
      await access.requirePermission(userId, workspaceId, "social.connect");
      rejectPassword(input);
      const account = await loadBoundAccount(workspaceId, input.accountId);
      if (account.platform !== "telegram") {
        throw new AccessError(400, "Этот аккаунт не Telegram.");
      }
      if (account.status !== "connected" || !account.encryptedToken) {
        throw new AccessError(400, "Сначала подключите бота токеном от @BotFather.");
      }
      if (input.projectId) {
        const project = await db.project.findUnique({ where: { id: input.projectId } });
        assertWorkspaceBound(workspaceId, project, "Проект");
      }

      let token: string;
      try {
        token = decryptToken(account.encryptedToken);
      } catch {
        throw new AccessError(400, "Токен бота не удалось расшифровать. Подключите аккаунт заново.");
      }

      const me = await telegram.request(token, "getMe");
      if (!me.ok) {
        if (me.error_code === 401) {
          await db.socialAccount.update({
            where: { id: account.id },
            data: { status: "token_expired", lastError: me.description },
          });
        }
        throw new AccessError(
          400,
          me.error_code === 0
            ? `С этого сервера нет сети до Telegram: ${me.description}`
            : `Telegram отклонил токен: ${me.description}`,
        );
      }
      const bot = me.result as TelegramUser;
      const destination = await assertBotAdminsChat(token, bot.id, input.chatId);
      const displayName =
        destination.title ||
        (destination.username ? `@${destination.username}` : account.displayName);

      const saved = await db.$transaction(async (tx) => {
        const updated = await tx.socialAccount.update({
          where: { id: account.id },
          data: {
            projectId: input.projectId || account.projectId,
            displayName,
            externalId: destination.externalId,
            status: "connected",
            lastError: null,
          },
          include: accountInclude,
        });
        await tx.socialAccountCapability.upsert({
          where: { socialAccountId_name: { socialAccountId: updated.id, name: "publish_text" } },
          update: { enabled: true },
          create: { socialAccountId: updated.id, name: "publish_text", enabled: true },
        });
        await tx.socialAccountCapability.upsert({
          where: { socialAccountId_name: { socialAccountId: updated.id, name: "publish_media" } },
          update: { enabled: true },
          create: { socialAccountId: updated.id, name: "publish_media", enabled: true },
        });
        await tx.postTarget.updateMany({
          where: { workspaceId, platform: "telegram", socialAccountId: null },
          data: { socialAccountId: updated.id },
        });
        await tx.auditLog.create({
          data: {
            action: "BIND_TELEGRAM_CHANNEL",
            entityType: "social_account",
            entityId: updated.id,
            actorId: userId,
            details: `telegram:${destination.externalId}`,
          },
        });
        return tx.socialAccount.findUniqueOrThrow({ where: { id: updated.id }, include: accountInclude });
      });
      return toPublic(saved);
    },

    async connectVk(
      userId: string,
      workspaceId: string,
      input: {
        token: string;
        photoToken?: string;
        source: string;
        displayName?: string;
        projectId?: string;
        accountId?: string;
        password?: string;
      },
    ) {
      await access.requirePermission(userId, workspaceId, "social.connect");
      rejectPassword(input);

      const token = input.token.trim();
      if (!token) {
        throw new AccessError(400, "Нужен ключ доступа сообщества ВКонтакте с правом «Стена».");
      }
      if (!isVkAccessToken(token)) {
        throw new AccessError(
          400,
          "Это не ключ VK API. Пароль аккаунта не принимается. Нужен ключ сообщества из «Работа с API», не сервисный ключ приложения.",
        );
      }
      const parsed = parseVkCommunitySource(input.source);
      if (input.projectId) {
        const project = await db.project.findUnique({ where: { id: input.projectId } });
        assertWorkspaceBound(workspaceId, project, "Проект");
      }

      const club = /^(club|public|event)(\d+)$/i.exec(parsed.screenName);
      const groupLookup = club?.[2] ?? parsed.screenName;
      const groupResult = await vk.call(token, "groups.getById", {
        group_id: groupLookup,
        fields: "name,screen_name",
      });
      const group = groupResult.ok ? extractVkGroup(groupResult.response) : null;
      if (!group?.id) {
        throw new AccessError(
          400,
          groupResult.ok
            ? "Не удалось определить сообщество по ссылке. Укажите vk.com/club… того клуба, чей ключ вы вставляете."
            : describeVkApiError(groupResult),
        );
      }

      const ownerId = -Math.abs(group.id);
      const probe = await vk.call(token, "wall.post", {
        owner_id: ownerId,
        from_group: 1,
        message: "",
        guid: `probe:${workspaceId}:${group.id}`,
      });
      if (probe.ok) {
        const posted = probe.response as { post_id?: number } | number;
        const postId = typeof posted === "number" ? posted : posted?.post_id;
        if (postId) {
          await vk.call(token, "wall.delete", { owner_id: ownerId, post_id: postId });
        }
      } else if (probe.error_code !== 100) {
        throw new AccessError(
          400,
          probe.error_code === 15 || probe.error_code === 27 || probe.error_code === 214
            ? "Этот ключ не умеет писать на стену. В настройках сообщества создайте ключ с правом «Стена». Сервисный ключ приложения только читает."
            : describeVkApiError(probe),
        );
      }

      const photoToken = input.photoToken?.trim() ?? "";
      if (photoToken) {
        if (!isVkAccessToken(photoToken)) {
          throw new AccessError(
            400,
            "Пользовательский ключ для фото — это ключ VK API админа клуба, не пароль и не ключ сообщества.",
          );
        }
        const photoProbe = await vk.call(photoToken, "photos.getWallUploadServer", { group_id: group.id });
        if (!photoProbe.ok && photoProbe.error_code !== 0) {
          throw new AccessError(
            400,
            photoProbe.error_code === 27 || photoProbe.error_code === 15 || photoProbe.error_code === 200
              ? "Этот пользовательский ключ не умеет грузить фото на стену клуба. Нужен ключ админа с правом «Фотографии»."
              : describeVkApiError(photoProbe),
          );
        }
      }

      const encryptedToken = encryptToken(packVkTokens(token, photoToken));
      const displayName = input.displayName?.trim() || group.name?.trim() || parsed.screenName;
      const externalId = String(group.id);

      const account = await db.$transaction(async (tx) => {
        let saved;
        if (input.accountId) {
          const existing = await tx.socialAccount.findUnique({ where: { id: input.accountId } });
          assertWorkspaceBound(workspaceId, existing, "Социальный аккаунт");
          if (existing.platform !== "vk") {
            throw new AccessError(400, "Этот аккаунт не ВКонтакте.");
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
              platform: "vk",
              displayName,
              externalId,
              status: "connected",
              encryptedToken,
              lastError: null,
            },
            include: accountInclude,
          });
        }

        await tx.socialAccountCapability.upsert({
          where: { socialAccountId_name: { socialAccountId: saved.id, name: "publish_text" } },
          update: { enabled: true },
          create: { socialAccountId: saved.id, name: "publish_text", enabled: true },
        });
        await tx.socialAccountCapability.upsert({
          where: { socialAccountId_name: { socialAccountId: saved.id, name: "publish_media" } },
          update: { enabled: true },
          create: { socialAccountId: saved.id, name: "publish_media", enabled: true },
        });
        await tx.socialAccountCapability.upsert({
          where: { socialAccountId_name: { socialAccountId: saved.id, name: "publish_carousel" } },
          update: { enabled: Boolean(photoToken) },
          create: { socialAccountId: saved.id, name: "publish_carousel", enabled: Boolean(photoToken) },
        });
        await tx.postTarget.updateMany({
          where: { workspaceId, platform: "vk", socialAccountId: null },
          data: { socialAccountId: saved.id },
        });
        await tx.auditLog.create({
          data: {
            action: "CONNECT_SOCIAL_ACCOUNT",
            entityType: "social_account",
            entityId: saved.id,
            actorId: userId,
            details: `vk:${externalId}`,
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
