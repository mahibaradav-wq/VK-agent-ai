import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";

import type { PrismaClient } from "@prisma/client";

import { AccessError } from "@/modules/access/permissions";
import {
  lockWorkspaceMetric,
  monthBounds,
  recordSpentOverage,
  releaseUsage,
  USAGE_METRICS,
} from "@/modules/billing/usage";
import { redactDiagnosticSecrets } from "@/server/security/secrets";

export type PaidAccount = {
  settlementId?: string;
  workspaceId: string;
  periodStart: Date;
  reserved: number;
  charged: number;
};

export type SettlePaidOptions = {
  spoolDir?: string;
  sourceError?: unknown;
};

export type RecoverySummary = {
  scanned: number;
  recovered: number;
  deduplicated: number;
  failed: number;
  skipped: number;
};

export const AI_USAGE_OVERAGE_ACTION = "AI_USAGE_OVERAGE";
export const AI_USAGE_OVERAGE_RECOVERED_ACTION = "AI_USAGE_OVERAGE_RECOVERED";

/** One transient failure (e.g. audit insert) is retried; the transaction makes the retry safe. */
const OVERAGE_COMMIT_ATTEMPTS = 2;

const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;
const SPOOL_FILE_RE = /^[a-zA-Z0-9_-]+\.json$/;

export function sanitizeDiagnosticError(error: unknown): string {
  let raw = "";
  if (error instanceof Error) {
    const rawCode = (error as Error & { code?: unknown }).code;
    const code = typeof rawCode === "string" && rawCode ? ` [${rawCode}]` : "";
    raw = `${error.name}${code}: ${error.message}`;
  } else if (typeof error === "string") {
    raw = error;
  } else {
    try {
      raw = JSON.stringify(error) ?? String(error);
    } catch {
      raw = String(error);
    }
  }
  const redacted = redactDiagnosticSecrets(raw).replace(/\s+/g, " ").trim();
  return redacted.slice(0, 500) || "unknown error";
}

export class PaidSettlementError extends Error {
  readonly settlementId: string;
  readonly settlementError: unknown;
  readonly sourceError: unknown;
  readonly spooled: boolean;

  constructor(params: {
    settlementId: string;
    settlementError: unknown;
    sourceError?: unknown;
    spooled: boolean;
  }) {
    const settlementSummary = sanitizeDiagnosticError(params.settlementError);
    const hasSource = params.sourceError !== undefined;
    const message = hasSource
      ? `AI settlement failed (${settlementSummary}); source error: ${sanitizeDiagnosticError(params.sourceError)} [settlementId=${params.settlementId}, spooled=${params.spooled}]`
      : `AI settlement failed (${settlementSummary}) [settlementId=${params.settlementId}, spooled=${params.spooled}]`;
    super(message, { cause: hasSource ? params.sourceError : params.settlementError });
    this.name = "PaidSettlementError";
    this.settlementId = params.settlementId;
    this.settlementError = params.settlementError;
    this.sourceError = params.sourceError;
    this.spooled = params.spooled;
  }
}

export const AI_ACCOUNTING_PENDING_MESSAGE =
  "Платный AI временно недоступен: учёт предыдущих AI-запросов не подтверждён в базе данных. Повторите позже.";

/**
 * The durable spool could not be read or still holds overage that PostgreSQL has not confirmed.
 * Paid AI stays closed until a later recovery pass succeeds.
 */
export class AiAccountingPendingError extends AccessError {
  readonly summary: RecoverySummary | null;
  readonly diagnostic: string;

  constructor(params: { summary: RecoverySummary | null; error?: unknown }) {
    super(409, AI_ACCOUNTING_PENDING_MESSAGE);
    this.name = "AiAccountingPendingError";
    this.summary = params.summary;
    this.diagnostic =
      params.error !== undefined
        ? sanitizeDiagnosticError(params.error)
        : `pending overage settlements not confirmed (failed=${params.summary?.failed ?? 0})`;
    if (params.error !== undefined) {
      Object.defineProperty(this, "cause", { value: params.error, enumerable: false, configurable: true });
    }
  }
}

const SPOOL_DIR_MODE = 0o700;
const SPOOL_FILE_MODE = 0o600;
/** fsync(2) on a directory fd returns EINVAL on filesystems that do not support it. */
const DIR_FSYNC_UNSUPPORTED = new Set(["EINVAL", "ENOTSUP", "EOPNOTSUPP"]);

