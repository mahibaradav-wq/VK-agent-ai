import type { Prisma, PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";

import { assertWorkspaceBound } from "@/modules/access/permissions";
import { createAccessService } from "@/modules/access/access-service";
import {
  aggregateSnapshots,
  availabilityForPlatforms,
  buildDemoSeries,
  defaultRange,
  DEMO_NOTE,
  parseIsoDay,
  utcDayBounds,
  type AggregatedDashboard,
  type NormalizedSnapshot,
} from "@/modules/analytics/metrics";
import { decryptToken } from "@/server/crypto/token-cipher";
import { createTelegramTransport, type TelegramTransport } from "@/server/social/telegram-api";

const snapshotInclude = {
  project: true,
  socialAccount: true,
} satisfies Prisma.AnalyticsSnapshotInclude;

type SnapshotRow = Prisma.AnalyticsSnapshotGetPayload<{ include: typeof snapshotInclude }>;

export type PublicSnapshot = NormalizedSnapshot & {
  projectName: string | null;
  accountName: string | null;
};

export type CollectSkip = {
  accountId: string;
  platform: string;
  displayName: string;
  reason: string;
};

export type CollectResult = {
  collected: PublicSnapshot[];
  skipped: CollectSkip[];
};

export type AnalyticsDashboard = Omit<AggregatedDashboard, "snapshots"> & {
  snapshots: PublicSnapshot[];
  from: Date;
  to: Date;
  availability: ReturnType<typeof availabilityForPlatforms>;
  note: string;
};

function toNormalized(row: SnapshotRow): PublicSnapshot {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    socialAccountId: row.socialAccountId,
    platform: row.platform,
    source: row.source,
    collectedAt: row.collectedAt,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    impressions: row.impressions,
    reach: row.reach,
    followers: row.followers,
    engagement: row.engagement,
    postsPublished: row.postsPublished,
    rawPayload: row.rawPayload,
    projectName: row.project?.name ?? null,
    accountName: row.socialAccount?.displayName ?? null,
  };
}

