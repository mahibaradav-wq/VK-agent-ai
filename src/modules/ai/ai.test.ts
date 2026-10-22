import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createAiService } from "@/modules/ai/ai-service";
import { createAuthService } from "@/modules/auth/auth-service";
import { createProjectService } from "@/modules/projects/project-service";
import { createWorkspaceService } from "@/modules/workspaces/workspace-service";
import { prisma } from "@/server/db/prisma";
import { createOpenAiCompatibleProvider } from "@/server/ai/openai-compatible";
import { createUnconfiguredAiProvider } from "@/server/ai/unconfigured";
import { createLocalStorage } from "@/server/storage/local-storage";
import { createUnconfiguredStorage } from "@/server/storage/s3-storage";
import type { AiGenerateOutput, AiImageOutput, AiProvider } from "@/server/ai/types";

const auth = createAuthService(prisma, "http://localhost:3000");
const projects = createProjectService(prisma);
const workspaces = createWorkspaceService(prisma);

function email(label: string) {
  return `${label}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;
}

async function expectAccess(promise: Promise<unknown>, status: 400 | 403 | 404, message: RegExp) {
  const error = await promise.then(
    () => {
      throw new Error("expected AccessError");
    },
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AccessError);
  expect(error).toMatchObject({ status, message: expect.stringMatching(message) });
}

async function registerOwner(label: string) {
  const address = email(label);
  const result = await auth.register(address, "password123");
  expect(result.ok).toBe(true);
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: address },
    include: { memberships: true },
  });
  const workspaceId = user.memberships[0]?.workspaceId ?? "";
  const project = await projects.create(user.id, workspaceId, { name: `Проект ${label}` });
  return { address, userId: user.id, workspaceId, projectId: project.id };
}

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const sampleImage: AiImageOutput = {
  bytes: png,
  mimeType: "image/png",
  provider: "scripted",
  model: "test-image",
};

function scriptedProvider(
  outputs: AiGenerateOutput[] | (() => Promise<AiGenerateOutput>),
  images: AiImageOutput[] | (() => Promise<AiImageOutput>) = [sampleImage],
): AiProvider & { prompts: string[]; imagePrompts: string[] } {
  const prompts: string[] = [];
  const imagePrompts: string[] = [];
  let index = 0;
  let imageIndex = 0;
  return {
    name: "scripted",
    model: "test-model",
    imageModel: "test-image",
    ready: true,
    imageReady: true,
    prompts,
    imagePrompts,
    async generate(input) {
      prompts.push(`${input.kind}:${input.tone}:${input.length}:${input.platform}:${input.prompt}`);
      if (typeof outputs === "function") {
        return outputs();
      }
      const next = outputs[Math.min(index, outputs.length - 1)];
      index += 1;
      if (!next) {
        throw new Error("no scripted output");
      }
      return next;
    },
    async generateImage(input) {
      imagePrompts.push(input.prompt);
      if (typeof images === "function") {
        return images();
      }
      const next = images[Math.min(imageIndex, images.length - 1)];
      imageIndex += 1;
      if (!next) {
        throw new Error("no scripted image");
      }
      return next;
    },
  };
}

const sample: AiGenerateOutput = {
  title: "Борщ по пятницам",
  body: "Приходите за тарелкой.",
  items: ["#борщ", "Заказать"],
  raw: "{\"title\":\"Борщ по пятницам\"}",
  provider: "scripted",
  model: "test-model",
};

describe("AI assistant", () => {
  let storageDir = "";

  beforeAll(async () => {
    await prisma.$connect();
    storageDir = await mkdtemp(path.join(os.tmpdir(), "polka-ai-media-"));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("does not fake a generation when the provider is not configured", async () => {
    const owner = await registerOwner("ai-none");
    const ai = createAiService(prisma, { provider: createUnconfiguredAiProvider() });
    expect(ai.status().ready).toBe(false);
    expect(JSON.stringify(ai.status())).not.toMatch(/sk-|AI_API_KEY/);
    await expectAccess(
      ai.generate(owner.userId, owner.workspaceId, { kind: "post", prompt: "борщ" }),
      400,
      /требуется настройка интеграции AI/,
    );
    expect(await prisma.aIRequest.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
    const usage = await ai.usage(owner.userId, owner.workspaceId);
    expect(usage.used).toBe(0);
  });

  it("stores history, adapts prompt, applies to a draft, and never exposes a key", async () => {
    const owner = await registerOwner("ai-ok");
    const provider = scriptedProvider([sample]);
    const ai = createAiService(prisma, { provider, monthlyLimit: 10 });
    const generated = await ai.generate(owner.userId, owner.workspaceId, {
      kind: "post",
      prompt: "меню борща",
      tone: "friendly",
      length: "short",
      platform: "telegram",
      projectId: owner.projectId,
    });
    expect(generated.title).toBe("Борщ по пятницам");
    expect(generated.provider).toBe("scripted");
    expect(JSON.stringify(generated)).not.toMatch(/sk-|apiKey|AI_API_KEY/);
    expect(provider.prompts[0]).toContain("friendly");
    expect(provider.prompts[0]).toContain("telegram");

    const listed = await ai.list(owner.userId, owner.workspaceId);
    expect(listed).toHaveLength(1);
    const post = await ai.applyToPost(owner.userId, owner.workspaceId, generated.id, owner.projectId);
    expect(post.status).toBe("draft");
    expect(post.versions.some((version) => version.title === "Борщ по пятницам")).toBe(true);
    expect(post.targets.map((target) => target.platform)).toEqual(["telegram"]);
  });

  it("enforces the monthly limit atomically and releases usage if the provider fails", async () => {
    const owner = await registerOwner("ai-limit");
    const ai = createAiService(prisma, { provider: scriptedProvider([sample]), monthlyLimit: 1 });
    await ai.generate(owner.userId, owner.workspaceId, { kind: "ideas", prompt: "суп" });
    await expectAccess(
      ai.generate(owner.userId, owner.workspaceId, { kind: "ideas", prompt: "ещё суп" }),
      400,
      /Лимит AI-генераций/,
    );
    expect(await prisma.aIRequest.count({ where: { workspaceId: owner.workspaceId } })).toBe(1);
    expect((await ai.usage(owner.userId, owner.workspaceId)).used).toBe(1);

    const failing = scriptedProvider(async () => {
      throw new AccessError(400, "Провайдер AI вернул ошибку 503.");
    });
    const other = await registerOwner("ai-release");
    const releasing = createAiService(prisma, { provider: failing, monthlyLimit: 5 });
    await expectAccess(
      releasing.generate(other.userId, other.workspaceId, { kind: "cta", prompt: "скидка" }),
      400,
      /ошибку 503/,
    );
    expect((await releasing.usage(other.userId, other.workspaceId)).used).toBe(0);
  });

  it("blocks a Viewer and a spoofed request from another workspace", async () => {
    const owner = await registerOwner("ai-acl");
    const other = await registerOwner("ai-other");
    const viewer = await registerOwner("ai-viewer");
    await workspaces.addMember(owner.userId, owner.workspaceId, viewer.address, "Viewer");
    const ai = createAiService(prisma, { provider: scriptedProvider([sample]) });
    const generated = await ai.generate(owner.userId, owner.workspaceId, { kind: "headline", prompt: "акция" });

    await expectAccess(
      ai.generate(viewer.userId, owner.workspaceId, { kind: "post", prompt: "нельзя" }),
      403,
      /Недостаточно прав/,
    );
    await expectAccess(
      ai.applyToPost(other.userId, other.workspaceId, generated.id, other.projectId),
      403,
      /другому рабочему пространству/,
    );
    await expectAccess(ai.list(other.userId, owner.workspaceId), 404, /не найдено/);
  });

  it("calls an OpenAI-compatible endpoint and does not put the key into the parsed result", async () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    const provider = createOpenAiCompatibleProvider({
      apiKey: "sk-test-secret-key",
      baseUrl: "https://example.test/v1",
      model: "demo-mini",
      fetchImpl: async (url, init) => {
        const headers = new Headers(init?.headers);
        calls.push({ url: String(url), authorization: headers.get("authorization") ?? undefined });
        return new Response(
          JSON.stringify({
            model: "demo-mini",
            usage: { prompt_tokens: 11, completion_tokens: 7 },
            choices: [{ message: { content: JSON.stringify({ title: "Заголовок", body: "Текст", items: ["CTA"] }) } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    const result = await provider.generate({
      kind: "cta",
      prompt: "доставка",
      tone: "expert",
      length: "short",
      platform: "vk",
    });
    expect(calls[0]?.authorization).toBe("Bearer sk-test-secret-key");
    expect(JSON.stringify(result)).not.toContain("sk-test-secret-key");
    expect(result.title).toBe("Заголовок");
    expect(result.items).toEqual(["CTA"]);
    expect(result.inputTokens).toBe(11);
  });

  it("does not compose an agent post when AI or storage is missing", async () => {
    const owner = await registerOwner("agent-none");
    const unset = createAiService(prisma, { provider: createUnconfiguredAiProvider() });
    expect(unset.status().imageReady).toBe(false);
    await expectAccess(
      unset.composeAgentPost(owner.userId, owner.workspaceId, {
        prompt: "борщ на обед",
        projectId: owner.projectId,
      }),
      400,
      /требуется настройка интеграции AI/,
    );
    expect(await prisma.post.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
    expect(await prisma.mediaAsset.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);

    const noStorage = createAiService(prisma, {
      provider: scriptedProvider([sample]),
      storage: createUnconfiguredStorage("S3"),
    });
    await expectAccess(
      noStorage.composeAgentPost(owner.userId, owner.workspaceId, {
        prompt: "борщ на обед",
        projectId: owner.projectId,
      }),
      400,
      /требуется настройка интеграции/,
    );
    expect((await noStorage.usage(owner.userId, owner.workspaceId)).used).toBe(0);
  });

  it("creates a draft with a real generated visual and spends two AI units", async () => {
    const owner = await registerOwner("agent-ok");
    const provider = scriptedProvider([sample]);
    const ai = createAiService(prisma, {
      provider,
      storage: createLocalStorage(storageDir),
      monthlyLimit: 10,
    });
    const composed = await ai.composeAgentPost(owner.userId, owner.workspaceId, {
      prompt: "меню борща для telegram",
      tone: "friendly",
      length: "short",
      platform: "telegram",
      projectId: owner.projectId,
    });
    expect(composed.request.kind).toBe("agent");
    expect(composed.request.title).toBe("Борщ по пятницам");
    expect(composed.mediaId).toBeTruthy();
    expect(composed.post.status).toBe("draft");
    expect(composed.post.media.map((item) => item.mediaId)).toEqual([composed.mediaId]);
    expect(composed.post.targets.map((target) => target.platform)).toEqual(["telegram"]);
    expect(provider.imagePrompts[0]).toContain("Борщ по пятницам");
    expect(JSON.stringify(composed.request)).not.toMatch(/sk-|apiKey|AI_API_KEY|b64/);
    expect((await ai.usage(owner.userId, owner.workspaceId)).used).toBe(2);
  });

  it("fails entirely if the image is missing and does not leave a text-only post", async () => {
    const owner = await registerOwner("agent-img-fail");
    const ai = createAiService(prisma, {
      provider: scriptedProvider([sample], async () => {
        throw new AccessError(400, "Провайдер изображений вернул ошибку 503. Ключ в ответ не попадает.");
      }),
      storage: createLocalStorage(storageDir),
      monthlyLimit: 10,
    });
    await expectAccess(
      ai.composeAgentPost(owner.userId, owner.workspaceId, {
        prompt: "борщ без картинки",
        projectId: owner.projectId,
      }),
      400,
      /изображений вернул ошибку 503/,
    );
    expect(await prisma.post.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
    expect(await prisma.mediaAsset.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
    expect(await prisma.aIRequest.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
    expect((await ai.usage(owner.userId, owner.workspaceId)).used).toBe(0);
  });

  it("needs two free AI units for the agent and blocks a Viewer", async () => {
    const owner = await registerOwner("agent-limit");
    const limited = createAiService(prisma, {
      provider: scriptedProvider([sample]),
      storage: createLocalStorage(storageDir),
      monthlyLimit: 1,
    });
    await expectAccess(
      limited.composeAgentPost(owner.userId, owner.workspaceId, {
        prompt: "нужны две генерации",
        projectId: owner.projectId,
      }),
      400,
      /две генерации/,
    );
    expect(await prisma.post.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);

    const viewer = await registerOwner("agent-viewer");
    await workspaces.addMember(owner.userId, owner.workspaceId, viewer.address, "Viewer");
    const ai = createAiService(prisma, {
      provider: scriptedProvider([sample]),
      storage: createLocalStorage(storageDir),
    });
    await expectAccess(
      ai.composeAgentPost(viewer.userId, owner.workspaceId, {
        prompt: "нельзя",
        projectId: owner.projectId,
      }),
      403,
      /Недостаточно прав/,
    );
  });

  it("decodes an OpenAI image payload without leaking the key or accepting junk bytes", async () => {
    const calls: string[] = [];
    const provider = createOpenAiCompatibleProvider({
      apiKey: "sk-test-secret-key",
      baseUrl: "https://example.test/v1",
      model: "demo-mini",
      imageModel: "demo-image",
      fetchImpl: async (url, init) => {
        calls.push(String(url));
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe("Bearer sk-test-secret-key");
        if (String(url).endsWith("/images/generations")) {
          return new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("{}", { status: 500 });
      },
    });
    const image = await provider.generateImage({ prompt: "тарелка борща" });
    expect(calls[0]).toContain("/images/generations");
    expect(image.mimeType).toBe("image/png");
    expect(Buffer.from(image.bytes).equals(png)).toBe(true);
    expect(image.model).toBe("demo-image");
    expect(JSON.stringify({ ...image, bytes: undefined })).not.toContain("sk-test-secret-key");

    const junk = createOpenAiCompatibleProvider({
      apiKey: "sk-test-secret-key",
      baseUrl: "https://example.test/v1",
      model: "demo-mini",
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("not-an-image").toString("base64") }] }), {
          status: 200,
        }),
    });
    await expectAccess(junk.generateImage({ prompt: "мусор" }), 400, /нельзя сохранить как изображение/);
  });
});
