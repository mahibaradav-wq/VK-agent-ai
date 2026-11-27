import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createAiService } from "@/modules/ai/ai-service";
import {
  AiAccountingPendingError,
  PaidSettlementError,
  recoverPendingOverageSettlements,
} from "@/modules/ai/paid-settlement";
import { createAuthService } from "@/modules/auth/auth-service";
import { USAGE_METRICS } from "@/modules/billing/usage";
import { createProjectService } from "@/modules/projects/project-service";
import { prisma } from "@/server/db/prisma";
import { createLocalStorage } from "@/server/storage/local-storage";

const auth = createAuthService(prisma, "http://127.0.0.1:3000");
const projects = createProjectService(prisma);

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function createOwner(label: string) {
  const address = `pr73.b3.${label}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;
  await auth.register(address, "password123");
  const mail = await prisma.devMailMessage.findFirstOrThrow({
    where: { to: address, kind: "verify_email" },
    orderBy: { createdAt: "desc" },
  });
  const token = new URL(mail.url!, "http://127.0.0.1:3000").searchParams.get("token")!;
  await auth.verifyEmail(token);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: address } });
  const membership = await prisma.workspaceMember.findFirstOrThrow({ where: { userId: user.id } });
  const project = await projects.create(user.id, membership.workspaceId, { name: `B3-${label}` });
  return { userId: user.id, workspaceId: membership.workspaceId, projectId: project.id };
}

function overageFailingDb(): PrismaClient {
  const wrapAudit = (auditLog: PrismaClient["auditLog"]) =>
    new Proxy(auditLog, {
      get(target, prop) {
        if (prop === "create") {
          return async (args: { data: { action?: string } }) => {
            if (args.data.action === "AI_USAGE_OVERAGE") {
              throw new Error("DB down during overage commit (injected)");
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

describe("PR73 Block B3: Full AI lifecycle through local HTTP spy & fail-closed spool (no real AI)", () => {
  let server: Server;
  let baseUrl = "";
  let chatCalls = 0;
  let imageCalls = 0;
  let spyMode:
    | "ok"
    | "post_short_then_long"
    | "bad_json_200"
    | "socket_drop_after_post"
    | "image_bad_url" = "ok";

  const tempDirs: string[] = [];
  const savedEnv: Record<string, string | undefined> = {};

  function setAiEnv(vars: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(vars)) {
      if (!(k in savedEnv)) {
        savedEnv[k] = process.env[k];
      }
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }

  async function makeTempDir(prefix: string) {
    const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  beforeAll(async () => {
    await prisma.$connect();
    server = createServer(async (req, res) => {
      // Drain request body
      for await (const _chunk of req) {
        // consume
      }
      if (req.url === "/v1/chat/completions") {
        chatCalls += 1;
        if (spyMode === "socket_drop_after_post") {
          res.socket?.destroy();
          return;
        }
        if (spyMode === "bad_json_200") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end("{not-valid-json");
          return;
        }
        if (spyMode === "post_short_then_long") {
          const bodyText =
            chatCalls === 1
              ? "короткий"
              : `${"Организация кухни и полок помогает сохранять порядок каждый день. ".repeat(8)}Как храните вы?`;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              model: "spy-gpt",
              usage: { prompt_tokens: 10, completion_tokens: 20 },
              choices: [{ message: { content: JSON.stringify({ title: "Полки", body: bodyText, items: [] }) } }],
            }),
          );
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            model: "spy-gpt",
            usage: { prompt_tokens: 12, completion_tokens: 18 },
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: "Идеи полок",
                    body: "Текст для поста с порядком.",
                    items: ["Идея 1", "Идея 2"],
                  }),
                },
              },
            ],
          }),
        );
        return;
      }

      if (req.url === "/v1/images/generations") {
        imageCalls += 1;
        if (spyMode === "image_bad_url") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ data: [{ url: "http://127.0.0.1:1/insecure.png" }] }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }] }));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  afterEach(() => {
    chatCalls = 0;
    imageCalls = 0;
    spyMode = "ok";
    // Reset cached global AI provider so env changes apply cleanly
    delete (globalThis as typeof globalThis & { aiProvider?: unknown }).aiProvider;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
      delete savedEnv[k];
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
    await prisma.$disconnect();
  });

  it("runs the full real-gate cycle via local HTTP spy without bypassing AI_LIVE_ENABLED or limit", async () => {
    const owner = await createOwner("full-cycle");
    const spoolDir = await makeTempDir("polka-b3-full-");
    const storageDir = await makeTempDir("polka-b3-media-");

    // 1) Disabled AI_LIVE_ENABLED blocks before HTTP and writes AI_PAID_DENIED
    setAiEnv({
      AI_API_KEY: "sk-local-spy-key",
      AI_BASE_URL: baseUrl,
      AI_LIVE_ENABLED: "false",
      AI_MONTHLY_HARD_LIMIT: "5",
      AI_SETTLEMENT_SPOOL_DIR: spoolDir,
    });
    const ai = createAiService(prisma, { storage: createLocalStorage(storageDir) });
    await expect(
      ai.generate(owner.userId, owner.workspaceId, { kind: "ideas", prompt: "полки в шкаф" }),
    ).rejects.toMatchObject({ status: 403, message: /AI_LIVE_ENABLED/ });
    expect(chatCalls).toBe(0);
    expect(
      await prisma.auditLog.count({ where: { action: "AI_PAID_DENIED", entityId: owner.workspaceId } }),
    ).toBe(1);

    // 2) Enable AI_LIVE_ENABLED="true" and run full cycle: reserve -> spy POST -> DB -> settle -> audit
    setAiEnv({ AI_LIVE_ENABLED: "true", AI_MONTHLY_HARD_LIMIT: "5" });
    const generated = await ai.generate(owner.userId, owner.workspaceId, {
      kind: "ideas",
      prompt: "полки в прихожей",
      projectId: owner.projectId,
    });
    expect(generated.title).toBe("Идеи полок");
    expect(chatCalls).toBe(1);
    expect((await ai.usage(owner.userId, owner.workspaceId)).used).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { action: "GENERATE_AI_REQUEST", entityId: generated.id } }),
    ).toBe(1);

    // 3) Agent post (1 text + 1 length-revise = 2 chat calls + 1 image = 3 actual calls)
    const composed = await ai.composeAgentPost(owner.userId, owner.workspaceId, {
      prompt: "органайзер на кухню",
      platform: "telegram",
      projectId: owner.projectId,
    });
    expect(composed.mediaId).toBeTruthy();
    expect(chatCalls).toBe(3);
    expect(imageCalls).toBe(1);
    expect((await ai.usage(owner.userId, owner.workspaceId)).used).toBe(4);

    // 4) Insufficient reserve (used=4, limit=5 -> remaining=1, but composeAgentPost needs 3) -> 0 HTTP calls
    await expect(
      ai.composeAgentPost(owner.userId, owner.workspaceId, {
        prompt: "второй агент",
        platform: "telegram",
        projectId: owner.projectId,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(chatCalls).toBe(3);
    expect(imageCalls).toBe(1);
    expect((await ai.usage(owner.userId, owner.workspaceId)).used).toBe(4);
  });

  it("handles pre-send ECONNREFUSED (0 billed), socket drop after POST (1 billed), HTTP 2xx bad JSON (1 billed), and image URL failure (1 billed)", async () => {
    const owner = await createOwner("http-errors");
    const spoolDir = await makeTempDir("polka-b3-err-");
    const storageDir = await makeTempDir("polka-b3-err-media-");

    // Pre-send error on closed local ephemeral port (ECONNREFUSED) -> 0 units billed
    const closedServer = createServer();
    await new Promise<void>((resolve) => closedServer.listen(0, "127.0.0.1", resolve));
    const closedPort = (closedServer.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closedServer.close(() => resolve()));

    setAiEnv({
      AI_API_KEY: "sk-local-spy-key",
      AI_BASE_URL: `http://127.0.0.1:${closedPort}/v1`,
      AI_LIVE_ENABLED: "true",
      AI_MONTHLY_HARD_LIMIT: "10",
      AI_SETTLEMENT_SPOOL_DIR: spoolDir,
    });
    const deadAi = createAiService(prisma, { storage: createLocalStorage(storageDir) });
    await expect(
      deadAi.generate(owner.userId, owner.workspaceId, { kind: "ideas", prompt: "порт закрыт" }),
    ).rejects.toBeInstanceOf(AccessError);
    expect((await deadAi.usage(owner.userId, owner.workspaceId)).used).toBe(0);

    // Switch to live spy server
    delete (globalThis as typeof globalThis & { aiProvider?: unknown }).aiProvider;
    setAiEnv({ AI_BASE_URL: baseUrl });
    const spyAi = createAiService(prisma, { storage: createLocalStorage(storageDir) });

    // Socket dropped after POST -> conservative 1 unit billed
    spyMode = "socket_drop_after_post";
    await expect(
      spyAi.generate(owner.userId, owner.workspaceId, { kind: "ideas", prompt: "обрыв" }),
    ).rejects.toBeInstanceOf(AccessError);
    expect((await spyAi.usage(owner.userId, owner.workspaceId)).used).toBe(1);

    // HTTP 200 invalid JSON -> 1 unit billed
    spyMode = "bad_json_200";
    await expect(
      spyAi.generate(owner.userId, owner.workspaceId, { kind: "ideas", prompt: "битый json" }),
    ).rejects.toBeInstanceOf(AccessError);
    expect((await spyAi.usage(owner.userId, owner.workspaceId)).used).toBe(2);

    // Image download fails (non-HTTPS URL) -> text (2: draft+revise) + image (1) = 3 more units -> total 5
    spyMode = "image_bad_url";
    await expect(
      spyAi.composeAgentPost(owner.userId, owner.workspaceId, {
        prompt: "картинка не скачалась",
        platform: "telegram",
        projectId: owner.projectId,
      }),
    ).rejects.toBeInstanceOf(AccessError);
    expect((await spyAi.usage(owner.userId, owner.workspaceId)).used).toBe(5);
  });

  it("blocks new paid AI calls when spool recovery fails or spool is corrupted/symlinked, then unblocks after recovery", async () => {
    const owner = await createOwner("spool-failclosed");
    const spoolDir = await makeTempDir("polka-b3-spool-");
    const storageDir = await makeTempDir("polka-b3-spool-media-");

    setAiEnv({
      AI_API_KEY: "sk-local-spy-key",
      AI_BASE_URL: baseUrl,
      AI_LIVE_ENABLED: "true",
      AI_MONTHLY_HARD_LIMIT: "2",
      AI_SETTLEMENT_SPOOL_DIR: spoolDir,
    });

    // Simulate post revise hitting 2 calls when limit=2: first let used=1, then 2-call post at limit=2 -> overage=1!
    const healthyAi = createAiService(prisma, { storage: createLocalStorage(storageDir) });
    await healthyAi.generate(owner.userId, owner.workspaceId, { kind: "ideas", prompt: "первый" });
    expect((await healthyAi.usage(owner.userId, owner.workspaceId)).used).toBe(1);

    // Now remaining=1, post reserves 1? No, post needs 2 -> let's raise limit to 3 temporarily? Or use DB failure on 2-call post with limit=2:
    // Reserve 1 (ideas) -> wait, we want overage=1 when limit=2 and used=1: post reserves 2? If limit=2 and used=1, beginPaidAi(2) refuses.
    // Instead: set limit=2 on fresh workspace: generate(post) reserves 2, or use composeAgentPost? Better: limit=2 on fresh owner2!
    const owner2 = await createOwner("spool-failclosed-2");
    spyMode = "post_short_then_long";
    // On fresh owner2 with limit=2: generate(post) reserves 2, spy returns short->long = 2 calls (no overage).
    // To force real overage via HTTP spy: limit=1? No, post needs 2.
    // Wait: if limit=3, used=0, post reserves 2, or composeAgentPost? In composeAgentPost with 1 platform, reserve=3, actual=2.
    // What about generate(post) when chatCalls is 2 and reserve is 2? Overage happens in fallback or when charged > reserved.
    // Let's use setAiEnv AI_MONTHLY_HARD_LIMIT="2" and test overage with two parallel calls or direct DB failure on overage:
    const { settlePaidAccount } = await import("@/modules/ai/paid-settlement");
    const periodStart = (await healthyAi.usage(owner2.userId, owner2.workspaceId)).periodStart;
    await prisma.usageRecord.upsert({
      where: { workspaceId_metric_periodStart: { workspaceId: owner2.workspaceId, metric: USAGE_METRICS.ai, periodStart } },
      create: { workspaceId: owner2.workspaceId, metric: USAGE_METRICS.ai, periodStart, periodEnd: periodStart, used: 1, limit: 2 },
      update: { used: 1, limit: 2 },
    });

    await expect(
      settlePaidAccount(overageFailingDb(), { workspaceId: owner2.workspaceId, periodStart, reserved: 1, charged: 3 }, { spoolDir }),
    ).rejects.toBeInstanceOf(PaidSettlementError);

    expect((await readdir(spoolDir)).length).toBe(1);

    // Put a corrupted file in spoolDir too -> blocks all workspaces (fail-closed)
    const corruptFile = path.join(spoolDir, "000-corrupt-test.json");
    await writeFile(corruptFile, "{bad-json", { mode: 0o600 });

    setAiEnv({ AI_MONTHLY_HARD_LIMIT: "10" });
    chatCalls = 0;
    await expect(
      healthyAi.generate(owner2.userId, owner2.workspaceId, { kind: "ideas", prompt: "пока сломан spool" }),
    ).rejects.toBeInstanceOf(AiAccountingPendingError);
    expect(chatCalls).toBe(0);

    // Remove corrupt file, keep valid pending entry, test symlinked spoolDir also fails closed
    await rm(corruptFile);
    const linkDir = path.join(await makeTempDir("polka-b3-link-"), "spool-symlink");
    await symlink(spoolDir, linkDir);
    const symlinkAi = createAiService(prisma, { storage: createLocalStorage(storageDir), spoolDir: linkDir });
    await expect(
      symlinkAi.generate(owner2.userId, owner2.workspaceId, { kind: "ideas", prompt: "симлинк" }),
    ).rejects.toBeInstanceOf(AiAccountingPendingError);
    expect(chatCalls).toBe(0);

    // Recover valid spool entry on healthy DB, verify used=3 and limit=2 now blocks without HTTP
    const summary = await recoverPendingOverageSettlements(prisma, { spoolDir });
    expect(summary.failed).toBe(0);
    expect((await healthyAi.usage(owner2.userId, owner2.workspaceId)).used).toBe(3);

    setAiEnv({ AI_MONTHLY_HARD_LIMIT: "2" });
    await expect(
      healthyAi.generate(owner2.userId, owner2.workspaceId, { kind: "ideas", prompt: "после восстановления" }),
    ).rejects.toThrow(/лимит/i);
    expect(chatCalls).toBe(0);

    // Parallel requests near limit (owner3: limit=3, used=1 -> 3 concurrent requests -> only 2 succeed)
    const owner3 = await createOwner("parallel-limit");
    setAiEnv({ AI_MONTHLY_HARD_LIMIT: "3" });
    await healthyAi.generate(owner3.userId, owner3.workspaceId, { kind: "ideas", prompt: "первый из 3" });
    chatCalls = 0;
    const raceResults = await Promise.allSettled([
      healthyAi.generate(owner3.userId, owner3.workspaceId, { kind: "ideas", prompt: "гонка 1" }),
      healthyAi.generate(owner3.userId, owner3.workspaceId, { kind: "ideas", prompt: "гонка 2" }),
      healthyAi.generate(owner3.userId, owner3.workspaceId, { kind: "ideas", prompt: "гонка 3" }),
    ]);
    expect(raceResults.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(raceResults.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((await healthyAi.usage(owner3.userId, owner3.workspaceId)).used).toBe(3);
  });
});
