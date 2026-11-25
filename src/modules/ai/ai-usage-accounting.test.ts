import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createAiService } from "@/modules/ai/ai-service";
import { attachPaidCalls } from "@/modules/ai/usage-units";
import { agentUsageUnits, studioReviseReserveUnits } from "@/modules/ai/visual";
import { createAuthService } from "@/modules/auth/auth-service";
import { createProjectService } from "@/modules/projects/project-service";
import { createOpenAiCompatibleProvider } from "@/server/ai/openai-compatible";
import { OPENAI_REGION_MESSAGE } from "@/server/ai/errors";
import type { AiGenerateOutput, AiImageOutput, AiProvider } from "@/server/ai/types";
import { prisma } from "@/server/db/prisma";
import { createLocalStorage } from "@/server/storage/local-storage";

const auth = createAuthService(prisma, "http://localhost:3000");
const projects = createProjectService(prisma);

function email(label: string) {
  return `${label}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;
}

async function expectAccess(promise: Promise<unknown>, status: 400 | 403 | 404, message: RegExp) {
  const error = await promise.then(
    () => {
      throw new Error("expected AccessError");
    },
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(AccessError);
  expect((error as AccessError).status).toBe(status);
  expect((error as AccessError).message).toMatch(message);
}

async function registerOwner(label: string) {
  const address = email(label);
  const registered = await auth.register(address, "password123");
  expect(registered.ok).toBe(true);
  const mail = await prisma.devMailMessage.findFirstOrThrow({
    where: { to: address, kind: "verify_email" },
    orderBy: { createdAt: "desc" },
  });
  const token = mail.url!.split("token=")[1]!;
  await auth.verifyEmail(token);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: address } });
  const membership = await prisma.workspaceMember.findFirstOrThrow({ where: { userId: user.id } });
  const project = await projects.create(user.id, membership.workspaceId, { name: `Проект ${label}` });
  return { userId: user.id, workspaceId: membership.workspaceId, projectId: project.id, address };
}

const sample: AiGenerateOutput = {
  title: "Борщ",
  body: "Текст поста для учёта.",
  items: [],
  raw: "{}",
  provider: "scripted",
  model: "test-model",
  paidCalls: 1,
};

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const sampleImage: AiImageOutput = {
  bytes: png,
  mimeType: "image/png",
  provider: "scripted",
  model: "test-image",
  paidCalls: 1,
};

function countingProvider(options?: {
  textCalls?: number[];
  failAfterTexts?: number;
  failImageAfter?: number;
  imageFailPaid?: number;
}): AiProvider & { chatCalls: number; imageCalls: number } {
  let textIndex = 0;
  let imageIndex = 0;
  const provider = {
    name: "counting",
    model: "count-model",
    imageModel: "count-image",
    ready: true,
    imageReady: true,
    chatCalls: 0,
    imageCalls: 0,
    async generate(_input: { kind: string }) {
      provider.chatCalls += 1;
      const paid = options?.textCalls?.[textIndex] ?? 1;
      textIndex += 1;
      if (options?.failAfterTexts != null && textIndex > options.failAfterTexts) {
        throw attachPaidCalls(new AccessError(400, "Падение после успешного текста."), options.imageFailPaid ?? 1);
      }
      return { ...sample, title: `${sample.title}-${textIndex}`, paidCalls: paid };
    },
    async generateImage() {
      provider.imageCalls += 1;
      imageIndex += 1;
      if (options?.failImageAfter != null && imageIndex > options.failImageAfter) {
        throw attachPaidCalls(
          new AccessError(400, "Падение после успешного визуала."),
          options.imageFailPaid ?? 1,
        );
      }
      return { ...sampleImage };
    },
  };
  return provider;
}

describe("AI usage accounting", () => {
  let storageDir = "";

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "polka-ai-usage-"));
  });

  afterAll(async () => {
    // temp dir cleaned by OS
  });

  it("1) text generate reserves matching billed chat calls", async () => {
    const owner = await registerOwner("u1-text");
    const provider = countingProvider({ textCalls: [1] });
    const ai = createAiService(prisma, { provider, monthlyLimit: 10, storage: createLocalStorage(storageDir) });
    await ai.generate(owner.userId, owner.workspaceId, { kind: "ideas", prompt: "суп на обед" });
    expect(provider.chatCalls).toBe(1);
    expect((await ai.usage(owner.userId, owner.workspaceId)).used).toBe(1);
  });

  it("2) post + length revise bills both chat calls", async () => {
    const owner = await registerOwner("u2-revise");
    let calls = 0;
    const short = "коротко";
    const long = `${"На кухне каждый ящик должен работать на порядок и ритм. ".repeat(40)}Как вы организуете хранение?`;
    const provider = createOpenAiCompatibleProvider({
      apiKey: "sk-test-secret-key",
      baseUrl: "https://example.test/v1",
      model: "demo-mini",
      fetchImpl: async () => {
        calls += 1;
        const body = calls === 1 ? short : long;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ title: "Полки", body, items: [] }) } }],
          }),
          { status: 200 },
        );
      },
    });
    const ai = createAiService(prisma, { provider, monthlyLimit: 10, storage: createLocalStorage(storageDir) });
    await ai.generate(owner.userId, owner.workspaceId, {
      kind: "post",
      prompt: "полки без хаоса",
      length: "long",
      platform: "vk",
    });
    expect(calls).toBe(2);
    expect((await ai.usage(owner.userId, owner.workspaceId)).used).toBe(2);
  });

  it("3) Agent AI one platform: text + visual match mock call counts", async () => {
    const owner = await registerOwner("u3-agent1");
    const provider = countingProvider({ textCalls: [1] });
    const ai = createAiService(prisma, { provider, monthlyLimit: 10, storage: createLocalStorage(storageDir) });
    expect(agentUsageUnits("image", undefined, 1)).toBe(3);
    await ai.composeAgentPost(owner.userId, owner.workspaceId, {
      prompt: "меню борща",
      platform: "telegram",
      projectId: owner.projectId,
    });
    expect(provider.chatCalls).toBe(1);
    expect(provider.imageCalls).toBe(1);
    expect((await ai.usage(owner.userId, owner.workspaceId)).used).toBe(2);
  });

  it("4) Agent AI two platforms bills both texts + visual", async () => {
    const owner = await registerOwner("u4-agent2");
    const provider = countingProvider({ textCalls: [1, 1] });
    const ai = createAiService(prisma, { provider, monthlyLimit: 10, storage: createLocalStorage(storageDir) });
    await ai.composeAgentPost(owner.userId, owner.workspaceId, {
      prompt: "полки без хаоса",
      platforms: ["telegram", "vk"],
      projectId: owner.projectId,
    });
    expect(provider.chatCalls).toBe(2);
    expect(provider.imageCalls).toBe(1);
    expect((await ai.usage(owner.userId, owner.workspaceId)).used).toBe(3);
  });

  it("5) carousel bills one unit per card image", async () => {
    const owner = await registerOwner("u5-carousel");
    const provider = countingProvider({ textCalls: [1] });
    const ai = createAiService(prisma, { provider, monthlyLimit: 20, storage: createLocalStorage(storageDir) });
    await ai.composeAgentPost(owner.userId, owner.workspaceId, {
      prompt: "карусель полок",
      platform: "telegram",
      projectId: owner.projectId,
      visualKind: "carousel",
      carouselCount: 3,
    });
    expect(provider.imageCalls).toBe(3);
    expect((await ai.usage(owner.userId, owner.workspaceId)).used).toBe(4);
  });

  it("6) video bills one unit per frame image", async () => {
    const owner = await registerOwner("u6-video");
    const provider = countingProvider({ textCalls: [1] });
    const ai = createAiService(prisma, { provider, monthlyLimit: 20, storage: createLocalStorage(storageDir) });
    await ai.composeAgentPost(owner.userId, owner.workspaceId, {
      prompt: "ролик про полки",
      platform: "telegram",
      projectId: owner.projectId,
      visualKind: "video",
      videoSeconds: 4,
    });
    expect(provider.imageCalls).toBe(2);
    expect((await ai.usage(owner.userId, owner.workspaceId)).used).toBe(3);
  });

  it("7) revise text only bills text calls", async () => {
    const owner = await registerOwner("u7-rev-text");
    const provider = countingProvider({ textCalls: [1, 1] });
    const ai = createAiService(prisma, { provider, monthlyLimit: 20, storage: createLocalStorage(storageDir) });
    const composed = await ai.composeAgentPost(owner.userId, owner.workspaceId, {
      prompt: "исходный пост",
      platforms: ["telegram", "vk"],
      projectId: owner.projectId,
    });
    const before = (await ai.usage(owner.userId, owner.workspaceId)).used;
    expect(studioReviseReserveUnits({ rewriteText: true, rewriteVisual: false, platformCount: 2, slideCount: 1 })).toBe(4);
    provider.chatCalls = 0;
    provider.imageCalls = 0;
    await ai.reviseStudioCard(owner.userId, owner.workspaceId, {
      postId: composed.post.id,
      comment: "сделай теплее тон",
      rewrite: "text",
    });
    expect(provider.chatCalls).toBe(2);
    expect(provider.imageCalls).toBe(0);
    expect((await ai.usage(owner.userId, owner.workspaceId)).used).toBe(before + 2);
  });

  it("8) revise visual only bills image calls", async () => {
    const owner = await registerOwner("u8-rev-vis");
    const provider = countingProvider({ textCalls: [1] });
    const ai = createAiService(prisma, { provider, monthlyLimit: 20, storage: createLocalStorage(storageDir) });
    const composed = await ai.composeAgentPost(owner.userId, owner.workspaceId, {
      prompt: "исходный пост",
      platform: "telegram",
      projectId: owner.projectId,
    });
    const before = (await ai.usage(owner.userId, owner.workspaceId)).used;
    provider.chatCalls = 0;
    provider.imageCalls = 0;
    await ai.reviseStudioCard(owner.userId, owner.workspaceId, {
      postId: composed.post.id,
      comment: "другой ракурс полки",
      rewrite: "visual",
    });
    expect(provider.chatCalls).toBe(0);
    expect(provider.imageCalls).toBe(1);
    expect((await ai.usage(owner.userId, owner.workspaceId)).used).toBe(before + 1);
  });

  it("9) revise both bills text and visual", async () => {
    const owner = await registerOwner("u9-rev-both");
    const provider = countingProvider({ textCalls: [1, 1] });
    const ai = createAiService(prisma, { provider, monthlyLimit: 20, storage: createLocalStorage(storageDir) });
    const composed = await ai.composeAgentPost(owner.userId, owner.workspaceId, {
      prompt: "исходный пост",
      platforms: ["telegram", "vk"],
      projectId: owner.projectId,
    });
    const before = (await ai.usage(owner.userId, owner.workspaceId)).used;
    provider.chatCalls = 0;
    provider.imageCalls = 0;
    await ai.reviseStudioCard(owner.userId, owner.workspaceId, {
      postId: composed.post.id,
      comment: "и текст и картинку",
      rewrite: "both",
    });
    expect(provider.chatCalls).toBe(2);
    expect(provider.imageCalls).toBe(1);
    expect((await ai.usage(owner.userId, owner.workspaceId)).used).toBe(before + 3);
  });

  it("10) first API fail releases the whole reserve", async () => {
    const owner = await registerOwner("u10-fail0");
    const provider: AiProvider = {
      name: "fail-first",
      model: "x",
      imageModel: "x",
      ready: true,
      imageReady: true,
      async generate() {
        throw new AccessError(400, "Провайдер AI вернул ошибку 503.");
      },
      async generateImage() {
        throw new AccessError(400, "no image");
      },
    };
    const ai = createAiService(prisma, { provider, monthlyLimit: 10, storage: createLocalStorage(storageDir) });
    await expectAccess(
      ai.generate(owner.userId, owner.workspaceId, { kind: "headline", prompt: "скидка" }),
      400,
      /ошибку 503/,
    );
    expect((await ai.usage(owner.userId, owner.workspaceId)).used).toBe(0);
  });

  it("11) fail after first success keeps the first charge", async () => {
    const owner = await registerOwner("u11-partial");
    const provider = countingProvider({ textCalls: [1], failAfterTexts: 1, imageFailPaid: 0 });
    // failAfterTexts:1 means second generate throws — agent two platforms
    const ai = createAiService(prisma, { provider, monthlyLimit: 20, storage: createLocalStorage(storageDir) });
    await expectAccess(
      ai.composeAgentPost(owner.userId, owner.workspaceId, {
        prompt: "два текста",
        platforms: ["telegram", "vk"],
        projectId: owner.projectId,
      }),
      400,
      /Падение после успешного текста/,
    );
    expect(provider.chatCalls).toBe(2);
    expect((await ai.usage(owner.userId, owner.workspaceId)).used).toBe(1);
  });

  it("12) DB save fail after paid success still keeps the charge", async () => {
    const owner = await registerOwner("u12-dbfail");
    const provider = countingProvider({ textCalls: [1] });
    const ai = createAiService(prisma, { provider, monthlyLimit: 10, storage: createLocalStorage(storageDir) });
    const spy = vi.spyOn(prisma.aIRequest, "create").mockRejectedValueOnce(new Error("db down"));
    await expect(
      ai.generate(owner.userId, owner.workspaceId, { kind: "ideas", prompt: "суп" }),
    ).rejects.toThrow(/db down/);
    spy.mockRestore();
    expect(provider.chatCalls).toBe(1);
    expect((await ai.usage(owner.userId, owner.workspaceId)).used).toBe(1);
  });

  it("13) replay via applyToPost does not double-charge", async () => {
    const owner = await registerOwner("u13-replay");
    const provider = countingProvider({ textCalls: [1] });
    const ai = createAiService(prisma, { provider, monthlyLimit: 10, storage: createLocalStorage(storageDir) });
    const composed = await ai.composeAgentPost(owner.userId, owner.workspaceId, {
      prompt: "черновик агента",
      platform: "telegram",
      projectId: owner.projectId,
    });
    const used = (await ai.usage(owner.userId, owner.workspaceId)).used;
    await ai.applyToPost(owner.userId, owner.workspaceId, composed.request.id, owner.projectId);
    await ai.applyToPost(owner.userId, owner.workspaceId, composed.request.id, owner.projectId);
    expect((await ai.usage(owner.userId, owner.workspaceId)).used).toBe(used);
  });

  it("14) two parallel near-limit generates cannot exceed the workspace limit", async () => {
    const owner = await registerOwner("u14-parallel");
    const provider = countingProvider({ textCalls: [1, 1] });
    // Limit 2: each post reserves 2, so at most one can begin even if the other settles early.
    const ai = createAiService(prisma, { provider, monthlyLimit: 2, storage: createLocalStorage(storageDir) });
    const results = await Promise.allSettled([
      ai.generate(owner.userId, owner.workspaceId, {
        kind: "post",
        prompt: "параллель один длинный",
        length: "medium",
        platform: "vk",
      }),
      ai.generate(owner.userId, owner.workspaceId, {
        kind: "post",
        prompt: "параллель два длинный",
        length: "medium",
        platform: "vk",
      }),
    ]);
    const fulfilled = results.filter((item) => item.status === "fulfilled");
    const rejected = results.filter((item) => item.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((await ai.usage(owner.userId, owner.workspaceId)).used).toBeLessThanOrEqual(2);
  });

  it("15) insufficient limit makes no provider API calls", async () => {
    const owner = await registerOwner("u15-nolimit");
    const provider = countingProvider();
    const ai = createAiService(prisma, { provider, monthlyLimit: 1, storage: createLocalStorage(storageDir) });
    await expectAccess(
      ai.composeAgentPost(owner.userId, owner.workspaceId, {
        prompt: "нужен запас",
        projectId: owner.projectId,
      }),
      400,
      /Агенту нужны до|Общий лимит AI/,
    );
    expect(provider.chatCalls).toBe(0);
    expect(provider.imageCalls).toBe(0);
    expect((await ai.usage(owner.userId, owner.workspaceId)).used).toBe(0);
  });

  it("16) provider fallback counts real paid calls from the failed attempt", async () => {
    const owner = await registerOwner("u16-fallback");
    let openaiCalls = 0;
    let backupCalls = 0;
    const openai: AiProvider = {
      name: "openai",
      model: "gpt",
      imageModel: "none",
      ready: true,
      imageReady: false,
      async generate() {
        openaiCalls += 1;
        throw attachPaidCalls(new AccessError(400, OPENAI_REGION_MESSAGE), 1);
      },
      async generateImage() {
        throw new AccessError(400, "no");
      },
    };
    const backup: AiProvider = {
      name: "backup",
      model: "backup-model",
      imageModel: "none",
      ready: true,
      imageReady: false,
      async generate() {
        backupCalls += 1;
        return { ...sample, provider: "backup", paidCalls: 1 };
      },
      async generateImage() {
        throw new AccessError(400, "no");
      },
    };
    const connections = {
      resolveProvider: async () => openai,
      listProviders: async () => [openai, backup],
      rememberError: async () => undefined,
      openaiRegionBlocked: async () => false,
    };
    const ai = createAiService(prisma, {
      connections: connections as never,
      monthlyLimit: 10,
      storage: createLocalStorage(storageDir),
    });
    await ai.generate(owner.userId, owner.workspaceId, { kind: "ideas", prompt: "полка" });
    expect(openaiCalls).toBe(1);
    expect(backupCalls).toBe(1);
    // Failed openai attempt (1) + backup success (1); reserve grows to cover both.
    expect((await ai.usage(owner.userId, owner.workspaceId)).used).toBe(2);
  });
});
