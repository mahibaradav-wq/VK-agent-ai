import type * as FsPromises from "node:fs/promises";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { createAiService } from "@/modules/ai/ai-service";
import {
  AI_USAGE_OVERAGE_ACTION,
  AI_USAGE_OVERAGE_RECOVERED_ACTION,
  AiAccountingPendingError,
  PaidSettlementError,
  recoverPendingOverageSettlements,
  settlePaidAccount,
  type PaidAccount,
} from "@/modules/ai/paid-settlement";
import { createAuthService } from "@/modules/auth/auth-service";
import { reserveUsage, USAGE_METRICS } from "@/modules/billing/usage";
import type { AiProvider } from "@/server/ai/types";
import { prisma } from "@/server/db/prisma";

const fsFaults = vi.hoisted(() => {
  type Fault = { op: string; code: string; match: (target: string) => boolean; remaining: number };
  const state = {
    faults: [] as Fault[],
    syncedPaths: [] as string[],
    add(op: string, code: string, match: (target: string) => boolean, times = Number.POSITIVE_INFINITY) {
      state.faults.push({ op, code, match, remaining: times });
    },
    reset() {
      state.faults = [];
      state.syncedPaths = [];
    },
    check(op: string, target: string) {
      const fault = state.faults.find((item) => item.op === op && item.remaining > 0 && item.match(target));
      if (!fault) {
        return;
      }
      fault.remaining -= 1;
      const error = new Error(`${fault.code}: injected ${op} failure, '${target}'`) as Error & { code: string };
      error.code = fault.code;
      throw error;
    },
  };
  return state;
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  type Handle = Awaited<ReturnType<typeof actual.open>>;
  const wrapHandle = (handle: Handle, target: string): Handle =>
    new Proxy(handle, {
      get(base, prop) {
        if (prop === "sync") {
          return async () => {
            fsFaults.check("sync", target);
            await base.sync();
            fsFaults.syncedPaths.push(target);
          };
        }
        if (prop === "readFile") {
          return async (...args: unknown[]) => {
            fsFaults.check("readFile", target);
            return (base.readFile as (...a: unknown[]) => Promise<unknown>)(...args);
          };
        }
        const value = Reflect.get(base, prop, base) as unknown;
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(base) : value;
      },
    });
  const mocked = {
    ...actual,
    readdir: (async (target: string, ...rest: unknown[]) => {
      fsFaults.check("readdir", String(target));
      return (actual.readdir as (...a: unknown[]) => Promise<unknown>)(target, ...rest);
    }) as typeof actual.readdir,
    rename: (async (from: string, to: string) => {
      fsFaults.check("rename", String(to));
      return actual.rename(from, to);
    }) as typeof actual.rename,
    open: (async (target: string, ...rest: unknown[]) => {
      fsFaults.check("open", String(target));
      const handle = await (actual.open as (...a: unknown[]) => Promise<Handle>)(target, ...rest);
      return wrapHandle(handle, String(target));
    }) as typeof actual.open,
  };
  return { ...mocked, default: mocked };
});

const auth = createAuthService(prisma, "http://localhost:3000");
const tempDirs: string[] = [];

async function makeSpoolDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "polka-pr70-spool-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  fsFaults.reset();
});

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

async function auditCount(workspaceId: string, action: string) {
  return prisma.auditLog.count({ where: { action, entityId: workspaceId } });
}

async function pendingDenials(workspaceId: string) {
  return prisma.auditLog.findMany({
    where: { action: "AI_PAID_DENIED", entityId: workspaceId, details: { startsWith: "overage_recovery_pending" } },
  });
}