export function resolveSettlementSpoolDir(spoolDir?: string): string {
  if (spoolDir?.trim()) {
    return path.resolve(spoolDir.trim());
  }
  const configured = process.env.AI_SETTLEMENT_SPOOL_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  const baseMedia = process.env.LOCAL_STORAGE_DIR?.trim() || path.join(process.cwd(), "data/media");
  return path.join(path.resolve(baseMedia), ".ai-settlement-spool");
}

type SpoolEntry = {
  version: 1;
  settlementId: string;
  workspaceId: string;
  metric: string;
  periodStart: string;
  overage: number;
  reserved: number;
  charged: number;
  attempts: number;
  createdAt: string;
  lastAttemptAt: string;
  lastError: string;
  sourceError: string | null;
};

function spoolFilePath(dir: string, settlementId: string): string {
  if (!SAFE_ID_RE.test(settlementId)) {
    throw new Error(`Invalid settlementId: ${settlementId}`);
  }
  return path.join(dir, `${settlementId}.json`);
}

async function fsyncDirectory(dir: string): Promise<void> {
  const handle = await open(dir, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
  try {
    await handle.sync();
  } catch (error) {
    if (!DIR_FSYNC_UNSUPPORTED.has((error as NodeJS.ErrnoException)?.code ?? "")) {
      throw error;
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** Refuses symlinks / non-directories and tightens a pre-existing directory to 0700. */
async function assertSpoolDirSafe(dir: string): Promise<void> {
  const stat = await lstat(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`AI settlement spool path is not a plain directory: ${dir}`);
  }
  if ((stat.mode & 0o077) !== 0) {
    await chmod(dir, SPOOL_DIR_MODE);
  }
}

async function ensureSpoolDir(dir: string): Promise<void> {
  const created = await mkdir(dir, { recursive: true, mode: SPOOL_DIR_MODE });
  await assertSpoolDirSafe(dir);
  if (created) {
    // Persist the new directory entry itself, otherwise a crash can drop the whole spool dir.
    await fsyncDirectory(path.dirname(created));
  }
}

async function writeSpoolEntryAtomically(dir: string, entry: SpoolEntry): Promise<void> {
  const target = spoolFilePath(dir, entry.settlementId);
  await ensureSpoolDir(dir);
  const tempPath = `${target}.tmp.${process.pid}.${randomUUID()}`;
  const payload = JSON.stringify(entry);
  const handle = await open(tempPath, "wx", SPOOL_FILE_MODE);
  try {
    await handle.writeFile(payload, "utf8");
    await handle.sync();
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
  try {
    await rename(tempPath, target);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
  // rename() is only durable once the directory entry is flushed; the renamed file is kept on failure.
  await fsyncDirectory(dir);
}

async function readSpoolFile(filePath: string): Promise<string> {
  const handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new Error("spool entry is not a regular file");
    }
    if ((stat.mode & 0o077) !== 0) {
      await handle.chmod(SPOOL_FILE_MODE);
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function removeSpoolEntry(dir: string, settlementId: string): Promise<void> {
  try {
    await unlink(spoolFilePath(dir, settlementId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }
}

function isValidSpoolEntry(value: unknown): value is SpoolEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Record<string, unknown>;
  if (item.version !== 1) return false;
  if (typeof item.settlementId !== "string" || !SAFE_ID_RE.test(item.settlementId)) return false;
  if (typeof item.workspaceId !== "string" || !item.workspaceId) return false;
  if (item.metric !== USAGE_METRICS.ai) return false;
  if (typeof item.periodStart !== "string" || Number.isNaN(Date.parse(item.periodStart))) return false;
  if (typeof item.overage !== "number" || !Number.isInteger(item.overage) || item.overage < 1) return false;
  if (typeof item.attempts !== "number" || !Number.isInteger(item.attempts) || item.attempts < 1) return false;
  if (typeof item.lastError !== "string") return false;
  if (item.sourceError !== null && typeof item.sourceError !== "string") return false;
  return true;
}

async function commitOverageTransaction(
  db: PrismaClient,
  params: {
    settlementId: string;
    workspaceId: string;
    metric: string;
    periodStart: Date;
    overage: number;
    attempts: number;
    recovered: boolean;
    lastError: string | null;
    sourceError: string | null;
  },
): Promise<"committed" | "already_settled"> {
  return db.$transaction(async (tx) => {
    await lockWorkspaceMetric(tx, params.workspaceId, params.metric);

    if (params.recovered) {
      const { periodEnd } = monthBounds(params.periodStart);
      await tx.usageRecord.upsert({
        where: {
          workspaceId_metric_periodStart: {
            workspaceId: params.workspaceId,
            metric: params.metric,
            periodStart: params.periodStart,
          },
        },
        create: {
          workspaceId: params.workspaceId,
          metric: params.metric,
          periodStart: params.periodStart,
          periodEnd,
          used: 0,
          limit: 0,
        },
        update: {},
      });
    }

    const inserted = await tx.$executeRaw`
      INSERT INTO "AiOverageSettlement" (
        "id", "settlementId", "workspaceId", "metric", "periodStart",
        "units", "attempts", "recovered", "lastError", "sourceError", "createdAt", "recoveredAt"
      )
      VALUES (
        ${randomUUID()},
        ${params.settlementId},
        ${params.workspaceId},
        ${params.metric},
        ${params.periodStart},
        ${params.overage},
        ${params.attempts},
        ${params.recovered},
        ${params.lastError},
        ${params.sourceError},
        NOW(),
        ${params.recovered ? new Date() : null}
      )
      ON CONFLICT ("settlementId") DO NOTHING
    `;
    if (inserted === 0) {
      return "already_settled";
    }

    await recordSpentOverage(tx, params.workspaceId, params.metric, params.periodStart, params.overage);
    await tx.auditLog.create({
      data: {
        action: AI_USAGE_OVERAGE_ACTION,
        entityType: "workspace",
        entityId: params.workspaceId,
        details: `units=${params.overage}`,
      },
    });
    if (params.recovered) {
      await tx.auditLog.create({
        data: {
          action: AI_USAGE_OVERAGE_RECOVERED_ACTION,
          entityType: "workspace",
          entityId: params.workspaceId,
          details: JSON.stringify({
            settlementId: params.settlementId,
            units: params.overage,
            attempts: params.attempts,
            lastError: params.lastError,
            sourceError: params.sourceError,
          }).slice(0, 1000),
        },
      });
    }
    return "committed";
  });
}

async function commitOverage(
  db: PrismaClient,
  account: PaidAccount,
  overage: number,
  options?: SettlePaidOptions,
) {
  const settlementId = (account.settlementId ??= randomUUID());
  const sourceSummary = options?.sourceError !== undefined ? sanitizeDiagnosticError(options.sourceError) : null;
  const spoolDir = resolveSettlementSpoolDir(options?.spoolDir);
  let lastError: unknown;
  let lastErrorSummary: string | null = null;

  for (let attempt = 0; attempt < OVERAGE_COMMIT_ATTEMPTS; attempt += 1) {
    try {
      await commitOverageTransaction(db, {
        settlementId,
        workspaceId: account.workspaceId,
        metric: USAGE_METRICS.ai,
        periodStart: account.periodStart,
        overage,
        attempts: attempt + 1,
        recovered: false,
        lastError: lastErrorSummary,
        sourceError: sourceSummary,
      });
      await removeSpoolEntry(spoolDir, settlementId).catch(() => undefined);
      return;
    } catch (error) {
      lastError = error;
      lastErrorSummary = sanitizeDiagnosticError(error);
    }
  }

  const nowIso = new Date().toISOString();
  let spooled = false;
  try {
    await writeSpoolEntryAtomically(spoolDir, {
      version: 1,
      settlementId,
      workspaceId: account.workspaceId,
      metric: USAGE_METRICS.ai,
      periodStart: account.periodStart.toISOString(),
      overage,
      reserved: Math.max(0, account.reserved),
      charged: Math.max(0, account.charged),
      attempts: OVERAGE_COMMIT_ATTEMPTS,
      createdAt: nowIso,
      lastAttemptAt: nowIso,
      lastError: lastErrorSummary ?? "unknown error",
      sourceError: sourceSummary,
    });
    spooled = true;
  } catch (spoolError) {
    console.error(
      "[ai-settlement] failed to persist pending overage spool",
      settlementId,
      sanitizeDiagnosticError(spoolError),
    );
  }

  throw new PaidSettlementError({
    settlementId,
    settlementError: lastError,
    sourceError: options?.sourceError,
    spooled,
  });
}

/**
 * Recovers confirmed overage settlements persisted in the durable spool after DB failures.
 * Database-level unique settlementId guarantees idempotency across retries and concurrent workers
 * without re-executing any paid AI provider call.
 */
export async function recoverPendingOverageSettlements(
  db: PrismaClient,
  options?: { spoolDir?: string; workspaceId?: string },
): Promise<RecoverySummary> {
  const spoolDir = resolveSettlementSpoolDir(options?.spoolDir);
  const summary: RecoverySummary = {
    scanned: 0,
    recovered: 0,
    deduplicated: 0,
    failed: 0,
    skipped: 0,
  };

  let entries: string[];
  try {
    await assertSpoolDirSafe(spoolDir);
    entries = (await readdir(spoolDir)).filter((name) => SPOOL_FILE_RE.test(name)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return summary;
    }
    throw error;
  }

  for (const filename of entries) {
    const filePath = path.join(spoolDir, filename);
    let parsed: unknown;
    try {
      const raw = await readSpoolFile(filePath);
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        continue;
      }
      summary.scanned += 1;
      summary.failed += 1;
      console.error("[ai-settlement] unreadable spool file", filename, sanitizeDiagnosticError(error));
      continue;
    }

    if (!isValidSpoolEntry(parsed)) {
      summary.scanned += 1;
      summary.failed += 1;
      console.error("[ai-settlement] invalid spool payload", filename);
      continue;
    }

    if (options?.workspaceId && parsed.workspaceId !== options.workspaceId) {
      summary.skipped += 1;
      continue;
    }

    summary.scanned += 1;
    try {
      const outcome = await commitOverageTransaction(db, {
        settlementId: parsed.settlementId,
        workspaceId: parsed.workspaceId,
        metric: parsed.metric,
        periodStart: new Date(parsed.periodStart),
        overage: parsed.overage,
        attempts: parsed.attempts + 1,
        recovered: true,
        lastError: parsed.lastError,
        sourceError: parsed.sourceError,
      });
      await removeSpoolEntry(spoolDir, parsed.settlementId).catch(() => undefined);
      if (outcome === "committed") {
        summary.recovered += 1;
      } else {
        summary.deduplicated += 1;
      }
    } catch (error) {
      summary.failed += 1;
      const updated: SpoolEntry = {
        ...parsed,
        attempts: parsed.attempts + 1,
        lastAttemptAt: new Date().toISOString(),
        lastError: sanitizeDiagnosticError(error),
      };
      console.error("[ai-settlement] overage recovery failed", parsed.settlementId, updated.lastError);
      // The previous spool file stays in place if this rewrite fails, so the entry is never lost.
      await writeSpoolEntryAtomically(spoolDir, updated).catch((writeError: unknown) => {
        console.error(
          "[ai-settlement] failed to update spool diagnostics",
          updated.settlementId,
          sanitizeDiagnosticError(writeError),
        );
      });
    }
  }

  return summary;
}

/**
 * Brings UsageRecord.used in line with the paid calls actually made for this account.
 * The account is updated only after the database change is committed, so calling
 * settle again (from an outer catch) is a no-op instead of a second charge/release.
 */
export async function settlePaidAccount(
  db: PrismaClient,
  account: PaidAccount,
  options?: SettlePaidOptions,
) {
  const charged = Math.max(0, account.charged);
  const reserved = Math.max(0, account.reserved);
  if (charged > reserved) {
    // Paid calls already happened but the limit refused to grow the reserve: record the
    // real spend (even above the monthly limit) together with its audit row, atomically.
    await commitOverage(db, account, charged - reserved, options);
  } else if (reserved > charged) {
    try {
      await releaseUsage(db, account.workspaceId, USAGE_METRICS.ai, account.periodStart, reserved - charged);
    } catch (releaseError) {
      if (options?.sourceError !== undefined) {
        throw new PaidSettlementError({
          settlementId: account.settlementId ?? `release-${randomUUID()}`,
          settlementError: releaseError,
          sourceError: options.sourceError,
          spooled: false,
        });
      }
      throw releaseError;
    }
  }
  account.charged = charged;
  account.reserved = charged;
}
