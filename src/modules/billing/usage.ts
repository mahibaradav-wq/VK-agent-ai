import type { Prisma } from "@prisma/client";

import { AccessError } from "@/modules/access/permissions";
import { monthBounds, type DbClient } from "@/modules/billing/plans";

export const USAGE_METRICS = {
  ai: "ai_generations",
  posts: "posts",
} as const;

export async function lockWorkspaceMetric(tx: Prisma.TransactionClient, workspaceId: string, metric: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}), hashtext(${metric}))`;
}

export async function getUsage(
  db: DbClient,
  workspaceId: string,
  metric: string,
  at: Date,
  fallbackLimit: number,
) {
  const { periodStart, periodEnd } = monthBounds(at);
  const row = await db.usageRecord.findUnique({
    where: { workspaceId_metric_periodStart: { workspaceId, metric, periodStart } },
  });
  return {
    used: row?.used ?? 0,
    limit: row?.limit ?? fallbackLimit,
    periodStart,
    periodEnd,
  };
}

export async function reserveUsage(
  db: DbClient,
  workspaceId: string,
  metric: string,
  limit: number,
  at: Date,
  exhaustedMessage: string,
) {
  const { periodStart, periodEnd } = monthBounds(at);
  await db.usageRecord.upsert({
    where: {
      workspaceId_metric_periodStart: { workspaceId, metric, periodStart },
    },
    create: {
      workspaceId,
      metric,
      periodStart,
      periodEnd,
      used: 0,
      limit,
    },
    update: { periodEnd, limit },
  });
  const reserved = await db.$executeRaw`
    UPDATE "UsageRecord"
    SET "used" = "used" + 1, "updatedAt" = NOW()
    WHERE "workspaceId" = ${workspaceId}
      AND "metric" = ${metric}
      AND "periodStart" = ${periodStart}
      AND "used" < "limit"
  `;
  if (reserved !== 1) {
    throw new AccessError(400, exhaustedMessage);
  }
  return periodStart;
}

export async function releaseUsage(db: DbClient, workspaceId: string, metric: string, periodStart: Date) {
  await db.$executeRaw`
    UPDATE "UsageRecord"
    SET "used" = GREATEST("used" - 1, 0), "updatedAt" = NOW()
    WHERE "workspaceId" = ${workspaceId}
      AND "metric" = ${metric}
      AND "periodStart" = ${periodStart}
  `;
}
