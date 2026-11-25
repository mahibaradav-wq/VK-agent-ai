import type { PrismaClient } from "@prisma/client";

import { AccessError, assertActiveProject, assertWorkspaceBound } from "@/modules/access/permissions";
import { OPENAI_IMAGE_REGION_MESSAGE, OPENAI_REGION_MESSAGE, isOpenAiRegionError } from "@/server/ai/errors";
import { createAccessService } from "@/modules/access/access-service";
import { parseKind, parseLength, parseTone } from "@/modules/ai/kinds";
import { encodeSlideshowMp4 } from "@/modules/ai/video-encode";
import {
  attemptReserveUnits,
  MAX_POST_COMPLETION_CALLS,
  paidCallsFromError,
  paidCallsFromResult,
  textGenerateReserveUnits,
} from "@/modules/ai/usage-units";
import {
  agentUsageUnits,
  defaultVideoSeconds,
  imageSizeForAspect,
  parseCarouselCount,
  parseVideoSeconds,
  parseVisualAspect,
  parseVisualKind,
  prepareVisualPrompt,
  slideVisualPrompt,
  studioReviseReserveUnits,
  videoFrameCount,
} from "@/modules/ai/visual";
import { createAiConnectionService } from "@/modules/ai/provider-service";
import { getUsage, lockWorkspaceMetric, releaseUsage, reserveUsage, USAGE_METRICS } from "@/modules/billing/usage";
import { assertPaidAiAllowed, cabinetMonthlyAiLimit } from "@/server/ai/live-guard";
import { createMediaService } from "@/modules/media/media-service";
import { defaultPublishPlatforms, parsePlatforms, parseStoredPlatforms } from "@/modules/posts/platforms";
import { createPostService } from "@/modules/posts/post-service";
import { copyForPlatform, parseVariants, type PlatformVariants } from "@/modules/posts/variants";
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

