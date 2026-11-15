import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createAiService } from "@/modules/ai/ai-service";
import { createAiConnectionService } from "@/modules/ai/provider-service";
import { createAuthService } from "@/modules/auth/auth-service";
import { createProjectService } from "@/modules/projects/project-service";
import { createWorkspaceService } from "@/modules/workspaces/workspace-service";
import { prisma } from "@/server/db/prisma";
import { createUnconfiguredAiProvider } from "@/server/ai/unconfigured";
import { createLocalStorage } from "@/server/storage/local-storage";

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

describe("AI provider connection", () => {
  beforeAll(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "stage-ai-provider-tests";
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("connects ChatGPT after a live models probe and never returns the key", async () => {
    const owner = await registerOwner("ai-openai");
    const calls: string[] = [];
    const connections = createAiConnectionService(prisma, {
      envProvider: createUnconfiguredAiProvider(),
      fetchImpl: async (url, init) => {
        calls.push(String(url));
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe("Bearer sk-test-secret-key");
        return new Response(JSON.stringify({ data: [{ id: "gpt-4o-mini" }] }), { status: 200 });
      },
    });
    const connected = await connections.connect(owner.userId, owner.workspaceId, {
      provider: "openai",
      apiKey: "sk-test-secret-key",
    });
    expect(connected.source).toBe("workspace");
    expect(connected.provider).toBe("openai");
    expect(connected.imageReady).toBe(true);
    expect(JSON.stringify(connected)).not.toMatch(/sk-test-secret-key/);
    expect(calls[0]).toContain("/models");

    const stored = await prisma.workspaceAiConnection.findUniqueOrThrow({
      where: { workspaceId_provider: { workspaceId: owner.workspaceId, provider: "openai" } },
    });
    expect(stored.encryptedApiKey).not.toContain("sk-test-secret-key");

    const ai = createAiService(prisma, { connections });
    const status = await ai.workspaceStatus(owner.userId, owner.workspaceId);
    expect(status.ready).toBe(true);
    expect(status.imageReady).toBe(true);
    expect(JSON.stringify(status)).not.toMatch(/sk-test-secret-key/);
  });

  it("rejects a chat password, a bad key, unknown providers, and a Viewer", async () => {
    const owner = await registerOwner("ai-rules");
    const viewer = await registerOwner("ai-rules-viewer");
    await workspaces.addMember(owner.userId, owner.workspaceId, viewer.address, "Viewer");
    const connections = createAiConnectionService(prisma, {
      envProvider: createUnconfiguredAiProvider(),
      fetchImpl: async () => new Response("{}", { status: 401 }),
    });

    await expectAccess(
      connections.connect(owner.userId, owner.workspaceId, {
        provider: "openai",
        apiKey: "мойпарольchatgpt",
      }),
      400,
      /не пароль/,
    );
    await expectAccess(
      connections.connect(owner.userId, owner.workspaceId, {
        provider: "openai",
        apiKey: "sk-invalid-key-value",
      }),
      400,
      /отклонил ключ/,
    );

    const geoBlocked = createAiConnectionService(prisma, {
      envProvider: createUnconfiguredAiProvider(),
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: { code: "unsupported_country_region_territory", message: "Country not supported" },
          }),
          { status: 403 },
        ),
    });
    await expectAccess(
      geoBlocked.connect(owner.userId, owner.workspaceId, {
        provider: "openai",
        apiKey: "sk-valid-looking-key",
      }),
      400,
      /регион этого сервера/,
    );
    await expectAccess(
      connections.connect(viewer.userId, owner.workspaceId, {
        provider: "openai",
        apiKey: "sk-test-secret-key",
      }),
      403,
      /Недостаточно прав/,
    );

    await expectAccess(
      connections.connect(owner.userId, owner.workspaceId, {
        provider: "deepseek",
        apiKey: "sk-test-secret-key",
      }),
      400,
      /Неизвестный AI-провайдер/,
    );
    await expectAccess(
      connections.connect(owner.userId, owner.workspaceId, {
        provider: "qwen",
        apiKey: "sk-test-secret-key",
      }),
      400,
      /Неизвестный AI-провайдер/,
    );

    const ai = createAiService(prisma, { connections });
    await expectAccess(
      ai.composeAgentPost(owner.userId, owner.workspaceId, {
        prompt: "борщ на обед",
        projectId: owner.projectId,
      }),
      400,
      /подключите ChatGPT/,
    );
    expect(await prisma.post.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
  });

  it("uses ChatGPT for ideas, copy and visuals", async () => {
    const owner = await registerOwner("ai-chatgpt");
    const connections = createAiConnectionService(prisma, {
      envProvider: createUnconfiguredAiProvider(),
      fetchImpl: async (url, init) => {
        if (String(init?.method ?? "GET").toUpperCase() === "GET") {
          return new Response(JSON.stringify({ data: [{ id: "gpt-4o-mini" }] }), { status: 200 });
        }
        if (String(url).includes("/images/generations")) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  b64_json:
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            model: "gpt-4o-mini",
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: "Пост ChatGPT",
                    body: "Текст",
                    items: ["один"],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        );
      },
    });

    await connections.connect(owner.userId, owner.workspaceId, {
      provider: "openai",
      apiKey: "sk-openai-secret-key",
    });
    expect(await prisma.workspaceAiConnection.count({ where: { workspaceId: owner.workspaceId } })).toBe(1);

    const ai = createAiService(prisma, { connections });
    const status = await ai.workspaceStatus(owner.userId, owner.workspaceId);
    expect(status.ideasProvider).toBe("openai");
    expect(status.copyProvider).toBe("openai");
    expect(status.imageProvider).toBe("openai");

    const ideas = await ai.generate(owner.userId, owner.workspaceId, {
      kind: "ideas",
      prompt: "темы для полки",
    });
    expect(ideas.provider).toBe("openai");
    expect(ideas.title).toBe("Пост ChatGPT");

    const post = await ai.generate(owner.userId, owner.workspaceId, {
      kind: "post",
      prompt: "текст для полки",
    });
    expect(post.provider).toBe("openai");
    expect(post.title).toBe("Пост ChatGPT");
    expect(JSON.stringify({ ideas, post, status })).not.toMatch(/sk-openai-secret-key/);
  });

  it("does not invent a post when OpenAI blocks this region", async () => {
    const owner = await registerOwner("ai-geo-no-image");
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "polka-geo-noimg-"));
    const connections = createAiConnectionService(prisma, {
      envProvider: createUnconfiguredAiProvider(),
      fetchImpl: async (url, init) => {
        const href = String(url);
        const method = String(init?.method ?? "GET").toUpperCase();
        if (method === "GET") {
          return new Response(JSON.stringify({ data: [{ id: "gpt-4o-mini" }] }), { status: 200 });
        }
        if (href.includes("api.openai.com")) {
          return new Response(
            JSON.stringify({ error: { code: "unsupported_country_region_territory" } }),
            { status: 403 },
          );
        }
        return new Response("{}", { status: 500 });
      },
    });
    await connections.connect(owner.userId, owner.workspaceId, {
      provider: "openai",
      apiKey: "sk-openai-secret-key",
    });
    const ai = createAiService(prisma, {
      connections,
      storage: createLocalStorage(storageDir),
    });
    await expectAccess(
      ai.composeAgentPost(owner.userId, owner.workspaceId, {
        prompt: "полка для специй",
        projectId: owner.projectId,
      }),
      400,
      /регион этого сервера|картинки не рисует/,
    );
    expect(await prisma.post.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
  });
});
