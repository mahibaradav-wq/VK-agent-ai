import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createAiService } from "@/modules/ai/ai-service";
import {
  AI_USAGE_OVERAGE_ACTION,
  AI_USAGE_OVERAGE_RECOVERED_ACTION,
  PaidSettlementError,
  recoverPendingOverageSettlements,
  settlePaidAccount,
  type PaidAccount,
} from "@/modules/ai/paid-settlement";
import { createAuthService } from "@/modules/auth/auth-service";
import { reserveUsage, USAGE_METRICS } from "@/modules/billing/usage";
import { assertNoSecretLeak } from "@/server/security/secrets";
import type { AiProvider } from "@/server/ai/types";
import { prisma } from "@/server/db/prisma";

const auth = createAuthService(prisma, "http://localhost:3000");
const tempDirs: string[] = [];

async function makeSpoolDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "polka-pr69-spool-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
});

async function workspace(label: string) {
  const address = `${label}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;
  await auth.register(address, "password123");
  const mail = await prisma.devMailMessage.findFirstOrThrow({
    where: { to: address, kind: "verify_email" },
    orderBy: { createdAt: "desc" },
  });
  await auth.verifyEmail(mail.url!.split("token=")[1]!);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: address } });
  const membership = await prisma.workspaceMember.findFirstOrThrow({ where: { userId: user.id } });
  return { userId: user.id, workspaceId: membership.workspaceId };
}

async function usedUnits(workspaceId: string) {
  const row = await prisma.usageRecord.findFirst({ where: { workspaceId, metric: USAGE_METRICS.ai } });
  return row?.used ?? 0;
}

async function overageAudits(workspaceId: string) {
  return prisma.auditLog.findMany({
    where: { action: AI_USAGE_OVERAGE_ACTION, entityId: workspaceId },
    orderBy: { createdAt: "asc" },
  });
}

async function recoveredAudits(workspaceId: string) {
  return prisma.auditLog.findMany({
    where: { action: AI_USAGE_OVERAGE_RECOVERED_ACTION, entityId: workspaceId },
    orderBy: { createdAt: "asc" },
  });
}

function scriptedProvider(paidCalls: number, mode: "success" | "failure" = "success", failMessage = "провайдер упал после платных HTTP") {
  const self = {
    name: "scripted",
    model: "m",
    imageModel: "i",
    ready: true,
    imageReady: true,
    calls: 0,
    imageCalls: 0,
    async generate() {
      self.calls += 1;
      if (mode === "failure") {
        const error = new AccessError(400, failMessage);
        Object.defineProperty(error, "paidCalls", { value: paidCalls, enumerable: true });
        throw error;
      }
      return {
        title: "Полки в прихожей",
        body: "Текст поста про полки.",
        items: ["идея"],
        raw: "{}",
        provider: "scripted",
        model: "m",
        paidCalls,
      };
    },
    async generateImage() {
      throw new Error("not used");
    },
  };
  return self satisfies AiProvider;
}

/**
 * Real Prisma client whose AI_USAGE_OVERAGE audit insert (or whole $transaction) fails `failures` times.
 */
function dbOutageProxy(failures: number, errorMessage = "DB connection lost (injected)") {
  const state = { remaining: failures, attempts: 0 };
  const wrapAudit = (auditLog: PrismaClient["auditLog"]) =>
    new Proxy(auditLog, {
      get(target, prop) {
        if (prop === "create") {
          return async (args: { data: { action?: string } }) => {
            if (args.data.action === AI_USAGE_OVERAGE_ACTION) {
              state.attempts += 1;
              if (state.remaining > 0) {
                state.remaining -= 1;
                throw new Error(errorMessage);
              }
            }
            return target.create(args as never);
          };
        }
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
  const wrapClient = <T extends object>(client: T): T =>
    new Proxy(client, {
      get(target, prop) {
        if (prop === "auditLog") {
          return wrapAudit((target as unknown as PrismaClient).auditLog);
        }
        if (prop === "$transaction") {
          return (arg: unknown, opts?: unknown) => {
            const root = target as unknown as PrismaClient;
            if (typeof arg === "function") {
              return root.$transaction(
                (tx) => (arg as (t: unknown) => Promise<unknown>)(wrapClient(tx)),
                opts as never,
              );
            }
            return root.$transaction(arg as never, opts as never);
          };
        }
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
  return { db: wrapClient(prisma) as PrismaClient, state };
}

describe("PR69 Block A: AI overage durable spool, recovery & error preservation (real test DB)", () => {
  it("1) DB fails twice on overage → spooled, then recovered after DB returns without re-running paid AI", async () => {
    const o = await workspace("pr69-a1");
    const spoolDir = await makeSpoolDir();
    const provider = scriptedProvider(3);
    const { db, state } = dbOutageProxy(Number.POSITIVE_INFINITY);
    const ai = createAiService(db, { provider, monthlyLimit: 2, spoolDir });

    let caught: unknown;
    try {
      await ai.generate(o.userId, o.workspaceId, { kind: "ideas", prompt: "полки" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PaidSettlementError);
    const settlementErr = caught as PaidSettlementError;
    expect(settlementErr.spooled).toBe(true);
    expect(settlementErr.settlementId).toBeTruthy();
    expect(state.attempts).toBe(2);
    expect(provider.calls).toBe(1);
    expect(await usedUnits(o.workspaceId)).toBe(1);
    expect(await overageAudits(o.workspaceId)).toHaveLength(0);

    const files = await readdir(spoolDir);
    expect(files).toEqual([`${settlementErr.settlementId}.json`]);

    // DB recovers; run recovery without calling the paid AI provider again.
    const summary = await recoverPendingOverageSettlements(prisma, { spoolDir });
    expect(summary).toEqual({ scanned: 1, recovered: 1, deduplicated: 0, failed: 0, skipped: 0 });
    expect(provider.calls).toBe(1);
    expect(await usedUnits(o.workspaceId)).toBe(3);

    const overages = await overageAudits(o.workspaceId);
    expect(overages).toHaveLength(1);
    expect(overages[0]?.details).toBe("units=2");

    const recovered = await recoveredAudits(o.workspaceId);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.details).toContain(settlementErr.settlementId);
    expect(recovered[0]?.details).toContain("DB connection lost (injected)");

    const ledger = await prisma.aiOverageSettlement.findUniqueOrThrow({
      where: { settlementId: settlementErr.settlementId },
    });
    expect(ledger.units).toBe(2);
    expect(ledger.recovered).toBe(true);
    expect(ledger.attempts).toBe(3);
    expect(ledger.lastError).toContain("DB connection lost (injected)");

    expect(await readdir(spoolDir)).toEqual([]);

    // Next paid call is blocked at monthly limit=2 without calling the provider.
    const aiRecovered = createAiService(prisma, { provider, monthlyLimit: 2, spoolDir });
    await expect(aiRecovered.generate(o.userId, o.workspaceId, { kind: "ideas", prompt: "ещё" })).rejects.toThrow(
      /лимит/i,
    );
    expect(provider.calls).toBe(1);
  });

  it("2) idempotency: repeated recovery, leftover spool file, and caller retry never double-charge", async () => {
    const o = await workspace("pr69-a2");
    const spoolDir = await makeSpoolDir();
    const periodStart = await reserveUsage(prisma, o.workspaceId, USAGE_METRICS.ai, 1, new Date(), "limit", 1);
    const acc: PaidAccount = { workspaceId: o.workspaceId, periodStart, reserved: 1, charged: 4 };

    const { db } = dbOutageProxy(Number.POSITIVE_INFINITY);
    await expect(settlePaidAccount(db, acc, { spoolDir })).rejects.toBeInstanceOf(PaidSettlementError);
    expect(acc.settlementId).toBeTruthy();

    const spoolFile = path.join(spoolDir, `${acc.settlementId}.json`);
    const snapshot = await readFile(spoolFile, "utf8");

    // First recovery commits once.
    const r1 = await recoverPendingOverageSettlements(prisma, { spoolDir });
    expect(r1.recovered).toBe(1);
    expect(await usedUnits(o.workspaceId)).toBe(4);
    expect(await overageAudits(o.workspaceId)).toHaveLength(1);

    // Second recovery when spool is empty is a no-op.
    const r2 = await recoverPendingOverageSettlements(prisma, { spoolDir });
    expect(r2).toEqual({ scanned: 0, recovered: 0, deduplicated: 0, failed: 0, skipped: 0 });

    // Simulate crash before spool file deletion: restore the exact same spool file and run recovery again.
    await writeFile(spoolFile, snapshot, "utf8");
    const r3 = await recoverPendingOverageSettlements(prisma, { spoolDir });
    expect(r3).toEqual({ scanned: 1, recovered: 0, deduplicated: 1, failed: 0, skipped: 0 });
    expect(await usedUnits(o.workspaceId)).toBe(4);
    expect(await overageAudits(o.workspaceId)).toHaveLength(1);
    expect(await recoveredAudits(o.workspaceId)).toHaveLength(1);
    expect(await readdir(spoolDir)).toEqual([]);

    // Caller also retries settlePaidAccount(prisma, acc): idempotent, no double charge!
    await settlePaidAccount(prisma, acc, { spoolDir });
    expect(await usedUnits(o.workspaceId)).toBe(4);
    expect(await overageAudits(o.workspaceId)).toHaveLength(1);
    expect(acc).toMatchObject({ reserved: 4, charged: 4 });
  });

  it("3) concurrent recovery and caller retries on the same settlementId charge exactly once", async () => {
    const o = await workspace("pr69-a3");
    const spoolDir = await makeSpoolDir();
    const periodStart = await reserveUsage(prisma, o.workspaceId, USAGE_METRICS.ai, 1, new Date(), "limit", 1);
    const acc: PaidAccount = { workspaceId: o.workspaceId, periodStart, reserved: 1, charged: 5 };

    const { db } = dbOutageProxy(Number.POSITIVE_INFINITY);
    await expect(settlePaidAccount(db, acc, { spoolDir })).rejects.toBeInstanceOf(PaidSettlementError);

    const results = await Promise.all([
      recoverPendingOverageSettlements(prisma, { spoolDir }),
      recoverPendingOverageSettlements(prisma, { spoolDir }),
      recoverPendingOverageSettlements(prisma, { spoolDir }),
      settlePaidAccount(prisma, acc, { spoolDir }),
      settlePaidAccount(prisma, acc, { spoolDir }),
    ]);

    expect(results.length).toBe(5);
    expect(await usedUnits(o.workspaceId)).toBe(5);
    expect(await overageAudits(o.workspaceId)).toHaveLength(1);
    expect(await prisma.aiOverageSettlement.count({ where: { workspaceId: o.workspaceId } })).toBe(1);
    expect(await readdir(spoolDir)).toEqual([]);
  });

  it("4) concurrent recovery of multiple distinct failed settlements on one workspace records every unit once", async () => {
    const o = await workspace("pr69-a4");
    const spoolDir = await makeSpoolDir();
    const { db } = dbOutageProxy(Number.POSITIVE_INFINITY);
    const at = new Date();

    for (let i = 0; i < 4; i += 1) {
      const periodStart = await reserveUsage(prisma, o.workspaceId, USAGE_METRICS.ai, 10, at, "limit", 1);
      const acc: PaidAccount = { workspaceId: o.workspaceId, periodStart, reserved: 1, charged: 3 };
      await expect(settlePaidAccount(db, acc, { spoolDir })).rejects.toBeInstanceOf(PaidSettlementError);
    }

    expect(await usedUnits(o.workspaceId)).toBe(4);
    expect((await readdir(spoolDir)).length).toBe(4);

    const [s1, s2] = await Promise.all([
      recoverPendingOverageSettlements(prisma, { spoolDir }),
      recoverPendingOverageSettlements(prisma, { spoolDir }),
    ]);

    expect(s1.recovered + s2.recovered).toBe(4);
    expect(await usedUnits(o.workspaceId)).toBe(12);
    expect(await overageAudits(o.workspaceId)).toHaveLength(4);
    expect(await recoveredAudits(o.workspaceId)).toHaveLength(4);
    expect(await readdir(spoolDir)).toEqual([]);
  });

  it("5) failure-path settlement error preserves original sourceError and redacts secrets", async () => {
    const o = await workspace("pr69-a5");
    const spoolDir = await makeSpoolDir();
    const provider = scriptedProvider(
      3,
      "failure",
      "provider boom Bearer sk-testsecret1234567890",
    );
    const { db } = dbOutageProxy(
      Number.POSITIVE_INFINITY,
      "postgres://polka:polka_dev_password@localhost:5432/polka_social unreachable",
    );
    const ai = createAiService(db, { provider, monthlyLimit: 2, spoolDir });

    let caught: unknown;
    try {
      await ai.generate(o.userId, o.workspaceId, { kind: "ideas", prompt: "полки" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PaidSettlementError);
    const err = caught as PaidSettlementError;
    expect(err.sourceError).toBeInstanceOf(AccessError);
    expect(err.cause).toBe(err.sourceError);
    expect(err.settlementError).toBeInstanceOf(Error);
    expect(err.message).toContain("source error:");
    expect(err.message).toContain("unreachable");
    assertNoSecretLeak(err.message, "PaidSettlementError.message");

    const spoolRaw = await readFile(path.join(spoolDir, `${err.settlementId}.json`), "utf8");
    assertNoSecretLeak(spoolRaw, "spool file");
    expect(spoolRaw).toContain("provider boom");
    expect(spoolRaw).toContain("unreachable");

    await recoverPendingOverageSettlements(prisma, { spoolDir });
    const ledger = await prisma.aiOverageSettlement.findUniqueOrThrow({
      where: { settlementId: err.settlementId },
    });
    expect(ledger.sourceError).toContain("provider boom");
    assertNoSecretLeak(ledger.sourceError ?? "", "ledger.sourceError");
    assertNoSecretLeak(ledger.lastError ?? "", "ledger.lastError");

    const recAudit = await recoveredAudits(o.workspaceId);
    expect(recAudit).toHaveLength(1);
    assertNoSecretLeak(recAudit[0]?.details ?? "", "recovered audit");
  });

  it("6) releaseUsage DB failure in catch also preserves original sourceError", async () => {
    const o = await workspace("pr69-a6");
    const periodStart = await reserveUsage(prisma, o.workspaceId, USAGE_METRICS.ai, 10, new Date(), "limit", 2);
    const acc: PaidAccount = { workspaceId: o.workspaceId, periodStart, reserved: 2, charged: 0 };
    const failingReleaseDb = new Proxy(prisma, {
      get(target, prop) {
        if (prop === "$executeRaw") {
          return async () => {
            throw new Error("release DB down");
          };
        }
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    }) as PrismaClient;

    const original = new AccessError(400, "upstream provider error");
    let caught: unknown;
    try {
      await settlePaidAccount(failingReleaseDb, acc, { sourceError: original });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PaidSettlementError);
    const err = caught as PaidSettlementError;
    expect(err.sourceError).toBe(original);
    expect(err.cause).toBe(original);
    expect(err.message).toContain("release DB down");
    expect(err.message).toContain("upstream provider error");
  });

  it("7) automatic recovery on subsequent ai.usage / ai.generate enforces monthly limit without calling provider", async () => {
    const o = await workspace("pr69-a7");
    const spoolDir = await makeSpoolDir();
    const provider = scriptedProvider(3);
    const { db } = dbOutageProxy(Number.POSITIVE_INFINITY);
    const failingAi = createAiService(db, { provider, monthlyLimit: 2, spoolDir });

    await expect(failingAi.generate(o.userId, o.workspaceId, { kind: "ideas", prompt: "полки" })).rejects.toBeInstanceOf(
      PaidSettlementError,
    );
    expect(provider.calls).toBe(1);

    // Next call on healthy DB recovers spooled overage first, then blocks at limit=2.
    const healthyAi = createAiService(prisma, { provider, monthlyLimit: 2, spoolDir });
    const usage = await healthyAi.usage(o.userId, o.workspaceId);
    expect(usage.used).toBe(3);

    await expect(healthyAi.generate(o.userId, o.workspaceId, { kind: "ideas", prompt: "снова" })).rejects.toThrow(
      /лимит/i,
    );
    expect(provider.calls).toBe(1);
    expect(await readdir(spoolDir)).toEqual([]);
  });

  it("8) recovery still fails safely and increments attempts if DB remains down, then succeeds later", async () => {
    const o = await workspace("pr69-a8");
    const spoolDir = await makeSpoolDir();
    const periodStart = await reserveUsage(prisma, o.workspaceId, USAGE_METRICS.ai, 1, new Date(), "limit", 1);
    const acc: PaidAccount = { workspaceId: o.workspaceId, periodStart, reserved: 1, charged: 3 };

    const { db } = dbOutageProxy(Number.POSITIVE_INFINITY, "first outage");
    await expect(settlePaidAccount(db, acc, { spoolDir })).rejects.toBeInstanceOf(PaidSettlementError);

    const { db: stillDown } = dbOutageProxy(Number.POSITIVE_INFINITY, "still down");
    const rFail = await recoverPendingOverageSettlements(stillDown, { spoolDir });
    expect(rFail).toEqual({ scanned: 1, recovered: 0, deduplicated: 0, failed: 1, skipped: 0 });
    expect(await usedUnits(o.workspaceId)).toBe(1);

    const spoolJson = JSON.parse(await readFile(path.join(spoolDir, `${acc.settlementId}.json`), "utf8")) as {
      attempts: number;
      lastError: string;
    };
    expect(spoolJson.attempts).toBe(3);
    expect(spoolJson.lastError).toContain("still down");

    const rOk = await recoverPendingOverageSettlements(prisma, { spoolDir });
    expect(rOk).toEqual({ scanned: 1, recovered: 1, deduplicated: 0, failed: 0, skipped: 0 });
    expect(await usedUnits(o.workspaceId)).toBe(3);
  });

  it("9) unwritable spool path reports spooled=false instead of silently pretending durability", async () => {
    const o = await workspace("pr69-a9");
    const dir = await makeSpoolDir();
    const blockedPath = path.join(dir, "not-a-directory");
    await writeFile(blockedPath, "file", "utf8");

    const periodStart = await reserveUsage(prisma, o.workspaceId, USAGE_METRICS.ai, 1, new Date(), "limit", 1);
    const acc: PaidAccount = { workspaceId: o.workspaceId, periodStart, reserved: 1, charged: 3 };
    const { db } = dbOutageProxy(Number.POSITIVE_INFINITY);

    let caught: unknown;
    try {
      await settlePaidAccount(db, acc, { spoolDir: blockedPath, sourceError: new Error("orig") });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PaidSettlementError);
    const err = caught as PaidSettlementError;
    expect(err.spooled).toBe(false);
    expect(err.sourceError).toBeInstanceOf(Error);
  });

  it("10) post-restore missing UsageRecord row is upserted during recovery so spend is never silently dropped", async () => {
    const o = await workspace("pr69-a10");
    const spoolDir = await makeSpoolDir();
    const periodStart = await reserveUsage(prisma, o.workspaceId, USAGE_METRICS.ai, 1, new Date(), "limit", 1);
    const acc: PaidAccount = { workspaceId: o.workspaceId, periodStart, reserved: 1, charged: 3 };

    const { db } = dbOutageProxy(Number.POSITIVE_INFINITY);
    await expect(settlePaidAccount(db, acc, { spoolDir })).rejects.toBeInstanceOf(PaidSettlementError);

    // Simulate restoring DB to a snapshot before the UsageRecord row existed.
    await prisma.usageRecord.deleteMany({ where: { workspaceId: o.workspaceId } });
    expect(await usedUnits(o.workspaceId)).toBe(0);

    const r = await recoverPendingOverageSettlements(prisma, { spoolDir });
    expect(r.recovered).toBe(1);
    expect(await usedUnits(o.workspaceId)).toBe(2);
    expect(await overageAudits(o.workspaceId)).toHaveLength(1);
  });
});
