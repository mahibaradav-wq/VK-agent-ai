import type { PrismaClient } from "@prisma/client";

import { AccessError, assertWorkspaceBound } from "@/modules/access/permissions";
import { createAccessService } from "@/modules/access/access-service";
import { parseKind, parseLength, parseTone } from "@/modules/ai/kinds";
import { getWorkspacePlanLimits } from "@/modules/billing/plans";
import { getUsage, releaseUsage, reserveUsage, USAGE_METRICS } from "@/modules/billing/usage";
import { parsePlatforms } from "@/modules/posts/platforms";
import { createPostService } from "@/modules/posts/post-service";
import { getAiProvider, type AiProvider } from "@/server/ai";

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
    monthlyLimit?: number;
    now?: () => Date;
  },
) {
  const access = createAccessService(db);
  const posts = createPostService(db);
  const provider = options?.provider ?? getAiProvider();
  const monthlyLimit = options?.monthlyLimit ?? Number(process.env.AI_MONTHLY_LIMIT ?? DEFAULT_MONTHLY_LIMIT);
  const now = options?.now ?? (() => new Date());

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
      return {
        ready: provider.ready,
        provider: provider.name,
        model: provider.ready ? provider.model : "не настроен",
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
        where: { workspaceId },
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
      if (!provider.ready) {
        throw new AccessError(
          400,
          "Генерация недоступна: требуется настройка интеграции AI. Это не ответ модели.",
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
        const generated = await provider.generate({ kind, prompt, tone, length, platform });
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
      const publicRequest = toPublic(request);
      const platforms = request.platform ? [request.platform] : [];
      const created = await posts.create(userId, workspaceId, projectId, publicRequest.title);
      const body =
        publicRequest.body.trim() ||
        publicRequest.items.join("\n") ||
        publicRequest.prompt;
      await posts.saveDraft(userId, workspaceId, created.id, {
        title: publicRequest.title.slice(0, 180) || "Черновик из AI",
        body,
        platforms,
        mediaIds: [],
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
  };
}
