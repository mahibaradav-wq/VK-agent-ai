import type { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";

import { AccessError, assertWorkspaceBound } from "@/modules/access/permissions";
import { createAccessService } from "@/modules/access/access-service";
import { parseKind, parseLength, parseTone } from "@/modules/ai/kinds";
import { parsePlatforms } from "@/modules/posts/platforms";
import { createPostService } from "@/modules/posts/post-service";
import { getAiProvider, type AiProvider } from "@/server/ai";

const AI_METRIC = "ai_generations";
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

function monthBounds(at: Date) {
  const start = DateTime.fromJSDate(at, { zone: "utc" }).startOf("month");
  return {
    periodStart: start.toJSDate(),
    periodEnd: start.endOf("month").toJSDate(),
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

  async function reserve(workspaceId: string, at: Date) {
    const { periodStart, periodEnd } = monthBounds(at);
    await db.usageRecord.upsert({
      where: {
        workspaceId_metric_periodStart: { workspaceId, metric: AI_METRIC, periodStart },
      },
      create: {
        workspaceId,
        metric: AI_METRIC,
        periodStart,
        periodEnd,
        used: 0,
        limit: monthlyLimit,
      },
      update: { periodEnd, limit: monthlyLimit },
    });
    const reserved = await db.$executeRaw`
      UPDATE "UsageRecord"
      SET "used" = "used" + 1, "updatedAt" = NOW()
      WHERE "workspaceId" = ${workspaceId}
        AND "metric" = ${AI_METRIC}
        AND "periodStart" = ${periodStart}
        AND "used" < "limit"
    `;
    if (reserved !== 1) {
      throw new AccessError(400, `Лимит AI-генераций на месяц исчерпан (${monthlyLimit}).`);
    }
    return periodStart;
  }

  async function release(workspaceId: string, periodStart: Date) {
    await db.$executeRaw`
      UPDATE "UsageRecord"
      SET "used" = GREATEST("used" - 1, 0), "updatedAt" = NOW()
      WHERE "workspaceId" = ${workspaceId}
        AND "metric" = ${AI_METRIC}
        AND "periodStart" = ${periodStart}
    `;
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
      const { periodStart, periodEnd } = monthBounds(now());
      const row = await db.usageRecord.findUnique({
        where: { workspaceId_metric_periodStart: { workspaceId, metric: AI_METRIC, periodStart } },
      });
      return {
        used: row?.used ?? 0,
        limit: row?.limit ?? monthlyLimit,
        periodStart,
        periodEnd,
      };
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
      const periodStart = await reserve(workspaceId, at);
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
        await release(workspaceId, periodStart);
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
