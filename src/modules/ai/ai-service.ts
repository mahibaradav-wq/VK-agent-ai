import type { PrismaClient } from "@prisma/client";

import { AccessError, assertWorkspaceBound } from "@/modules/access/permissions";
import { OPENAI_IMAGE_REGION_MESSAGE, OPENAI_REGION_MESSAGE, isOpenAiRegionError } from "@/server/ai/errors";
import { createAccessService } from "@/modules/access/access-service";
import { parseKind, parseLength, parseTone } from "@/modules/ai/kinds";
import {
  agentUsageUnits,
  imageSizeForAspect,
  parseCarouselCount,
  parseVisualAspect,
  parseVisualKind,
  prepareVisualPrompt,
  slideVisualPrompt,
} from "@/modules/ai/visual";
import { createAiConnectionService } from "@/modules/ai/provider-service";
import { getWorkspacePlanLimits } from "@/modules/billing/plans";
import { getUsage, releaseUsage, reserveUsage, USAGE_METRICS } from "@/modules/billing/usage";
import { createMediaService } from "@/modules/media/media-service";
import { parsePlatforms } from "@/modules/posts/platforms";
import { createPostService } from "@/modules/posts/post-service";
import { getAiProvider, type AiProvider } from "@/server/ai";
import { storage as defaultStorage } from "@/server/storage";
import type { StorageDriver } from "@/server/storage/types";

const AGENT_KIND = "agent";

const WATCH_IDEAS_KIND = "watch_ideas";

function visualItem(mediaId: string) {
  return `visual:${mediaId}`;
}

function postItem(postId: string) {
  return `post:${postId}`;
}

function parseVisualMediaIds(items: string[]) {
  return items
    .filter((item) => item.startsWith("visual:"))
    .map((item) => item.slice("visual:".length))
    .filter(Boolean);
}

function parseLinkedPostId(items: string[]) {
  const found = items.find((item) => item.startsWith("post:"));
  return found ? found.slice("post:".length) : "";
}

function extensionForMime(mime: string) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "png";
}

function visualPromptForCopy(input: {
  brief: string;
  title: string;
  body: string;
  visualKind: string;
  visualAspect: string;
  visualPrompt?: string;
}) {
  const prepared = input.visualPrompt?.trim();
  if (prepared) {
    return prepared;
  }
  return prepareVisualPrompt({
    brief: input.brief,
    kind: input.visualKind,
    aspect: input.visualAspect,
    title: input.title,
    body: input.body,
  });
}

const DEFAULT_MONTHLY_LIMIT = 50;

export type PublicAiRequest = {
  id: string;
  kind: string;
  prompt: string;
  tone: string;
  length: string;
  platform: string;
  title: string;
  body: string;
  items: string[];
  provider: string;
  model: string;
  createdAt: Date;
};