function countingProvider(paidCalls = 1) {
  const self = {
    name: "scripted",
    model: "m",
    imageModel: "i",
    ready: true,
    imageReady: true,
    calls: 0,
    async generate() {
      self.calls += 1;
      return {
        title: "Полки",
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

/** Real Prisma client whose AI_USAGE_OVERAGE audit insert fails when `shouldFail(details)` is true. */
function overageFailingDb(shouldFail: (details: string) => boolean, message = "PostgreSQL connection lost (injected)") {
  const wrapAudit = (auditLog: PrismaClient["auditLog"]) =>
    new Proxy(auditLog, {
      get(target, prop) {
        if (prop === "create") {
          return async (args: { data: { action?: string; details?: string } }) => {
            if (args.data.action === AI_USAGE_OVERAGE_ACTION && shouldFail(args.data.details ?? "")) {
              throw new Error(message);
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
              return root.$transaction((tx) => (arg as (t: unknown) => Promise<unknown>)(wrapClient(tx)), opts as never);
            }
            return root.$transaction(arg as never, opts as never);
          };
        }
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
  return wrapClient(prisma) as PrismaClient;
}

const dbDown = () => overageFailingDb(() => true);

/** Leaves one confirmed-but-unrecorded overage of `overage` units in the spool for the workspace. */
async function spoolPendingOverage(workspaceId: string, spoolDir: string, overage = 2) {
  const periodStart = await reserveUsage(prisma, workspaceId, USAGE_METRICS.ai, 100, new Date(), "limit", 1);
  const account: PaidAccount = { workspaceId, periodStart, reserved: 1, charged: 1 + overage };
  const error = await settlePaidAccount(dbDown(), account, { spoolDir }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(PaidSettlementError);
  expect((error as PaidSettlementError).spooled).toBe(true);
  return { settlementId: account.settlementId!, file: path.join(spoolDir, `${account.settlementId}.json`) };
}

const generateInput = { kind: "ideas", prompt: "полки в прихожую" };

describe("PR70 Block A/C: paid AI is fail-closed while spooled overage is unconfirmed (real test DB)", () => {
  it("spool directory access error blocks the paid provider, free reads still work, then recovery reopens", async () => {
    const o = await workspace("pr70-dir");
    const spoolDir = await makeSpoolDir();
    await spoolPendingOverage(o.workspaceId, spoolDir, 2);
    expect(await usedUnits(o.workspaceId)).toBe(1);

    const provider = countingProvider(1);
    const ai = createAiService(prisma, { provider, monthlyLimit: 100, spoolDir });
    fsFaults.add("readdir", "EACCES", (target) => target === spoolDir);

    const error = await ai.generate(o.userId, o.workspaceId, generateInput).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiAccountingPendingError);
    expect((error as AiAccountingPendingError).status).toBe(409);
    expect((error as AiAccountingPendingError).diagnostic).toContain("EACCES");
    expect(provider.calls).toBe(0);
    expect(await usedUnits(o.workspaceId)).toBe(1);
    expect(await pendingDenials(o.workspaceId)).toHaveLength(1);

    // Free operations stay available and the diagnostic is visible.
    expect((await ai.usage(o.userId, o.workspaceId)).used).toBe(1);
    await expect(ai.list(o.userId, o.workspaceId)).resolves.toEqual([]);
    const blocked = await ai.overageRecoveryStatus(o.userId, o.workspaceId);
    expect(blocked.paidAiBlocked).toBe(true);
    expect(blocked.diagnostic).toContain("EACCES");

    fsFaults.reset();
    const status = await ai.overageRecoveryStatus(o.userId, o.workspaceId);
    expect(status).toMatchObject({ paidAiBlocked: false, diagnostic: null });
    expect(status.summary).toMatchObject({ recovered: 1, failed: 0 });
    expect(await usedUnits(o.workspaceId)).toBe(3);

    await ai.generate(o.userId, o.workspaceId, generateInput);
    expect(provider.calls).toBe(1);
    expect(await usedUnits(o.workspaceId)).toBe(4);
    expect(await auditCount(o.workspaceId, AI_USAGE_OVERAGE_ACTION)).toBe(1);
    expect(await auditCount(o.workspaceId, AI_USAGE_OVERAGE_RECOVERED_ACTION)).toBe(1);
  });

  it("spool read error with a healthy PostgreSQL blocks paid AI and keeps the file for a later retry", async () => {
    const o = await workspace("pr70-read");
    const spoolDir = await makeSpoolDir();
    const { file } = await spoolPendingOverage(o.workspaceId, spoolDir, 2);

    const provider = countingProvider(1);
    const ai = createAiService(prisma, { provider, monthlyLimit: 100, spoolDir });
    fsFaults.add("readFile", "EIO", (target) => target === file);

    await expect(ai.generate(o.userId, o.workspaceId, generateInput)).rejects.toBeInstanceOf(AiAccountingPendingError);
    expect(provider.calls).toBe(0);
    expect(await usedUnits(o.workspaceId)).toBe(1);
    expect(await readdir(spoolDir)).toEqual([path.basename(file)]);
    expect(await auditCount(o.workspaceId, AI_USAGE_OVERAGE_ACTION)).toBe(0);

    fsFaults.reset();
    await ai.generate(o.userId, o.workspaceId, generateInput);
    expect(provider.calls).toBe(1);
    expect(await usedUnits(o.workspaceId)).toBe(4);
    expect(await readdir(spoolDir)).toEqual([]);
    expect(await auditCount(o.workspaceId, AI_USAGE_OVERAGE_ACTION)).toBe(1);
  });

  it("PostgreSQL failure during recovery blocks paid AI; later recovery charges exactly once", async () => {
    const o = await workspace("pr70-pg");
    const spoolDir = await makeSpoolDir();
    await spoolPendingOverage(o.workspaceId, spoolDir, 2);

    const provider = countingProvider(1);
    const downAi = createAiService(dbDown(), { provider, monthlyLimit: 100, spoolDir });
    const error = await downAi.generate(o.userId, o.workspaceId, generateInput).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiAccountingPendingError);
    expect((error as AiAccountingPendingError).summary).toMatchObject({ failed: 1, recovered: 0 });
    expect(provider.calls).toBe(0);
    expect(await usedUnits(o.workspaceId)).toBe(1);

    const ai = createAiService(prisma, { provider, monthlyLimit: 100, spoolDir });
    const [s1, s2, s3] = await Promise.all([
      ai.overageRecoveryStatus(o.userId, o.workspaceId),
      ai.overageRecoveryStatus(o.userId, o.workspaceId),
      recoverPendingOverageSettlements(prisma, { spoolDir }),
    ]);
    expect([s1, s2].every((s) => !s.paidAiBlocked)).toBe(true);
    expect((s1.summary?.recovered ?? 0) + (s2.summary?.recovered ?? 0) + s3.recovered).toBe(1);
    expect(await usedUnits(o.workspaceId)).toBe(3);

    // Repeated recovery and a second generate never double-charge the recovered overage.
    expect((await recoverPendingOverageSettlements(prisma, { spoolDir })).recovered).toBe(0);
    await ai.generate(o.userId, o.workspaceId, generateInput);
    await ai.generate(o.userId, o.workspaceId, generateInput);
    expect(provider.calls).toBe(2);
    expect(await usedUnits(o.workspaceId)).toBe(5);
    expect(await auditCount(o.workspaceId, AI_USAGE_OVERAGE_ACTION)).toBe(1);
    expect(await prisma.aiOverageSettlement.count({ where: { workspaceId: o.workspaceId } })).toBe(1);
  });

  it("a single failing spool entry blocks only its workspace; other workspaces recover and keep working", async () => {
    const a = await workspace("pr70-one-a");
    const b = await workspace("pr70-one-b");
    const spoolDir = await makeSpoolDir();
    await spoolPendingOverage(a.workspaceId, spoolDir, 7);
    await spoolPendingOverage(b.workspaceId, spoolDir, 2);

    const provider = countingProvider(1);
    const partialDb = overageFailingDb((details) => details === "units=7", "record-level PostgreSQL error");
    const ai = createAiService(partialDb, { provider, monthlyLimit: 100, spoolDir });

    const summary = await recoverPendingOverageSettlements(partialDb, { spoolDir });
    expect(summary).toMatchObject({ scanned: 2, recovered: 1, failed: 1 });
    expect(await usedUnits(a.workspaceId)).toBe(1);
    expect(await usedUnits(b.workspaceId)).toBe(3);

    await expect(ai.generate(a.userId, a.workspaceId, generateInput)).rejects.toBeInstanceOf(AiAccountingPendingError);
    expect(provider.calls).toBe(0);
    await ai.generate(b.userId, b.workspaceId, generateInput);
    expect(provider.calls).toBe(1);
    expect(await usedUnits(b.workspaceId)).toBe(4);

    const healthy = createAiService(prisma, { provider, monthlyLimit: 100, spoolDir });
    await healthy.generate(a.userId, a.workspaceId, generateInput);
    expect(provider.calls).toBe(2);
    expect(await usedUnits(a.workspaceId)).toBe(9);
    expect(await auditCount(a.workspaceId, AI_USAGE_OVERAGE_ACTION)).toBe(1);
    expect(await auditCount(b.workspaceId, AI_USAGE_OVERAGE_ACTION)).toBe(1);
    expect(await readdir(spoolDir)).toEqual([]);
  });

  it("an unreadable spool payload (unknown workspace) keeps paid AI closed instead of guessing", async () => {
    const o = await workspace("pr70-corrupt");
    const spoolDir = await makeSpoolDir();
    await writeFile(path.join(spoolDir, "corrupt-entry.json"), "{not json", { mode: 0o600 });

    const provider = countingProvider(1);
    const ai = createAiService(prisma, { provider, monthlyLimit: 100, spoolDir });
    await expect(ai.generate(o.userId, o.workspaceId, generateInput)).rejects.toBeInstanceOf(AiAccountingPendingError);
    expect(provider.calls).toBe(0);
    expect(await readdir(spoolDir)).toEqual(["corrupt-entry.json"]);
  });

  it("a symlinked spool directory is refused and blocks paid AI", async () => {
    const o = await workspace("pr70-symlink");
    const realDir = await makeSpoolDir();
    const linkDir = path.join(await makeSpoolDir(), "spool-link");
    await symlink(realDir, linkDir);

    const provider = countingProvider(1);
    const ai = createAiService(prisma, { provider, monthlyLimit: 100, spoolDir: linkDir });
    await expect(ai.generate(o.userId, o.workspaceId, generateInput)).rejects.toBeInstanceOf(AiAccountingPendingError);
    expect(provider.calls).toBe(0);
  });
});

describe("PR70 Block B: spool durability (atomic write, rename, fsync, permissions)", () => {
  async function failingSettle(spoolDir: string, overage = 2) {
    const o = await workspace("pr70-b");
    const periodStart = await reserveUsage(prisma, o.workspaceId, USAGE_METRICS.ai, 100, new Date(), "limit", 1);
    const account: PaidAccount = { workspaceId: o.workspaceId, periodStart, reserved: 1, charged: 1 + overage };
    const error = (await settlePaidAccount(dbDown(), account, { spoolDir }).catch((e: unknown) => e)) as PaidSettlementError;
    expect(error).toBeInstanceOf(PaidSettlementError);
    return { o, error, account };
  }

  it("fsyncs the temp file and the spool directory after rename; new dir/file are 0700/0600", async () => {
    const base = await makeSpoolDir();
    const spoolDir = path.join(base, "nested", "spool");
    const { error } = await failingSettle(spoolDir);
    expect(error.spooled).toBe(true);

    const target = path.join(spoolDir, `${error.settlementId}.json`);
    expect(fsFaults.syncedPaths.some((p) => p.startsWith(`${target}.tmp.`))).toBe(true);
    expect(fsFaults.syncedPaths).toContain(spoolDir);
    expect((await stat(spoolDir)).mode & 0o777).toBe(0o700);
    expect((await stat(path.dirname(spoolDir))).mode & 0o777).toBe(0o700);
    expect((await stat(target)).mode & 0o777).toBe(0o600);
  });

  /** Directory fsyncs, in call order, restricted to the given directories. */
  function dirSyncOrder(dirs: string[]) {
    return fsFaults.syncedPaths.filter((p) => dirs.includes(p));
  }

  it("one new level: fsyncs the existing parent (which holds the new entry), then the spool dir after rename", async () => {
    const base = await makeSpoolDir();
    const spoolDir = path.join(base, "spool");
    const { error } = await failingSettle(spoolDir);
    expect(error.spooled).toBe(true);
    expect(dirSyncOrder([base, spoolDir])).toEqual([base, spoolDir]);
  });

  it("two new levels: fsyncs base, then the immediate parent of the spool dir, then the spool dir", async () => {
    const base = await makeSpoolDir();
    const parent = path.join(base, "a");
    const spoolDir = path.join(parent, "spool");
    const { error } = await failingSettle(spoolDir);
    expect(error.spooled).toBe(true);
    expect(dirSyncOrder([base, parent, spoolDir])).toEqual([base, parent, spoolDir]);
  });

  it("three new levels: every created level's parent is fsynced top-down before the file rename is synced", async () => {
    const base = await makeSpoolDir();
    const a = path.join(base, "a");
    const b = path.join(a, "b");
    const spoolDir = path.join(b, "spool");
    const { error } = await failingSettle(spoolDir);
    expect(error.spooled).toBe(true);
    expect(dirSyncOrder([base, a, b, spoolDir])).toEqual([base, a, b, spoolDir]);
    for (const dir of [a, b, spoolDir]) {
      expect((await stat(dir)).mode & 0o777).toBe(0o700);
    }
  });

  it("pre-existing spool dir: no ancestor fsync is repeated, only the spool dir after rename", async () => {
    const base = await makeSpoolDir();
    const spoolDir = path.join(base, "spool");
    await mkdir(spoolDir, { mode: 0o700 });
    const { error } = await failingSettle(spoolDir);
    expect(error.spooled).toBe(true);
    expect(dirSyncOrder([base, spoolDir])).toEqual([spoolDir]);
  });

  it("EIO on fsync of the immediate parent gives spooled=false, no file, and a retry syncs it before writing", async () => {
    const base = await makeSpoolDir();
    const parent = path.join(base, "a");
    const spoolDir = path.join(parent, "spool");
    fsFaults.add("sync", "EIO", (target) => target === parent, 1);
    const first = await failingSettle(spoolDir);
    expect(first.error.spooled).toBe(false);
    expect(await readdir(spoolDir)).toEqual([]);

    fsFaults.syncedPaths.length = 0;
    const second = await failingSettle(spoolDir);
    expect(second.error.spooled).toBe(true);
    expect(dirSyncOrder([base, parent, spoolDir])).toEqual([parent, spoolDir]);
    const summary = await recoverPendingOverageSettlements(prisma, { spoolDir });
    expect(summary).toMatchObject({ recovered: 1, failed: 0 });
    expect(await usedUnits(second.o.workspaceId)).toBe(3);
    expect(await readdir(spoolDir)).toEqual([]);
  });

  it("EIO on a higher ancestor fsync (base) also refuses durability and is retried on the next write", async () => {
    const base = await makeSpoolDir();
    const spoolDir = path.join(base, "a", "b", "spool");
    fsFaults.add("sync", "EIO", (target) => target === base, 1);
    const first = await failingSettle(spoolDir);
    expect(first.error.spooled).toBe(false);

    fsFaults.syncedPaths.length = 0;
    const second = await failingSettle(spoolDir);
    expect(second.error.spooled).toBe(true);
    expect(dirSyncOrder([base, spoolDir])).toEqual([base, spoolDir]);
  });

  it("EINVAL/ENOTSUP/EOPNOTSUPP on parent directory fsync are tolerated for every created level", async () => {
    for (const code of ["EINVAL", "ENOTSUP", "EOPNOTSUPP"]) {
      const base = await makeSpoolDir();
      const spoolDir = path.join(base, "a", "b", "spool");
      fsFaults.add("sync", code, (target) => target === base || target === path.join(base, "a") || target === path.join(base, "a", "b"));
      const { error } = await failingSettle(spoolDir);
      expect(error.spooled, code).toBe(true);
      fsFaults.reset();
    }
  });

  it("an already renamed spool file survives a failing parent/directory fsync and is recovered later", async () => {
    const base = await makeSpoolDir();
    const spoolDir = path.join(base, "a", "spool");
    const stored = await failingSettle(spoolDir);
    expect(stored.error.spooled).toBe(true);
    const storedFile = `${stored.error.settlementId}.json`;

    fsFaults.add("sync", "EIO", (target) => target === spoolDir, 1);
    const failed = await failingSettle(spoolDir);
    expect(failed.error.spooled).toBe(false);
    expect((await readdir(spoolDir)).sort()).toEqual([storedFile, `${failed.error.settlementId}.json`].sort());

    const summary = await recoverPendingOverageSettlements(prisma, { spoolDir });
    expect(summary).toMatchObject({ scanned: 2, recovered: 2, failed: 0 });
    expect(await usedUnits(stored.o.workspaceId)).toBe(3);
    expect(await usedUnits(failed.o.workspaceId)).toBe(3);
    expect(await readdir(spoolDir)).toEqual([]);
  });

  it("tightens permissions of a pre-existing spool directory and of a world-readable spool file", async () => {
    const spoolDir = await makeSpoolDir();
    await chmod(spoolDir, 0o755);
    const { error } = await failingSettle(spoolDir);
    expect((await stat(spoolDir)).mode & 0o777).toBe(0o700);

    const file = path.join(spoolDir, `${error.settlementId}.json`);
    await chmod(file, 0o644);
    // Recovery fails (DB down) and its rewrite fails too, so the original file must be kept and tightened.
    fsFaults.add("rename", "EIO", (target) => target === file);
    const summary = await recoverPendingOverageSettlements(dbDown(), { spoolDir });
    expect(summary.failed).toBe(1);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("write (fsync of temp file) failure reports spooled=false and leaves no temp files", async () => {
    const spoolDir = await makeSpoolDir();
    fsFaults.add("sync", "EIO", (target) => target.includes(".json.tmp."));
    const { error } = await failingSettle(spoolDir);
    expect(error.spooled).toBe(false);
    expect(await readdir(spoolDir)).toEqual([]);
  });

  it("rename failure reports spooled=false and cleans up the temp file", async () => {
    const spoolDir = await makeSpoolDir();
    fsFaults.add("rename", "EXDEV", (target) => target.endsWith(".json"));
    const { error } = await failingSettle(spoolDir);
    expect(error.spooled).toBe(false);
    expect(await readdir(spoolDir)).toEqual([]);
  });

  it("directory fsync EIO is not reported as durable, but the renamed entry is kept and recoverable", async () => {
    const spoolDir = await makeSpoolDir();
    fsFaults.add("sync", "EIO", (target) => target === spoolDir, 1);
    const { o, error } = await failingSettle(spoolDir);
    expect(error.spooled).toBe(false);
    expect(await readdir(spoolDir)).toEqual([`${error.settlementId}.json`]);

    const summary = await recoverPendingOverageSettlements(prisma, { spoolDir });
    expect(summary).toMatchObject({ recovered: 1, failed: 0 });
    expect(await usedUnits(o.workspaceId)).toBe(3);
  });

  it("directory fsync unsupported (EINVAL) is tolerated and the entry counts as durable", async () => {
    const spoolDir = await makeSpoolDir();
    fsFaults.add("sync", "EINVAL", (target) => target === spoolDir);
    const { error } = await failingSettle(spoolDir);
    expect(error.spooled).toBe(true);
  });

  it("never deletes the spool entry before PostgreSQL confirms the settlement", async () => {
    const spoolDir = await makeSpoolDir();
    const { o, error } = await failingSettle(spoolDir);
    const file = path.join(spoolDir, `${error.settlementId}.json`);
    const before = JSON.parse(await readFile(file, "utf8")) as { attempts: number };

    // Recovery fails in PostgreSQL and the diagnostics rewrite also fails: the original entry survives.
    fsFaults.add("rename", "ENOSPC", (target) => target === file);
    expect((await recoverPendingOverageSettlements(dbDown(), { spoolDir })).failed).toBe(1);
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ attempts: before.attempts });
    fsFaults.reset();

    expect((await recoverPendingOverageSettlements(dbDown(), { spoolDir })).failed).toBe(1);
    expect(await readdir(spoolDir)).toEqual([path.basename(file)]);
    expect(await usedUnits(o.workspaceId)).toBe(1);

    expect((await recoverPendingOverageSettlements(prisma, { spoolDir })).recovered).toBe(1);
    expect(await readdir(spoolDir)).toEqual([]);
    expect(await usedUnits(o.workspaceId)).toBe(3);
  });

  it("a symlinked spool file is not followed and is reported as failed", async () => {
    const spoolDir = await makeSpoolDir();
    const outside = path.join(await makeSpoolDir(), "outside.json");
    await writeFile(outside, "{}", "utf8");
    await mkdir(spoolDir, { recursive: true });
    await symlink(outside, path.join(spoolDir, "linked.json"));
    const summary = await recoverPendingOverageSettlements(prisma, { spoolDir });
    expect(summary).toMatchObject({ scanned: 1, failed: 1 });
  });
});
