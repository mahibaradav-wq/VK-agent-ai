import type { PrismaClient } from "@prisma/client";

import { lockWorkspaceMetric, recordSpentOverage, releaseUsage, USAGE_METRICS } from "@/modules/billing/usage";

export type PaidAccount = { workspaceId: string; periodStart: Date; reserved: number; charged: number };

export const AI_USAGE_OVERAGE_ACTION = "AI_USAGE_OVERAGE";

/** One transient failure (e.g. audit insert) is retried; the transaction makes the retry safe. */
const OVERAGE_COMMIT_ATTEMPTS = 2;

async function commitOverage(db: PrismaClient, account: PaidAccount, overage: number) {
  let lastError: unknown;
  for (let attempt = 0; attempt < OVERAGE_COMMIT_ATTEMPTS; attempt += 1) {
    try {
      await db.$transaction(async (tx) => {
        await lockWorkspaceMetric(tx, account.workspaceId, USAGE_METRICS.ai);
        await recordSpentOverage(tx, account.workspaceId, USAGE_METRICS.ai, account.periodStart, overage);
        await tx.auditLog.create({
          data: {
            action: AI_USAGE_OVERAGE_ACTION,
            entityType: "workspace",
            entityId: account.workspaceId,
            details: `units=${overage}`,
          },
        });
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Brings UsageRecord.used in line with the paid calls actually made for this account.
 * The account is updated only after the database change is committed, so calling
 * settle again (from an outer catch) is a no-op instead of a second charge/release.
 */
export async function settlePaidAccount(db: PrismaClient, account: PaidAccount) {
  const charged = Math.max(0, account.charged);
  const reserved = Math.max(0, account.reserved);
  if (charged > reserved) {
    // Paid calls already happened but the limit refused to grow the reserve: record the
    // real spend (even above the monthly limit) together with its audit row, atomically.
    await commitOverage(db, account, charged - reserved);
  } else if (reserved > charged) {
    await releaseUsage(db, account.workspaceId, USAGE_METRICS.ai, account.periodStart, reserved - charged);
  }
  account.charged = charged;
  account.reserved = charged;
}