export function createAnalyticsService(
  db: PrismaClient,
  options?: {
    telegram?: TelegramTransport;
    now?: () => Date;
  },
) {
  const access = createAccessService(db);
  const telegram = options?.telegram ?? createTelegramTransport();
  const now = options?.now ?? (() => new Date());

  async function publishedCount(accountId: string, workspaceId: string, periodStart: Date, periodEnd: Date) {
    return db.publishAttempt.count({
      where: {
        kind: "success",
        finishedAt: { gte: periodStart, lte: periodEnd },
        target: { workspaceId, socialAccountId: accountId },
      },
    });
  }

  async function collectTelegramAccount(
    userId: string,
    account: {
      id: string;
      workspaceId: string;
      projectId: string | null;
      platform: string;
      displayName: string;
      externalId: string;
      status: string;
      encryptedToken: string | null;
    },
  ): Promise<{ snapshot?: PublicSnapshot; skip?: CollectSkip }> {
    if (account.status !== "connected" || !account.encryptedToken) {
      return {
        skip: {
          accountId: account.id,
          platform: account.platform,
          displayName: account.displayName,
          reason: "Аккаунт не подключён официальным токеном, снимок не создаётся.",
        },
      };
    }

    const at = now();
    const { periodStart, periodEnd } = utcDayBounds(at);
    const token = decryptToken(account.encryptedToken);
    const memberCount = await telegram.request(token, "getChatMemberCount", { chat_id: account.externalId });
    const postsPublished = await publishedCount(account.id, account.workspaceId, periodStart, periodEnd);

    if (!memberCount.ok) {
      if (memberCount.error_code === 401) {
        await db.socialAccount.update({
          where: { id: account.id },
          data: { status: "token_expired", lastError: memberCount.description },
        });
      }
      return {
        skip: {
          accountId: account.id,
          platform: account.platform,
          displayName: account.displayName,
          reason: `Telegram не отдал метрики: ${memberCount.description}`,
        },
      };
    }

    const followers = typeof memberCount.result === "number" ? memberCount.result : null;
    if (followers === null) {
      return {
        skip: {
          accountId: account.id,
          platform: account.platform,
          displayName: account.displayName,
          reason: "Telegram вернул нечисловой getChatMemberCount, подписчики не записаны как ноль.",
        },
      };
    }

    const rawPayload: Prisma.InputJsonValue = {
      platform: "telegram",
      method: "getChatMemberCount",
      request: { chat_id: account.externalId },
      response: { ok: true, result: followers },
      postsPublishedFrom: "publish_attempt",
      unavailable: ["impressions", "reach", "engagement"],
    };

    const row = await db.analyticsSnapshot.create({
      data: {
        workspaceId: account.workspaceId,
        projectId: account.projectId,
        socialAccountId: account.id,
        platform: "telegram",
        source: "telegram",
        collectedAt: at,
        periodStart,
        periodEnd,
        impressions: null,
        reach: null,
        followers,
        engagement: null,
        postsPublished,
        rawPayload,
      },
      include: snapshotInclude,
    });
    await db.auditLog.create({
      data: {
        action: "COLLECT_ANALYTICS",
        entityType: "analytics_snapshot",
        entityId: row.id,
        actorId: userId,
        details: `telegram:${account.id}:followers=${followers}`,
      },
    });
    return { snapshot: toNormalized(row) };
  }

  return {
    async dashboard(
      userId: string,
      workspaceId: string,
      filters?: {
        from?: string;
        to?: string;
        projectId?: string;
        socialAccountId?: string;
        platform?: string;
      },
    ): Promise<AnalyticsDashboard> {
      await access.requirePermission(userId, workspaceId, "analytics.view");
      const range = defaultRange(now());
      const from = filters?.from
        ? DateTime.fromJSDate(parseIsoDay(filters.from, range.from), { zone: "utc" }).startOf("day").toJSDate()
        : range.from;
      const to = filters?.to
        ? DateTime.fromJSDate(parseIsoDay(filters.to, range.to), { zone: "utc" }).endOf("day").toJSDate()
        : range.to;

      if (filters?.projectId) {
        const project = await db.project.findUnique({ where: { id: filters.projectId } });
        assertWorkspaceBound(workspaceId, project, "Проект");
      }
      if (filters?.socialAccountId) {
        const account = await db.socialAccount.findUnique({ where: { id: filters.socialAccountId } });
        assertWorkspaceBound(workspaceId, account, "Социальный аккаунт");
      }

      const rows = await db.analyticsSnapshot.findMany({
        where: {
          workspaceId,
          periodStart: { lte: to },
          periodEnd: { gte: from },
          ...(filters?.projectId ? { projectId: filters.projectId } : {}),
          ...(filters?.socialAccountId ? { socialAccountId: filters.socialAccountId } : {}),
          ...(filters?.platform ? { platform: filters.platform } : {}),
        },
        include: snapshotInclude,
        orderBy: { collectedAt: "desc" },
      });

      const named = new Map(rows.map((row) => [row.id, toNormalized(row)]));
      const normalized = rows.map(toNormalized);
      let aggregated = aggregateSnapshots(normalized);
      if (aggregated.mode === "demo" && aggregated.snapshots.length === 0) {
        aggregated = aggregateSnapshots(buildDemoSeries(from, to, workspaceId));
      }

      const platforms =
        aggregated.mode === "demo" ? ["demo"] : [...new Set(aggregated.snapshots.map((row) => row.platform))];

      return {
        ...aggregated,
        snapshots: aggregated.snapshots.map((snapshot) => named.get(snapshot.id) ?? { ...snapshot, projectName: null, accountName: null }),
        from,
        to,
        availability: availabilityForPlatforms(platforms),
        note: aggregated.demoUsed ? DEMO_NOTE : "Итоги считаются только по реальным снимкам. Демо не смешивается.",
      };
    },

    async collect(
      userId: string,
      workspaceId: string,
      input?: { socialAccountId?: string },
    ): Promise<CollectResult> {
      await access.requirePermission(userId, workspaceId, "analytics.collect");
      const where = {
        workspaceId,
        status: { not: "disconnected" as const },
        ...(input?.socialAccountId ? { id: input.socialAccountId } : {}),
      };
      const accounts = await db.socialAccount.findMany({ where, orderBy: { createdAt: "asc" } });
      if (input?.socialAccountId && accounts.length === 0) {
        const missing = await db.socialAccount.findUnique({ where: { id: input.socialAccountId } });
        assertWorkspaceBound(workspaceId, missing, "Социальный аккаунт");
      }

      const collected: PublicSnapshot[] = [];
      const skipped: CollectSkip[] = [];

      for (const account of accounts) {
        if (account.platform === "telegram") {
          const result = await collectTelegramAccount(userId, account);
          if (result.snapshot) {
            collected.push(result.snapshot);
          } else if (result.skip) {
            skipped.push(result.skip);
          }
          continue;
        }
        skipped.push({
          accountId: account.id,
          platform: account.platform,
          displayName: account.displayName,
          reason: "Метрики этой платформы ещё не собираются официальным API. Нулевые охваты не записываются.",
        });
      }

      return { collected, skipped };
    },
  };
}
