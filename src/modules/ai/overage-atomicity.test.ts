import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createAiService } from "@/modules/ai/ai-service";
import { settlePaidAccount, type PaidAccount } from "@/modules/ai/paid-settlement";
import { createAuthService } from "@/modules/auth/auth-service";
import { reserveUsage, USAGE_METRICS } from "@/modules/billing/usage";
import { createProjectService } from "@/modules/projects/project-service";
import type { AiProvider } from "@/server/ai/types";
import { prisma } from "@/server/db/prisma";
import { createLocalStorage } from "@/server/storage/local-storage";

const OVERAGE = "AI_USAGE_OVERAGE";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const auth = createAuthService(prisma, "http://localhost:3000");

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
  return prisma.auditLog.findMany({ where: { action: OVERAGE, entityId: workspaceId }, orderBy: { createdAt: "asc" } });
}

/** Provider that reports `paidCalls` paid HTTP calls per generate (success or failure). */
function scriptedProvider(paidCalls: number, mode: "success" | "failure" = "success") {
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
        const error = new AccessError(400, "провайдер упал после платных HTTP");
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
      self.imageCalls += 1;
      return { bytes: PNG, mimeType: "image/png" as const, provider: "scripted", model: "i", paidCalls: 1 };
    },
  };
  return self satisfies AiProvider;
}

/**
 * Real Prisma client whose AI_USAGE_OVERAGE audit insert fails `failures` times,
 * both on the root client and inside interactive transactions.
 */