// 0 = без лимита счётчика. Это не финансовая защита: платные вызовы режет AI_LIVE_ENABLED.
const DEFAULT_MONTHLY_LIMIT = 0;

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
  const skipPaidGate = Boolean(injected || options?.connections);
  const monthlyLimit = options?.monthlyLimit ?? DEFAULT_MONTHLY_LIMIT;
  const now = options?.now ?? (() => new Date());

  async function providerFor(workspaceId: string, role: "ideas" | "copy" | "image" = "copy") {
    if (injected) {
      return injected;
    }
    return connections.resolveProvider(workspaceId, role);
  }

  type PaidAccount = { workspaceId: string; periodStart: Date; reserved: number; charged: number };

  type FallbackBilling = {
    account: PaidAccount;
    exhaustedMessage: string;
    /** Worst-case paid units for the next provider attempt. */
    attemptUnits: number;
  };

  async function settlePaidAi(account: PaidAccount) {
    const charged = Math.max(0, account.charged);
    const reserved = Math.max(0, account.reserved);
    const kept = Math.min(charged, reserved);
    const unused = reserved - kept;
    if (unused > 0) {
      await releaseUsage(db, account.workspaceId, USAGE_METRICS.ai, account.periodStart, unused);
    }
    account.charged = charged;
    account.reserved = reserved;
  }

  /** Grow reserved units before a paid attempt so spend can never outrun the metric. */
  async function ensureReserve(account: PaidAccount, units: number, exhaustedMessage: string) {
    if (!Number.isInteger(units) || units <= 0) {
      return;
    }
    const available = Math.max(0, account.reserved - account.charged);
    if (units <= available) {
      return;
    }
    const extra = units - available;
    await beginPaidAi(account.workspaceId, extra, exhaustedMessage);
    account.reserved += extra;
  }

  async function notePaidCalls(account: PaidAccount, calls: number, exhaustedMessage: string) {
    if (!Number.isInteger(calls) || calls <= 0) {
      return;
    }
    // Calls already happened: charge first, then grow if somehow under-reserved (should be rare).
    account.charged += calls;
    if (account.charged > account.reserved) {
      const extra = account.charged - account.reserved;
      await beginPaidAi(account.workspaceId, extra, exhaustedMessage);
      account.reserved += extra;
    }
  }

  async function callWithFallback<T>(
    workspaceId: string,
    role: "ideas" | "copy" | "image",
    fn: (provider: AiProvider) => Promise<T>,
    billing?: FallbackBilling,
  ): Promise<T> {
    if (injected) {
      if (billing) {
        await ensureReserve(billing.account, billing.attemptUnits, billing.exhaustedMessage);
      }
      try {
        return await fn(injected);
      } catch (error) {
        const spent = paidCallsFromError(error);
        if (spent > 0 && billing) {
          try {
            await notePaidCalls(billing.account, spent, billing.exhaustedMessage);
          } catch {
            billing.account.charged = Math.max(billing.account.charged, spent);
          }
        }
        throw error;
      }
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
    let spentOnFailedAttempts = 0;
    for (const provider of providers) {
      if (billing) {
        // Refuse the next provider (incl. fallback) before HTTP if headroom cannot be reserved.
        await ensureReserve(billing.account, billing.attemptUnits, billing.exhaustedMessage);
      }
      try {
        return await fn(provider);
      } catch (error) {
        last = error;
        const spent = paidCallsFromError(error);
        spentOnFailedAttempts += spent;
        if (spent > 0 && billing) {
          try {
            await notePaidCalls(billing.account, spent, billing.exhaustedMessage);
          } catch {
            // Keep actual spend charged even if emergency grow fails after the paid attempt.
            billing.account.charged = Math.max(billing.account.charged, spentOnFailedAttempts);
          }
        }
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
      throw attachFallbackPaid(new AccessError(400, OPENAI_IMAGE_REGION_MESSAGE), spentOnFailedAttempts);
    }
    if (last instanceof Error) {
      throw attachFallbackPaid(last, spentOnFailedAttempts);
    }
    throw last;
  }

  function attachFallbackPaid(error: Error, paidCalls: number) {
    if (paidCalls > 0) {
      Object.defineProperty(error, "paidCalls", { value: paidCalls, enumerable: true, configurable: true });
    }
    return error;
  }

  async function loadBoundRequest(workspaceId: string, requestId: string) {
    const row = await db.aIRequest.findUnique({ where: { id: requestId } });
    assertWorkspaceBound(workspaceId, row, "AI-запрос");
    return row;
  }

  async function resolveLimit(_workspaceId: string) {
    if (options?.monthlyLimit != null) {
      return options.monthlyLimit;
    }
    if (skipPaidGate) {
      return monthlyLimit;
    }
    return cabinetMonthlyAiLimit() ?? 0;
  }

  async function beginPaidAi(workspaceId: string, units: number, exhaustedMessage: string) {
    if (!skipPaidGate) {
      try {
        assertPaidAiAllowed();
      } catch (error) {
        if (error instanceof AccessError) {
          await db.auditLog.create({
            data: {
              action: "AI_PAID_DENIED",
              entityType: "workspace",
              entityId: workspaceId,
              details: error.message.slice(0, 180),
            },
          });
        }
        throw error;
      }
    }

    const at = now();
    const limit = await resolveLimit(workspaceId);
    try {
      return await db.$transaction(async (tx) => {
        await lockWorkspaceMetric(tx, workspaceId, USAGE_METRICS.ai);
        return reserveUsage(tx, workspaceId, USAGE_METRICS.ai, limit, at, exhaustedMessage, units);
      });
    } catch (error) {
      if (!skipPaidGate && error instanceof AccessError) {
        await db.auditLog.create({
          data: {
            action: "AI_PAID_DENIED",
            entityType: "workspace",
            entityId: workspaceId,
            details: "budget_exhausted",
          },
        });
      }
      throw error;
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
        assertActiveProject(workspaceId, project);
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

      const limit = await resolveLimit(workspaceId);
      const exhausted = `Общий лимит AI-запросов кабинета на месяц исчерпан (${limit}).`;
      const reserved = textGenerateReserveUnits(kind);
      const account: PaidAccount = {
        workspaceId,
        periodStart: await beginPaidAi(workspaceId, reserved, exhausted),
        reserved,
        charged: 0,
      };
      try {
        const generated = await callWithFallback(
          workspaceId,
          role,
          (item) => item.generate({ kind, prompt, tone, length, platform }),
          { account, exhaustedMessage: exhausted, attemptUnits: attemptReserveUnits(kind) },
        );
        await notePaidCalls(account, paidCallsFromResult(generated, 1), exhausted);
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
            details: `${kind}:${generated.provider}`,
            actorId: userId,
          },
        });
        await settlePaidAi(account);
        return toPublic(row);
      } catch (error) {
        // Fallback path already noted paid failures via onPaidCalls; only sync if throw skipped that.
        if (paidCallsFromError(error) > account.charged) {
          try {
            await notePaidCalls(account, paidCallsFromError(error) - account.charged, exhausted);
          } catch {
            account.charged = Math.max(account.charged, paidCallsFromError(error));
          }
        }
        await settlePaidAi(account);
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
      const project = await db.project.findUnique({ where: { id: projectId } });
      assertActiveProject(workspaceId, project);
      if (!request.projectId || request.projectId !== projectId) {
        throw new AccessError(403, "AI-запрос принадлежит другому проекту. Выберите проект, для которого выполнялась генерация.");
      }
      const publicRequest = toPublic(request);
      const linkedPostId = parseLinkedPostId(publicRequest.items);
      if (request.kind === AGENT_KIND && linkedPostId) {
        try {
          const linkedPost = await posts.get(userId, workspaceId, linkedPostId);
          if (linkedPost.projectId !== projectId) {
            throw new AccessError(403, "Черновик из AI-запроса принадлежит другому проекту.");
          }
          return linkedPost;
        } catch (error) {
          if (error instanceof AccessError && error.status === 403) {
            throw error;
          }
          // Черновик удалили — ниже создадим новый из той же генерации.
        }
      }
      const platforms = defaultPublishPlatforms(parseStoredPlatforms(request.platform));
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
        platforms?: string[];
        projectId: string;
        visualKind?: string;
        visualAspect?: string;
        visualPrompt?: string;
        carouselCount?: string | number;
        videoSeconds?: string | number;
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
      assertActiveProject(workspaceId, project);

      const tone = parseTone(input.tone ?? "");
      const length = parseLength(input.length ?? "");
      const publishPlatforms = defaultPublishPlatforms(
        input.platforms ?? (input.platform ? [input.platform] : []),
      );
      const visualKind = parseVisualKind(input.visualKind ?? "image");
      const visualAspect = parseVisualAspect(input.visualAspect ?? "", visualKind);
      const videoSeconds = parseVideoSeconds(input.videoSeconds);
      const slideCount =
        visualKind === "video" ? videoFrameCount(videoSeconds) : parseCarouselCount(input.carouselCount, visualKind);
      const usageUnits = agentUsageUnits(
        visualKind,
        visualKind === "video" ? videoSeconds : input.carouselCount,
        publishPlatforms.length,
      );

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

      const limit = await resolveLimit(workspaceId);
      const exhausted =
        visualKind === "carousel"
          ? `Агенту нужны до ${usageUnits} AI-вызовов (${publishPlatforms.length > 1 ? "тексты Telegram и ВК" : "текст"} с возможным revise и ${slideCount} карточек). Общий лимит AI кабинета исчерпан (${limit}).`
          : visualKind === "video"
            ? `Агенту нужны до ${usageUnits} AI-вызовов (${publishPlatforms.length > 1 ? "тексты Telegram и ВК" : "текст"} с возможным revise и ${slideCount} кадров ролика ${videoSeconds} с). Общий лимит AI кабинета исчерпан (${limit}).`
            : publishPlatforms.length > 1
              ? `Агенту нужны до ${usageUnits} AI-вызовов (тексты Telegram и ВК с возможным revise и визуал). Общий лимит AI кабинета исчерпан (${limit}).`
              : `Агенту нужны до ${usageUnits} AI-вызовов (текст с возможным revise и визуал). Общий лимит AI кабинета исчерпан (${limit}).`;
      const account: PaidAccount = {
        workspaceId,
        periodStart: await beginPaidAi(workspaceId, usageUnits, exhausted),
        reserved: usageUnits,
        charged: 0,
      };

      try {
        const variants: PlatformVariants = {};
        let generated = {
          title: "Черновик агента",
          body: prompt,
          provider: copy.name,
          model: copy.model,
          inputTokens: 0,
          outputTokens: 0,
        };
        for (const target of publishPlatforms) {
          const next = await callWithFallback(
            workspaceId,
            "copy",
            (item) =>
              item.generate({
                kind: "post",
                prompt,
                tone,
                length: target === "telegram" ? "caption" : length,
                platform: target,
              }),
            { account, exhaustedMessage: exhausted, attemptUnits: MAX_POST_COMPLETION_CALLS },
          );
          await notePaidCalls(account, paidCallsFromResult(next, 1), exhausted);
          variants[target] = {
            title: next.title.trim() || "Черновик агента",
            body: next.body.trim() || prompt,
          };
          generated = {
            title: next.title,
            body: next.body,
            provider: next.provider,
            model: next.model,
            inputTokens: next.inputTokens ?? 0,
            outputTokens: next.outputTokens ?? 0,
          };
        }
        const primary = variants[publishPlatforms[0] ?? "telegram"] ?? {
          title: generated.title.trim() || "Черновик агента",
          body: generated.body.trim() || prompt,
        };
        const title = primary.title;
        const body = primary.body;
        const baseVisualPrompt = visualPromptForCopy({
          brief: prompt,
          title,
          body,
          visualKind,
          visualAspect,
          visualPrompt: input.visualPrompt,
        });
        const frames = [];
        let imageModel = "";
        for (let index = 0; index < slideCount; index += 1) {
          const image = await callWithFallback(
            workspaceId,
            "image",
            (item) =>
              item.generateImage({
                prompt: slideVisualPrompt(baseVisualPrompt, index, slideCount),
                size: imageSizeForAspect(visualAspect),
              }),
            { account, exhaustedMessage: exhausted, attemptUnits: 1 },
          );
          await notePaidCalls(account, paidCallsFromResult(image, 1), exhausted);
          imageModel = image.model;
          frames.push(image);
        }
        const assets = [];
        if (visualKind === "video") {
          const mp4 = await encodeSlideshowMp4({
            frames: frames.map((item) => item.bytes),
            seconds: videoSeconds,
            aspect: visualAspect,
          });
          assets.push(
            await media.upload(userId, workspaceId, {
              filename: "agent-video.mp4",
              declaredType: "video/mp4",
              bytes: mp4,
            }),
          );
        } else {
          for (const [index, image] of frames.entries()) {
            assets.push(
              await media.upload(userId, workspaceId, {
                filename: `agent-visual-${index + 1}.${extensionForMime(image.mimeType)}`,
                declaredType: image.mimeType,
                bytes: image.bytes,
              }),
            );
          }
        }
        const mediaIds = assets.map((asset) => asset.id);
        const coverId = mediaIds[0] ?? "";

        const created = await posts.create(userId, workspaceId, input.projectId, title);
        await posts.saveDraft(userId, workspaceId, created.id, {
          title: title.slice(0, 180),
          body,
          platforms: publishPlatforms,
          variants,
          mediaIds,
        });
        await posts.clearUnscheduledStudioCards(userId, workspaceId, input.projectId, created.id);
        const row = await db.aIRequest.create({
          data: {
            workspaceId,
            projectId: input.projectId,
            userId,
            kind: AGENT_KIND,
            prompt,
            tone,
            length,
            platform: publishPlatforms.join(","),
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

        await settlePaidAi(account);
        return {
          request: toPublic(row),
          post: await posts.get(userId, workspaceId, created.id),
          mediaId: coverId,
        };
      } catch (error) {
        if (paidCallsFromError(error) > account.charged) {
          try {
            await notePaidCalls(account, paidCallsFromError(error) - account.charged, exhausted);
          } catch {
            account.charged = Math.max(account.charged, paidCallsFromError(error));
          }
        }
        await settlePaidAi(account);
        throw error;
      }
    },

    async reviseStudioCard(
      userId: string,
      workspaceId: string,
      input: { postId: string; comment: string; rewrite: "text" | "visual" | "both" },
    ) {
      await access.requirePermission(userId, workspaceId, "ai.generate");
      await access.requirePermission(userId, workspaceId, "post.update");
      const comment = input.comment.trim();
      if (comment.length < 3) {
        throw new AccessError(400, "Напишите, что поправить, минимум тремя символами.");
      }
      const post = await posts.get(userId, workspaceId, input.postId);
      if (["queued", "publishing", "published", "cancelled"].includes(post.status)) {
        throw new AccessError(403, "Нельзя править публикацию в текущем статусе.");
      }
      const version = posts.currentVersion(post);
      if (!version) {
        throw new AccessError(400, "У карточки нет текста для правки.");
      }
      const rewriteText = input.rewrite !== "visual";
      const rewriteVisual = input.rewrite !== "text";
      const existingVideo = post.media.some((item) => item.media.mimeType === "video/mp4");
      const slideCount = existingVideo ? videoFrameCount(defaultVideoSeconds) : Math.max(1, post.media.length);
      const platforms = defaultPublishPlatforms(post.targets.map((target) => target.platform));
      const reserved = studioReviseReserveUnits({
        rewriteText,
        rewriteVisual,
        platformCount: platforms.length,
        slideCount,
      });
      const limit = await resolveLimit(workspaceId);
      const exhausted = `Общий лимит AI-запросов кабинета на месяц исчерпан (${limit}).`;
      const account: PaidAccount = {
        workspaceId,
        periodStart: await beginPaidAi(workspaceId, reserved, exhausted),
        reserved,
        charged: 0,
      };
      try {
        let title = version.title;
        let body = version.body;
        const variants: PlatformVariants = {};
        if (rewriteText) {
          const copy = await providerFor(workspaceId, "copy");
          if (!copy.ready) {
            throw new AccessError(400, "Правка текста недоступна: подключите ChatGPT.");
          }
          for (const target of platforms) {
            const current = copyForPlatform(version, target);
            const generated = await callWithFallback(
              workspaceId,
              "copy",
              (item) =>
                item.generate({
                  kind: "post",
                  prompt: `Текущий заголовок: ${current.title}\nТекущий текст:\n${current.body}\n\nПравка от автора: ${comment}`,
                  tone: "friendly",
                  length: target === "telegram" ? "caption" : "medium",
                  platform: target,
                }),
              { account, exhaustedMessage: exhausted, attemptUnits: MAX_POST_COMPLETION_CALLS },
            );
            await notePaidCalls(account, paidCallsFromResult(generated, 1), exhausted);
            variants[target] = {
              title: generated.title.trim() || current.title,
              body: generated.body.trim() || current.body,
            };
          }
          const primary = variants[platforms[0] ?? "telegram"];
          title = primary?.title || title;
          body = primary?.body || body;
        }
        const mediaIds = post.media.map((item) => item.mediaId);
        if (rewriteVisual) {
          const imageProvider = await providerFor(workspaceId, "image");
          if (!imageProvider.imageReady) {
            throw new AccessError(400, "Правка визуала недоступна: подключите ChatGPT с картинками.");
          }
          if (!storageDriver.ready) {
            throw new AccessError(400, storageDriver.setupMessage ?? "Хранилище не настроено.");
          }
          const visualKind = existingVideo ? "video" : slideCount > 1 ? "carousel" : "image";
          const visualAspect = existingVideo ? "9:16" : "4:5";
          const baseVisualPrompt = prepareVisualPrompt({
            brief: comment,
            kind: visualKind,
            aspect: visualAspect,
            title,
            body,
          });
          const frames = [];
          for (let index = 0; index < slideCount; index += 1) {
            const frame = await callWithFallback(
              workspaceId,
              "image",
              (item) =>
                item.generateImage({
                  prompt: slideVisualPrompt(baseVisualPrompt, index, slideCount),
                  size: imageSizeForAspect(visualAspect),
                }),
              { account, exhaustedMessage: exhausted, attemptUnits: 1 },
            );
            await notePaidCalls(account, paidCallsFromResult(frame, 1), exhausted);
            frames.push(frame);
          }
          const assets = [];
          if (existingVideo) {
            const mp4 = await encodeSlideshowMp4({
              frames: frames.map((item) => item.bytes),
              seconds: defaultVideoSeconds,
              aspect: visualAspect,
            });
            assets.push(
              await media.upload(userId, workspaceId, {
                filename: "studio-video.mp4",
                declaredType: "video/mp4",
                bytes: mp4,
              }),
            );
          } else {
            for (const [index, image] of frames.entries()) {
              assets.push(
                await media.upload(userId, workspaceId, {
                  filename: `studio-visual-${index + 1}.${extensionForMime(image.mimeType)}`,
                  declaredType: image.mimeType,
                  bytes: image.bytes,
                }),
              );
            }
          }
          mediaIds.splice(0, mediaIds.length, ...assets.map((asset) => asset.id));
        }
        await posts.saveDraft(userId, workspaceId, post.id, {
          title: title.slice(0, 180),
          body,
          platforms,
          variants: rewriteText ? variants : parseVariants(version.variantsJson),
          mediaIds,
        });
        await db.auditLog.create({
          data: {
            action: "REVISE_STUDIO_CARD",
            entityType: "post",
            entityId: post.id,
            actorId: userId,
            details: input.rewrite,
          },
        });
        await settlePaidAi(account);
        return posts.get(userId, workspaceId, post.id);
      } catch (error) {
        if (paidCallsFromError(error) > account.charged) {
          try {
            await notePaidCalls(account, paidCallsFromError(error) - account.charged, exhausted);
          } catch {
            account.charged = Math.max(account.charged, paidCallsFromError(error));
          }
        }
        await settlePaidAi(account);
        throw error;
      }
    },
  };
}
