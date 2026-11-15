import type { PrismaClient } from "@prisma/client";

import { AccessError, assertWorkspaceBound } from "@/modules/access/permissions";
import { createAccessService } from "@/modules/access/access-service";
import { createAiService, type PublicAiRequest } from "@/modules/ai/ai-service";
import { parseVkCommunitySource } from "@/modules/watch/parse";
import { RECOMMENDED_WATCH_COMMUNITIES } from "@/modules/watch/recommended";
import { decryptToken, encryptToken } from "@/server/crypto/token-cipher";
import {
  createVkTransport,
  describeVkApiError,
  extractVkGroup,
  isVkAccessToken,
  type VkResolvedScreenName,
  type VkTransport,
  type VkWallPost,
  type VkWallResponse,
} from "@/server/social/vk-api";

export const WATCH_IDEAS_KIND = "watch_ideas";
const MAX_COMMUNITIES = 25;
const POSTS_PER_COMMUNITY = 4;
const MAX_IDEA_POSTS = 40;

export type PublicWatchCommunity = {
  id: string;
  source: string;
  screenName: string;
  externalId: string;
  displayName: string;
  lastFetchedAt: Date | null;
  lastError: string | null;
};

export type PublicWatchCredential = {
  connected: boolean;
  status: string;
  lastError: string | null;
};

export type WatchedPost = {
  community: string;
  postId: string;
  date: string;
  text: string;
  likes?: number;
  comments?: number;
  views?: number;
};

function rejectPassword(input: { password?: string; vkPassword?: string }) {
  if (input.password?.trim() || input.vkPassword?.trim()) {
    throw new AccessError(400, "Пароль ВКонтакте не принимается. Нужен официальный ключ VK API.");
  }
}

function toPublicCommunity(row: {
  id: string;
  source: string;
  screenName: string;
  externalId: string;
  displayName: string;
  lastFetchedAt: Date | null;
  lastError: string | null;
}): PublicWatchCommunity {
  return {
    id: row.id,
    source: row.source,
    screenName: row.screenName,
    externalId: row.externalId,
    displayName: row.displayName,
    lastFetchedAt: row.lastFetchedAt,
    lastError: row.lastError,
  };
}

function wallOwnerId(externalId: string) {
  const numeric = Number(externalId);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return null;
  }
  return numeric > 0 ? -numeric : numeric;
}

async function mapPool<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 0 }, () => worker()));
  return results;
}

