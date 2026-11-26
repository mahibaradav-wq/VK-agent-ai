import type { Prisma, PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";

import { AccessError } from "@/modules/access/permissions";

export type DbClient = PrismaClient | Prisma.TransactionClient;

export function monthBounds(at: Date) {
  const start = DateTime.fromJSDate(at, { zone: "utc" }).startOf("month");
  return {
    periodStart: start.toJSDate(),
    periodEnd: start.endOf("month").toJSDate(),
  };
}

export const USAGE_METRICS = {
  ai: "ai_generations",
  posts: "posts",
} as const;

export function isUnlimitedUsage(limit: number) {
  return !Number.isFinite(limit) || limit <= 0;
}

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
    limit: isUnlimitedUsage(fallbackLimit) ? 0 : (row?.limit ?? fallbackLimit),
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
  units = 1,
) {
  if (!Number.isInteger(units) || units < 1) {
    throw new AccessError(400, "Некорректный резерв использования.");
  }
  const { periodStart, periodEnd } = monthBounds(at);
  const storedLimit = isUnlimitedUsage(limit) ? 0 : limit;
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
      limit: storedLimit,
    },
    update: { periodEnd, limit: storedLimit },
  });
  if (isUnlimitedUsage(limit)) {
    await db.$executeRaw`
      UPDATE "UsageRecord"
      SET "used" = "used" + ${units}, "updatedAt" = NOW()
      WHERE "workspaceId" = ${workspaceId}
        AND "metric" = ${metric}
        AND "periodStart" = ${periodStart}
    `;
    return periodStart;
  }
  const reserved = await db.$executeRaw`
    UPDATE "UsageRecord"
    SET "used" = "used" + ${units}, "updatedAt" = NOW()
    WHERE "workspaceId" = ${workspaceId}
      AND "metric" = ${metric}
      AND "periodStart" = ${periodStart}
      AND "used" + ${units} <= "limit"
  `;
  if (reserved !== 1) {
    throw new AccessError(400, exhaustedMessage);
  }
  return periodStart;
}

export async function releaseUsage(
  db: DbClient,
  workspaceId: string,
  metric: string,
  periodStart: Date,
  units = 1,
) {
  await db.$executeRaw`
    UPDATE "UsageRecord"
    SET "used" = GREATEST("used" - ${units}, 0), "updatedAt" = NOW()
    WHERE "workspaceId" = ${workspaceId}
      AND "metric" = ${metric}
      AND "periodStart" = ${periodStart}
  `;
}

/**
 * Records units that were already spent (paid HTTP happened) when the limit refused
 * to grow the reserve. Deliberately skips the limit check: hiding real spend would
 * undercount, and the next reserveUsage still refuses new paid calls.
 */
export async function recordSpentOverage(
  db: DbClient,
  workspaceId: string,
  metric: string,
  periodStart: Date,
  units: number,
) {
  if (!Number.isInteger(units) || units < 1) {
    return;
  }
  await db.$executeRaw`
    UPDATE "UsageRecord"
    SET "used" = "used" + ${units}, "updatedAt" = NOW()
    WHERE "workspaceId" = ${workspaceId}
      AND "metric" = ${metric}
      AND "periodStart" = ${periodStart}
  `;
}
