import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createAiService } from "@/modules/ai/ai-service";
import { createAuthService } from "@/modules/auth/auth-service";
import { createProjectService } from "@/modules/projects/project-service";
import { createWorkspaceService } from "@/modules/workspaces/workspace-service";
import { prisma } from "@/server/db/prisma";
import { createOpenAiCompatibleProvider } from "@/server/ai/openai-compatible";
import { createUnconfiguredAiProvider } from "@/server/ai/unconfigured";
import type { AiGenerateOutput, AiProvider } from "@/server/ai/types";

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

function scriptedProvider(outputs: AiGenerateOutput[] | (() => Promise<AiGenerateOutput>)): AiProvider & { prompts: string[] } {
  const prompts: string[] = [];
  let index = 0;
  return {
    name: "scripted",
    model: "test-model",
    ready: true,
    prompts,
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
  beforeAll(async () => {
    await prisma.$connect();
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
});