function summarizePosts(posts: WatchedPost[]) {
  return posts
    .map((post) => {
      const stats = [
        post.likes != null ? `лайки ${post.likes}` : "",
        post.comments != null ? `комментарии ${post.comments}` : "",
        post.views != null ? `просмотры ${post.views}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      return `[${post.community} · ${post.date}${stats ? ` · ${stats}` : ""}]\n${post.text}`;
    })
    .join("\n\n---\n\n");
}

export function ideaToAgentPrompt(item: string) {
  const [titlePart, why, hook] = item.split("||").map((part) => part.trim());
  const title = titlePart || "Идея из VK";
  return [
    "Напиши готовый пост на стену ВКонтакте для сообщества «Дом по полочкам».",
    "Это бриф идеи, а не готовый текст: раскрой тему своими словами.",
    "Не копируй чужие посты, не обещай скидки, охваты и что материал уже опубликован.",
    `Тема: ${title}`,
    why ? `Почему сейчас: ${why}` : "",
    hook ? `Хук первой строки: ${hook}` : "",
    `Исходная идея: ${item}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function createWatchService(
  db: PrismaClient,
  options?: {
    vk?: VkTransport;
    ai?: ReturnType<typeof createAiService>;
    now?: () => Date;
  },
) {
  const access = createAccessService(db);
  const vk = options?.vk ?? createVkTransport();
  const ai = options?.ai ?? createAiService(db);
  const now = options?.now ?? (() => new Date());
  const paceVk = !options?.vk;

  async function requireToken(workspaceId: string) {
    const row = await db.vkWatchCredential.findUnique({ where: { workspaceId } });
    if (!row?.encryptedToken) {
      throw new AccessError(
        400,
        "Сначала ключ VK API для чтения стен: сервисный ключ приложения или ключ сообщества. Пароль VK не принимается, публикация во ВК от этого не включается.",
      );
    }
    return { row, token: decryptToken(row.encryptedToken) };
  }

  async function resolveCommunity(token: string, screenName: string) {
    const resolved = await vk.call(token, "groups.getById", { group_id: screenName });
    if (resolved.ok) {
      const group = extractVkGroup(resolved.response);
      if (group?.id && (group.type === "group" || group.type === "page" || group.type === "event" || !group.type)) {
        return {
          type: group.type === "event" ? "event" : group.type === "page" ? "page" : "group",
          object_id: group.id,
          name: group.name,
          screen_name: group.screen_name,
        } satisfies VkResolvedScreenName;
      }
    }
    const fallback = /^(club|public|event)(\d+)$/i.exec(screenName);
    if (fallback) {
      return {
        type: fallback[1] === "event" ? "event" : fallback[1] === "public" ? "page" : "group",
        object_id: Number(fallback[2]),
      } satisfies VkResolvedScreenName;
    }
    throw new AccessError(400, resolved.ok ? "Это не сообщество и не публичная страница ВКонтакте." : describeVkApiError(resolved));
  }

  async function fetchWall(token: string, ownerId: number) {
    const result = await vk.call(token, "wall.get", {
      owner_id: ownerId,
      count: POSTS_PER_COMMUNITY,
      filter: "owner",
    });
    if (!result.ok) {
      return { ok: false as const, error: describeVkApiError(result), posts: [] as WatchedPost[] };
    }
    const wall = (result.response ?? {}) as VkWallResponse;
    const posts = (wall.items ?? [])
      .filter((item): item is VkWallPost => Boolean(item?.text?.trim()))
      .map((item) => ({
        community: String(ownerId),
        postId: `${item.owner_id}_${item.id}`,
        date: item.date ? new Date(item.date * 1000).toISOString().slice(0, 10) : "",
        text: (item.text ?? "").trim().slice(0, 800),
        likes: item.likes?.count,
        comments: item.comments?.count,
        views: item.views?.count,
      }));
    return { ok: true as const, posts };
  }

  return {
    async credential(userId: string, workspaceId: string): Promise<PublicWatchCredential> {
      await access.requirePermission(userId, workspaceId, "ai.view");
      const row = await db.vkWatchCredential.findUnique({ where: { workspaceId } });
      return {
        connected: Boolean(row?.encryptedToken),
        status: row?.status ?? "requires_setup",
        lastError: row?.lastError ?? null,
      };
    },

    async listCommunities(userId: string, workspaceId: string) {
      await access.requirePermission(userId, workspaceId, "ai.view");
      const rows = await db.vkWatchCommunity.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "desc" },
      });
      return rows.map(toPublicCommunity);
    },

    async connectToken(
      userId: string,
      workspaceId: string,
      input: { token: string; password?: string; vkPassword?: string },
    ) {
      await access.requirePermission(userId, workspaceId, "social.connect");
      rejectPassword(input);
      const token = input.token.trim();
      if (!isVkAccessToken(token)) {
        throw new AccessError(
          400,
          "Это не ключ VK API. Пароль аккаунта не принимается. Нужен сервисный ключ приложения из карточки VK ID, не защищённый ключ и не код виджета входа.",
        );
      }
      const probe = await vk.call(token, "wall.get", { owner_id: -1, count: 1, filter: "owner" });
      if (!probe.ok && probe.error_code === 0) {
        throw new AccessError(400, probe.error_msg);
      }
      if (!probe.ok && (probe.error_code === 5 || probe.error_code === 15)) {
        throw new AccessError(400, describeVkApiError(probe));
      }
      const encryptedToken = encryptToken(token);
      const saved = await db.vkWatchCredential.upsert({
        where: { workspaceId },
        create: {
          workspaceId,
          encryptedToken,
          status: "connected",
          lastError: probe.ok ? null : describeVkApiError(probe),
          connectedById: userId,
        },
        update: {
          encryptedToken,
          status: "connected",
          lastError: probe.ok ? null : describeVkApiError(probe),
          connectedById: userId,
        },
      });
      await db.auditLog.create({
        data: {
          action: "CONNECT_VK_WATCH",
          entityType: "vk_watch_credential",
          entityId: saved.id,
          actorId: userId,
          details: workspaceId,
        },
      });
      return { connected: true, status: saved.status, lastError: saved.lastError };
    },

    async disconnectToken(userId: string, workspaceId: string) {
      await access.requirePermission(userId, workspaceId, "social.connect");
      await db.vkWatchCredential.deleteMany({ where: { workspaceId } });
      await db.auditLog.create({
        data: {
          action: "DISCONNECT_VK_WATCH",
          entityType: "workspace",
          entityId: workspaceId,
          actorId: userId,
          details: "vk_watch",
        },
      });
    },

    async addCommunity(userId: string, workspaceId: string, raw: string) {
      await access.requirePermission(userId, workspaceId, "ai.generate");
      const parsed = parseVkCommunitySource(raw);
      const existingCount = await db.vkWatchCommunity.count({ where: { workspaceId } });
      if (existingCount >= MAX_COMMUNITIES) {
        throw new AccessError(400, `Можно смотреть не больше ${MAX_COMMUNITIES} сообществ.`);
      }
      const { token } = await requireToken(workspaceId);
      const resolved = await resolveCommunity(token, parsed.screenName);
      const externalId = String(resolved.object_id);
      const ownerId = wallOwnerId(externalId);
      let lastError: string | null = null;
      if (ownerId) {
        const wall = await fetchWall(token, ownerId);
        if (!wall.ok) {
          lastError = wall.error;
        }
      }
      try {
        const created = await db.vkWatchCommunity.create({
          data: {
            workspaceId,
            source: parsed.source,
            screenName: parsed.screenName,
            externalId,
            displayName: resolved.name?.trim() || resolved.screen_name || parsed.screenName,
            lastError,
            lastFetchedAt: lastError ? null : now(),
          },
        });
        await db.auditLog.create({
          data: {
            action: "ADD_VK_WATCH_COMMUNITY",
            entityType: "vk_watch_community",
            entityId: created.id,
            actorId: userId,
            details: parsed.screenName,
          },
        });
        return toPublicCommunity(created);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
          throw new AccessError(400, "Это сообщество уже в списке наблюдения.");
        }
        throw error;
      }
    },

    async addRecommended(userId: string, workspaceId: string) {
      const added: PublicWatchCommunity[] = [];
      const skipped: { source: string; message: string }[] = [];
      for (const item of RECOMMENDED_WATCH_COMMUNITIES) {
        try {
          added.push(await this.addCommunity(userId, workspaceId, item.source));
          if (paceVk) {
            await new Promise((resolve) => setTimeout(resolve, 350));
          }
        } catch (error) {
          skipped.push({
            source: item.source,
            message: error instanceof AccessError ? error.message : "Не удалось добавить сообщество.",
          });
        }
      }
      return { added, skipped };
    },

    async removeCommunity(userId: string, workspaceId: string, communityId: string) {
      await access.requirePermission(userId, workspaceId, "ai.generate");
      const row = await db.vkWatchCommunity.findUnique({ where: { id: communityId } });
      assertWorkspaceBound(workspaceId, row, "Сообщество");
      await db.vkWatchCommunity.delete({ where: { id: communityId } });
    },

    async collectIdeas(
      userId: string,
      workspaceId: string,
      input: { brief?: string; projectId?: string },
    ): Promise<{ request: PublicAiRequest; posts: WatchedPost[] }> {
      await access.requirePermission(userId, workspaceId, "ai.generate");
      const { token } = await requireToken(workspaceId);
      const communities = await db.vkWatchCommunity.findMany({ where: { workspaceId } });
      if (communities.length === 0) {
        throw new AccessError(400, "Добавьте хотя бы одно сообщество ВКонтакте для наблюдения.");
      }
      if (input.projectId) {
        const project = await db.project.findUnique({ where: { id: input.projectId } });
        assertWorkspaceBound(workspaceId, project, "Проект");
      }

      const fetched = await mapPool(communities, 4, async (community) => {
        const ownerId = wallOwnerId(community.externalId);
        if (!ownerId) {
          return { community, ownerId: null, wall: null as Awaited<ReturnType<typeof fetchWall>> | null };
        }
        return { community, ownerId, wall: await fetchWall(token, ownerId) };
      });

      const posts: WatchedPost[] = [];
      for (const item of fetched) {
        const community = item.community;
        if (!item.ownerId) {
          await db.vkWatchCommunity.update({
            where: { id: community.id },
            data: { lastError: "Не удалось определить id сообщества." },
          });
          continue;
        }
        const wall = item.wall;
        if (!wall?.ok) {
          await db.vkWatchCommunity.update({
            where: { id: community.id },
            data: { lastError: wall?.error ?? "Стена не прочитана.", lastFetchedAt: now() },
          });
          continue;
        }
        const labeled = wall.posts.map((post) => ({ ...post, community: community.displayName || community.screenName }));
        posts.push(...labeled);
        await db.vkWatchSnapshot.create({
          data: {
            communityId: community.id,
            fetchedAt: now(),
            postsJson: JSON.stringify(labeled),
          },
        });
        await db.vkWatchCommunity.update({
          where: { id: community.id },
          data: { lastError: labeled.length ? null : "На стене нет текстовых постов.", lastFetchedAt: now() },
        });
      }

      posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      const ideaPosts = posts.slice(0, MAX_IDEA_POSTS);

      if (ideaPosts.length === 0) {
        throw new AccessError(
          400,
          "Не удалось прочитать посты ни у одного сообщества. Ключ не подходит, стена закрыта, или сеть до api.vk.ru недоступна. Идеи не выдумываются.",
        );
      }

      const workspace = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
      const brief = input.brief?.trim() || `Бренд: ${workspace.name}. Организация хранения, дом и кухня.`;
      const prompt = [
        `Бриф бренда:\n${brief}`,
        "Недавние посты чужих сообществ ВКонтакте (не копировать, а предложить свои темы для нашей стены ВК):",
        summarizePosts(ideaPosts),
        "Предложи 6 оригинальных идей постов на стену ВКонтакте для сообщества «Дом по полочкам».",
        "Каждый item: «Заголовок || Почему сейчас || Хук первой строки».",
        "Пиши как пост ВК, не как пост Telegram. Не выдумывай охват и не обещай, что пост уже опубликован.",
      ].join("\n\n");

      const generated = await ai.generate(userId, workspaceId, {
        kind: "ideas",
        prompt,
        tone: "friendly",
        length: "medium",
        platform: "vk",
        projectId: input.projectId,
      });
      if (generated.items.length === 0 && !generated.body.trim()) {
        throw new AccessError(400, "Модель не предложила идей по этим постам. Ответ не подменяется заготовкой.");
      }
      const row = await db.aIRequest.update({
        where: { id: generated.id },
        data: {
          kind: WATCH_IDEAS_KIND,
          title: "Идеи постов ВКонтакте",
          itemsJson: JSON.stringify(generated.items),
        },
      });
      await db.auditLog.create({
        data: {
          action: "COLLECT_VK_WATCH_IDEAS",
          entityType: "ai_request",
          entityId: row.id,
          actorId: userId,
          details: `${communities.length} communities, ${ideaPosts.length} posts`,
        },
      });
      return {
        request: {
          ...generated,
          id: row.id,
          kind: row.kind,
          title: row.title,
        },
        posts: ideaPosts,
      };
    },

    async applyIdea(userId: string, workspaceId: string, requestId: string, itemIndex: number, projectId: string) {
      await access.requirePermission(userId, workspaceId, "post.create");
      const request = await db.aIRequest.findUnique({ where: { id: requestId } });
      assertWorkspaceBound(workspaceId, request, "AI-запрос");
      if (request.kind !== WATCH_IDEAS_KIND) {
        throw new AccessError(400, "Это не идеи агента наблюдения VK.");
      }
      const project = await db.project.findUnique({ where: { id: projectId } });
      assertWorkspaceBound(workspaceId, project, "Проект");
      let items: string[] = [];
      try {
        const parsed = JSON.parse(request.itemsJson) as unknown;
        if (Array.isArray(parsed)) {
          items = parsed.filter((item): item is string => typeof item === "string");
        }
      } catch {
        items = [];
      }
      const item = items[itemIndex]?.trim();
      if (!item) {
        throw new AccessError(400, "Идея не найдена.");
      }
      const composed = await ai.composeAgentPost(userId, workspaceId, {
        prompt: ideaToAgentPrompt(item),
        tone: "friendly",
        length: "medium",
        platform: "vk",
        projectId,
      });
      const remaining = items.filter((_, index) => index !== itemIndex);
      await db.aIRequest.update({
        where: { id: request.id },
        data: { itemsJson: JSON.stringify(remaining) },
      });
      await db.auditLog.create({
        data: {
          action: "APPLY_VK_WATCH_IDEA",
          entityType: "post",
          entityId: composed.post.id,
          actorId: userId,
          details: `${requestId}:${itemIndex}:${composed.mediaId}`,
        },
      });
      return composed.post;
    },

    async listIdeas(userId: string, workspaceId: string) {
      await access.requirePermission(userId, workspaceId, "ai.view");
      const rows = await db.aIRequest.findMany({
        where: { workspaceId, kind: WATCH_IDEAS_KIND },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      return rows
        .map((row) => {
          let items: string[] = [];
          try {
            const parsed = JSON.parse(row.itemsJson) as unknown;
            if (Array.isArray(parsed)) {
              items = parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
            }
          } catch {
            items = [];
          }
          return {
            id: row.id,
            title: row.title,
            body: row.body,
            items,
            createdAt: row.createdAt,
            provider: row.provider,
            model: row.model,
          };
        })
        .filter((row) => row.items.length > 0);
    },
  };
}