function toPublic(row: {
  id: string;
  kind: string;
  prompt: string;
  tone: string;
  length: string;
  platform: string;
  title: string;
  body: string;
  itemsJson: string;
  provider: string;
  model: string;
  createdAt: Date;
}): PublicAiRequest {
  let items: string[] = [];
  try {
    const parsed = JSON.parse(row.itemsJson) as unknown;
    if (Array.isArray(parsed)) {
      items = parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    items = [];
  }
  return {
    id: row.id,
    kind: row.kind,
    prompt: row.prompt,
    tone: row.tone,
    length: row.length,
    platform: row.platform,
    title: row.title,
    body: row.body,
    items,
    provider: row.provider,
    model: row.model,
    createdAt: row.createdAt,
  };
}

export function createAiService(
  db: PrismaClient,
  options?: {
    provider?: AiProvider;
    connections?: ReturnType<typeof createAiConnectionService>;
    storage?: StorageDriver;
    monthlyLimit?: number;
    now?: () => Date;
  },
) {
  const access = createAccessService(db);
  const posts = createPostService(db);
  const storageDriver = options?.storage ?? defaultStorage;
  const media = createMediaService(db, storageDriver);
  const connections = options?.connections ?? createAiConnectionService(db);
  const injected = options?.provider;
  const monthlyLimit = options?.monthlyLimit ?? Number(process.env.AI_MONTHLY_LIMIT ?? DEFAULT_MONTHLY_LIMIT);
  const now = options?.now ?? (() => new Date());

  async function providerFor(workspaceId: string, role: "ideas" | "copy" | "image" = "copy") {
    if (injected) {
      return injected;
    }
    return connections.resolveProvider(workspaceId, role);
  }

  async function callWithFallback<T>(
    workspaceId: string,
    role: "ideas" | "copy" | "image",
    fn: (provider: AiProvider) => Promise<T>,
  ): Promise<T> {
    if (injected) {
      return fn(injected);
    }
    const providers = await connections.listProviders(workspaceId, role);
    if (providers.length === 0) {
      const openaiBlocked = await connections.openaiRegionBlocked(workspaceId);
      if (role === "image") {
        throw new AccessError(400, openaiBlocked ? OPENAI_IMAGE_REGION_MESSAGE : "Для визуала подключите ChatGPT.");
      }
      throw new AccessError(
        400,
        openaiBlocked
          ? OPENAI_REGION_MESSAGE
          : role === "ideas"
            ? "Идеи недоступны: подключите ChatGPT. Это не ответ модели."
            : "Генерация текста недоступна: подключите ChatGPT. Это не ответ модели.",
      );
    }
    let last: unknown;
    for (const provider of providers) {
      try {
        return await fn(provider);
      } catch (error) {
        last = error;
        if (isOpenAiRegionError(error) && provider.name === "openai") {
          await connections.rememberError(
            workspaceId,
            "openai",
            error instanceof AccessError ? error.message : OPENAI_REGION_MESSAGE,
          );
          continue;
        }
        throw error;
      }
    }
    if (role === "image" && isOpenAiRegionError(last)) {
      throw new AccessError(400, OPENAI_IMAGE_REGION_MESSAGE);
    }
    throw last;
  }

  async function loadBoundRequest(workspaceId: string, requestId: string) {
    const row = await db.aIRequest.findUnique({ where: { id: requestId } });
    assertWorkspaceBound(workspaceId, row, "AI-запрос");
    return row;
  }

  async function resolveLimit(workspaceId: string) {
    if (options?.monthlyLimit != null) {
      return options.monthlyLimit;
    }
    try {
      return (await getWorkspacePlanLimits(db, workspaceId, now())).aiGenerations;
    } catch {
      return monthlyLimit;
    }
  }

  return {
    status() {
      const provider = injected ?? getAiProvider();
      return {
        ready: provider.ready,
        imageReady: provider.imageReady,
        storageReady: storageDriver.ready,
        provider: provider.name,
        model: provider.ready ? provider.model : "не настроен",
        imageModel: provider.imageReady ? provider.imageModel : "не настроен",
      };
    },

    async workspaceStatus(userId: string, workspaceId: string) {
      const workspace = await connections.get(userId, workspaceId);
      const copy = await providerFor(workspaceId, "copy");
      const image = await providerFor(workspaceId, "image");
      const ideas = await providerFor(workspaceId, "ideas");
      return {
        ready: copy.ready || ideas.ready,
        copyReady: copy.ready,
        imageReady: image.imageReady,
        storageReady: storageDriver.ready,
        provider: copy.name,
        model: copy.ready ? copy.model : "не настроен",
        imageModel: image.imageReady ? image.imageModel : "не настроен",
        ideasProvider: ideas.name,
        copyProvider: copy.name,
        imageProvider: image.name,
        connection: workspace.copy,
        connections: workspace.connections,
        roles: { ideas: workspace.ideas, copy: workspace.copy, image: workspace.image },
      };
    },

    async usage(userId: string, workspaceId: string) {
      await access.requirePermission(userId, workspaceId, "ai.view");
      const limit = await resolveLimit(workspaceId);
      return getUsage(db, workspaceId, USAGE_METRICS.ai, now(), limit);
    },

    async list(userId: string, workspaceId: string) {
      await access.requirePermission(userId, workspaceId, "ai.view");
      const rows = await db.aIRequest.findMany({
        where: { workspaceId, kind: { not: WATCH_IDEAS_KIND } },
        orderBy: { createdAt: "desc" },
        take: 30,
      });
      return rows.map(toPublic);
    },

    async generate(
      userId: string,
      workspaceId: string,
      input: { kind: string; prompt: string; tone?: string; length?: string; platform?: string; projectId?: string },
    ) {
      await access.requirePermission(userId, workspaceId, "ai.generate");
      const prompt = input.prompt.trim();
      if (prompt.length < 3) {
        throw new AccessError(400, "Опишите задачу минимум тремя символами.");
      }
      const kind = parseKind(input.kind);
      const tone = parseTone(input.tone ?? "");
      const length = parseLength(input.length ?? "");
      const platform = input.platform ? parsePlatforms([input.platform])[0] ?? "" : "";
      if (input.projectId) {
        const project = await db.project.findUnique({ where: { id: input.projectId } });
        assertWorkspaceBound(workspaceId, project, "Проект");
      }
      const role = kind === "ideas" ? "ideas" : "copy";
      const provider = await providerFor(workspaceId, role);
      if (!provider.ready) {
        const openaiBlocked = injected ? false : await connections.openaiRegionBlocked(workspaceId);
        throw new AccessError(
          400,
          openaiBlocked
            ? OPENAI_REGION_MESSAGE
            : role === "ideas"
              ? "Идеи недоступны: подключите ChatGPT. Это не ответ модели."
              : "Генерация текста недоступна: подключите ChatGPT. Это не ответ модели.",
        );
      }

      const at = now();
      const limit = await resolveLimit(workspaceId);
      const periodStart = await reserveUsage(
        db,
        workspaceId,
        USAGE_METRICS.ai,
        limit,
        at,
        `Лимит AI-генераций на месяц исчерпан (${limit}).`,
      );
      try {
        const generated = await callWithFallback(workspaceId, role, (item) =>
          item.generate({ kind, prompt, tone, length, platform }),
        );
        const row = await db.aIRequest.create({
          data: {
            workspaceId,
            projectId: input.projectId || null,
            userId,
            kind,
            prompt,
            tone,
            length,
            platform,
            title: generated.title,
            body: generated.body,
            itemsJson: JSON.stringify(generated.items),
            provider: generated.provider,
            model: generated.model,
            inputTokens: generated.inputTokens,
            outputTokens: generated.outputTokens,
          },
        });
        await db.auditLog.create({
          data: {
            action: "GENERATE_AI_REQUEST",
            entityType: "ai_request",
            entityId: row.id,
            actorId: userId,
            details: `${kind}:${generated.provider}`,
          },
        });
        return toPublic(row);
      } catch (error) {
        await releaseUsage(db, workspaceId, USAGE_METRICS.ai, periodStart);
        throw error;
      }
    },

    async applyToPost(userId: string, workspaceId: string, requestId: string, projectId: string) {
      await access.requirePermission(userId, workspaceId, "post.create");
      const request = await loadBoundRequest(workspaceId, requestId);
      if (request.kind === WATCH_IDEAS_KIND) {
        throw new AccessError(
          400,
          "Идею в пост отправляйте со страницы наблюдения VK кнопкой «В бриф: пост + визуал». Из истории текст не копируется.",
        );
      }
      const publicRequest = toPublic(request);
      const linkedPostId = parseLinkedPostId(publicRequest.items);
      if (request.kind === AGENT_KIND && linkedPostId) {
        try {
          return await posts.get(userId, workspaceId, linkedPostId);
        } catch {
          // Черновик удалили — ниже создадим новый из той же генерации.
        }
      }
      const platforms = request.platform ? [request.platform] : [];
      const created = await posts.create(userId, workspaceId, projectId, publicRequest.title);
      const body =
        publicRequest.body.trim() ||
        publicRequest.items.filter((item) => !item.startsWith("visual:")).join("\n") ||
        publicRequest.prompt;
      await posts.saveDraft(userId, workspaceId, created.id, {
        title: publicRequest.title.slice(0, 180) || "Черновик из AI",
        body,
        platforms,
        mediaIds: parseVisualMediaIds(publicRequest.items),
      });
      await db.auditLog.create({
        data: {
          action: "APPLY_AI_TO_POST",
          entityType: "post",
          entityId: created.id,
          actorId: userId,
          details: request.id,
        },
      });
      return posts.get(userId, workspaceId, created.id);
    },

    async checkVisualModels(userId: string, workspaceId: string) {
      await access.requirePermission(userId, workspaceId, "ai.generate");
      if (injected) {
        return {
          provider: injected.name,
          imageModel: injected.imageModel,
          reachable: injected.imageReady,
          inCatalog: injected.imageReady,
          message: injected.imageReady
            ? `Генератор ${injected.name} · ${injected.imageModel}. Каталог не запрашивался, генерация не запускалась.`
            : "Генератор картинок не подключён. Проверка каталога не запускает генерацию.",
        };
      }
      const probe = await connections.probeImageModels(userId, workspaceId);
      const catalogNote = probe.inCatalog
        ? `модель ${probe.imageModel} есть в каталоге`
        : `${probe.imageModel} в публичном каталоге может не отображаться`;
      return {
        provider: probe.provider,
        imageModel: probe.imageModel,
        reachable: probe.reachable,
        inCatalog: probe.inCatalog,
        message: `Каталог ${probe.label} ответил (${probe.modelCount} моделей): ${catalogNote}. Генерация не запускалась.`,
      };
    },

    async composeAgentPost(
      userId: string,
      workspaceId: string,
      input: {
        prompt: string;
        tone?: string;
        length?: string;
        platform?: string;
        projectId: string;
        visualKind?: string;
        visualAspect?: string;
        visualPrompt?: string;
        carouselCount?: string | number;
        shopProductId?: string;
      },
    ) {
      await access.requirePermission(userId, workspaceId, "ai.generate");
      const prompt = input.prompt.trim();
      if (prompt.length < 3) {
        throw new AccessError(400, "Опишите задачу минимум тремя символами.");
      }
      if (!input.projectId) {
        throw new AccessError(400, "Выберите проект, чтобы агент создал черновик с визуалом.");
      }
      const project = await db.project.findUnique({ where: { id: input.projectId } });
      assertWorkspaceBound(workspaceId, project, "Проект");

      const tone = parseTone(input.tone ?? "");
      const length = parseLength(input.length ?? "");
      const platform = input.platform ? parsePlatforms([input.platform])[0] ?? "" : "";
      const visualKind = parseVisualKind(input.visualKind ?? "image");
      const visualAspect = parseVisualAspect(input.visualAspect ?? "", visualKind);
      const slideCount = parseCarouselCount(input.carouselCount, visualKind);
      const usageUnits = agentUsageUnits(visualKind, slideCount);

      const copy = await providerFor(workspaceId, "copy");
      const imageProvider = await providerFor(workspaceId, "image");
      if (!copy.ready) {
        const openaiBlocked = injected ? false : await connections.openaiRegionBlocked(workspaceId);
        throw new AccessError(
          400,
          openaiBlocked
            ? OPENAI_REGION_MESSAGE
            : "Генерация поста недоступна: подключите ChatGPT. Это не ответ модели.",
        );
      }
      if (!imageProvider.imageReady) {
        const openaiBlocked = injected ? false : await connections.openaiRegionBlocked(workspaceId);
        throw new AccessError(
          400,
          openaiBlocked
            ? OPENAI_IMAGE_REGION_MESSAGE
            : "Для визуала подключите ChatGPT.",
        );
      }
      if (!storageDriver.ready) {
        throw new AccessError(
          400,
          storageDriver.setupMessage ?? "Хранилище не настроено. Визуал нельзя сохранить.",
        );
      }

      const at = now();
      const limit = await resolveLimit(workspaceId);
      const periodStart = await reserveUsage(
        db,
        workspaceId,
        USAGE_METRICS.ai,
        limit,
        at,
        visualKind === "carousel"
          ? `Агенту нужны ${usageUnits} генерации (текст и ${slideCount} карточек). Лимит AI на месяц исчерпан (${limit}).`
          : `Агенту нужны две генерации (текст и визуал). Лимит AI на месяц исчерпан (${limit}).`,
        usageUnits,
      );

      try {
        const generated = await callWithFallback(workspaceId, "copy", (item) =>
          item.generate({
            kind: "post",
            prompt,
            tone,
            length,
            platform,
          }),
        );
        const title = generated.title.trim() || "Черновик агента";
        const body = generated.body.trim() || prompt;
        const baseVisualPrompt = visualPromptForCopy({
          brief: prompt,
          title,
          body,
          visualKind,
          visualAspect,
          visualPrompt: input.visualPrompt,
        });
        const assets = [];
        let imageModel = "";
        for (let index = 0; index < slideCount; index += 1) {
          const image = await callWithFallback(workspaceId, "image", (item) =>
            item.generateImage({
              prompt: slideVisualPrompt(baseVisualPrompt, index, slideCount),
              size: imageSizeForAspect(visualAspect),
            }),
          );
          imageModel = image.model;
          assets.push(
            await media.upload(userId, workspaceId, {
              filename: `agent-visual-${index + 1}.${extensionForMime(image.mimeType)}`,
              declaredType: image.mimeType,
              bytes: image.bytes,
            }),
          );
        }
        const mediaIds = assets.map((asset) => asset.id);
        const coverId = mediaIds[0] ?? "";

        const created = await posts.create(userId, workspaceId, input.projectId, title);
        await posts.saveDraft(userId, workspaceId, created.id, {
          title: title.slice(0, 180),
          body,
          platforms: platform ? [platform] : [],
          mediaIds,
        });
        const row = await db.aIRequest.create({
          data: {
            workspaceId,
            projectId: input.projectId,
            userId,
            kind: AGENT_KIND,
            prompt,
            tone,
            length,
            platform,
            title,
            body,
            itemsJson: JSON.stringify([...mediaIds.map(visualItem), postItem(created.id)]),
            provider: generated.provider,
            model: `${generated.model}+${imageModel}`,
            inputTokens: generated.inputTokens,
            outputTokens: generated.outputTokens,
          },
        });
        if (input.shopProductId) {
          const product = await db.shopProduct.findUnique({ where: { id: input.shopProductId } });
          if (product && product.workspaceId === workspaceId && product.projectId === input.projectId) {
            await db.shopProduct.update({
              where: { id: product.id },
              data: { postId: created.id, consumedAt: product.consumedAt ?? new Date() },
            });
          }
        }

        await db.auditLog.create({
          data: {
            action: "COMPOSE_AGENT_POST",
            entityType: "post",
            entityId: created.id,
            actorId: userId,
            details: `${row.id}:${mediaIds.join(",")}`,
          },
        });

        return {
          request: toPublic(row),
          post: await posts.get(userId, workspaceId, created.id),
          mediaId: coverId,
        };
      } catch (error) {
        await releaseUsage(db, workspaceId, USAGE_METRICS.ai, periodStart, usageUnits);
        throw error;
      }
    },
  };
}