function auditFailingDb(failures: number) {
  const state = { remaining: failures, attempts: 0 };
  const wrapAudit = (auditLog: PrismaClient["auditLog"]) =>
    new Proxy(auditLog, {
      get(target, prop) {
        if (prop === "create") {
          return async (args: { data: { action?: string } }) => {
            if (args.data.action === OVERAGE) {
              state.attempts += 1;
              if (state.remaining > 0) {
                state.remaining -= 1;
                throw new Error("audit insert failed (injected)");
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

describe("PR68 AI overage atomicity (real test DB)", () => {
  it("1) normal overage: spend and audit recorded exactly once", async () => {
    const o = await workspace("pr68-t1");
    const provider = scriptedProvider(3);
    const ai = createAiService(prisma, { provider, monthlyLimit: 2 });

    await expect(ai.generate(o.userId, o.workspaceId, { kind: "ideas", prompt: "полки" })).rejects.toThrow(/лимит/i);

    expect(provider.calls).toBe(1);
    expect(await usedUnits(o.workspaceId)).toBe(3);
    const audits = await overageAudits(o.workspaceId);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.details).toBe("units=2");
  });

  it("2) audit insert fails: the transaction rolls back UsageRecord.used (no hidden overage)", async () => {
    const o = await workspace("pr68-t2");
    const provider = scriptedProvider(3);
    const { db, state } = auditFailingDb(Number.POSITIVE_INFINITY);
    const ai = createAiService(db, { provider, monthlyLimit: 2 });

    await expect(ai.generate(o.userId, o.workspaceId, { kind: "ideas", prompt: "полки" })).rejects.toThrow(
      /audit insert failed/,
    );

    expect(state.attempts).toBeGreaterThanOrEqual(1);
    // Only the original 1-unit reserve stays; no overage without its audit row.
    expect(await usedUnits(o.workspaceId)).toBe(1);
    expect(await overageAudits(o.workspaceId)).toHaveLength(0);
  });

  it("3) retry after a failed audit: spend and audit recorded exactly once", async () => {
    const o = await workspace("pr68-t3");
    const provider = scriptedProvider(3);
    const { db, state } = auditFailingDb(1);
    const ai = createAiService(db, { provider, monthlyLimit: 2 });

    await expect(ai.generate(o.userId, o.workspaceId, { kind: "ideas", prompt: "полки" })).rejects.toThrow(/лимит/i);

    expect(state.attempts).toBe(2);
    expect(await usedUnits(o.workspaceId)).toBe(3);
    expect(await overageAudits(o.workspaceId)).toHaveLength(1);
  });

  it("3b) failure-path overage with one failed audit: still exactly once", async () => {
    const o = await workspace("pr68-t3b");
    const provider = scriptedProvider(3, "failure");
    const { db, state } = auditFailingDb(1);
    const ai = createAiService(db, { provider, monthlyLimit: 2 });

    await expect(ai.generate(o.userId, o.workspaceId, { kind: "ideas", prompt: "полки" })).rejects.toBeInstanceOf(
      Error,
    );

    expect(state.attempts).toBe(2);
    expect(await usedUnits(o.workspaceId)).toBe(3);
    expect(await overageAudits(o.workspaceId)).toHaveLength(1);
  });

  it("5) error after a successful settle: re-handling adds no spend and releases nothing twice", async () => {
    const o = await workspace("pr68-t5");
    const project = await createProjectService(prisma).create(o.userId, o.workspaceId, { name: "Проект PR68" });
    let settled = false;
    const failingPost = new Proxy({}, { get: () => async () => Promise.reject(new Error("post read failed after settle")) });
    const db = new Proxy(prisma, {
      get(target, prop) {
        if (prop === "$executeRaw") {
          return async (...args: Parameters<typeof prisma.$executeRaw>) => {
            const result = await target.$executeRaw(...args);
            settled = true;
            return result;
          };
        }
        if (prop === "post" && settled) {
          return failingPost;
        }
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    }) as PrismaClient;
    const provider = scriptedProvider(1);
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "polka-pr68-"));
    const ai = createAiService(db, { provider, monthlyLimit: 20, storage: createLocalStorage(storageDir) });

    await expect(
      ai.composeAgentPost(o.userId, o.workspaceId, { prompt: "полки", platform: "telegram", projectId: project.id }),
    ).rejects.toThrow(/post read failed after settle/);

    expect(settled).toBe(true);
    expect(provider.calls + provider.imageCalls).toBe(2);
    expect(await usedUnits(o.workspaceId)).toBe(2);
    expect(await overageAudits(o.workspaceId)).toHaveLength(0);
  });

  it("6) charged < reserved: the remainder is released exactly once", async () => {
    const o = await workspace("pr68-t6");
    const provider = scriptedProvider(1);
    const ai = createAiService(prisma, { provider, monthlyLimit: 10 });

    await ai.generate(o.userId, o.workspaceId, { kind: "post", prompt: "борщ на ужин" });

    expect(provider.calls).toBe(1);
    expect(await usedUnits(o.workspaceId)).toBe(1);
    expect(await overageAudits(o.workspaceId)).toHaveLength(0);
  });

  it("7a) concurrent overages: no lost or duplicated units", async () => {
    const o = await workspace("pr68-t7a");
    const provider = scriptedProvider(3);
    const ai = createAiService(prisma, { provider, monthlyLimit: 4 });

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => ai.generate(o.userId, o.workspaceId, { kind: "ideas", prompt: "полки" })),
    );

    expect(results.every((result) => result.status === "rejected" || result.status === "fulfilled")).toBe(true);
    expect(provider.calls).toBeGreaterThanOrEqual(1);
    const used = await usedUnits(o.workspaceId);
    // Every executed generate paid exactly 3 units; nothing lost, nothing counted twice.
    expect(used).toBe(provider.calls * 3);
    const audits = await overageAudits(o.workspaceId);
    expect(audits.length).toBeLessThanOrEqual(provider.calls);
    const auditedUnits = audits.reduce((sum, row) => sum + Number(row.details?.replace("units=", "") ?? 0), 0);
    // Overage is exactly the part of the spend that could not be reserved under the limit.
    expect(used - auditedUnits).toBeLessThanOrEqual(4);
  });

  it("7b) concurrent normal generates: limit holds and every paid call is counted once", async () => {
    const o = await workspace("pr68-t7b");
    const provider = scriptedProvider(1);
    const ai = createAiService(prisma, { provider, monthlyLimit: 3 });

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => ai.generate(o.userId, o.workspaceId, { kind: "ideas", prompt: "полки" })),
    );

    const fulfilled = results.filter((result) => result.status === "fulfilled").length;
    expect(fulfilled).toBe(3);
    expect(provider.calls).toBe(3);
    expect(await usedUnits(o.workspaceId)).toBe(3);
    expect(await overageAudits(o.workspaceId)).toHaveLength(0);
  });
});

describe("PR68 settlePaidAccount directly (real test DB)", () => {
  async function account(label: string, reserved: number, charged: number, limit = 1): Promise<PaidAccount> {
    const o = await workspace(label);
    const periodStart = await reserveUsage(prisma, o.workspaceId, USAGE_METRICS.ai, limit, new Date(), "limit", reserved);
    return { workspaceId: o.workspaceId, periodStart, reserved, charged };
  }

  it("1) overage: used grows by the overage once and one audit row is written", async () => {
    const acc = await account("pr68-d1", 1, 3);
    await settlePaidAccount(prisma, acc);
    expect(await usedUnits(acc.workspaceId)).toBe(3);
    expect(await overageAudits(acc.workspaceId)).toHaveLength(1);
    expect(acc).toMatchObject({ reserved: 3, charged: 3 });
  });

  it("2) audit insert fails every time: used is rolled back and the account is untouched", async () => {
    const acc = await account("pr68-d2", 1, 3);
    const { db, state } = auditFailingDb(Number.POSITIVE_INFINITY);
    await expect(settlePaidAccount(db, acc)).rejects.toThrow(/audit insert failed/);
    expect(state.attempts).toBeGreaterThanOrEqual(1);
    expect(await usedUnits(acc.workspaceId)).toBe(1);
    expect(await overageAudits(acc.workspaceId)).toHaveLength(0);
    expect(acc).toMatchObject({ reserved: 1, charged: 3 });
  });

  it("3) caller retries after a failed settle: spend and audit end up exactly once", async () => {
    const acc = await account("pr68-d3", 1, 3);
    const { db } = auditFailingDb(Number.POSITIVE_INFINITY);
    await expect(settlePaidAccount(db, acc)).rejects.toThrow();
    await settlePaidAccount(prisma, acc);
    expect(await usedUnits(acc.workspaceId)).toBe(3);
    expect(await overageAudits(acc.workspaceId)).toHaveLength(1);
  });

  it("4) settle again after a successful overage settle: no extra spend, no extra audit", async () => {
    const acc = await account("pr68-d4", 1, 3);
    await settlePaidAccount(prisma, acc);
    await settlePaidAccount(prisma, acc);
    await settlePaidAccount(prisma, acc);
    expect(await usedUnits(acc.workspaceId)).toBe(3);
    expect(await overageAudits(acc.workspaceId)).toHaveLength(1);
  });

  it("6) charged < reserved: remainder released exactly once even if settle is called twice", async () => {
    const acc = await account("pr68-d6", 3, 1, 10);
    expect(await usedUnits(acc.workspaceId)).toBe(3);
    await settlePaidAccount(prisma, acc);
    await settlePaidAccount(prisma, acc);
    expect(await usedUnits(acc.workspaceId)).toBe(1);
    expect(await overageAudits(acc.workspaceId)).toHaveLength(0);
  });

  it("6b) charged == reserved: nothing released, nothing recorded", async () => {
    const acc = await account("pr68-d6b", 2, 2, 10);
    await settlePaidAccount(prisma, acc);
    expect(await usedUnits(acc.workspaceId)).toBe(2);
    expect(await overageAudits(acc.workspaceId)).toHaveLength(0);
  });

  it("7) concurrent overage settles on one workspace: every unit counted once", async () => {
    const o = await workspace("pr68-d7");
    const at = new Date();
    const accounts: PaidAccount[] = [];
    for (let i = 0; i < 5; i += 1) {
      const periodStart = await reserveUsage(prisma, o.workspaceId, USAGE_METRICS.ai, 5, at, "limit", 1);
      accounts.push({ workspaceId: o.workspaceId, periodStart, reserved: 1, charged: 3 });
    }
    await Promise.all(accounts.map((acc) => settlePaidAccount(prisma, acc)));
    expect(await usedUnits(o.workspaceId)).toBe(15);
    expect(await overageAudits(o.workspaceId)).toHaveLength(5);
  });
});
