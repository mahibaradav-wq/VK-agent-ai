import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createAiService } from "@/modules/ai/ai-service";
import { createAuthService } from "@/modules/auth/auth-service";
import { createProjectService } from "@/modules/projects/project-service";
import { createWorkspaceService } from "@/modules/workspaces/workspace-service";
import { WATCH_IDEAS_KIND, createWatchService } from "@/modules/watch/watch-service";
import { prisma } from "@/server/db/prisma";
import type { AiGenerateOutput, AiProvider } from "@/server/ai/types";
import type { VkApiResult, VkTransport } from "@/server/social/vk-api";

const auth = createAuthService(prisma, "http://localhost:3000");
const projects = createProjectService(prisma);
const workspaces = createWorkspaceService(prisma);
const VK_TOKEN = `vk1.a.${"A".repeat(80)}`;

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

function scriptedVk(
  handlers: Record<string, VkApiResult<unknown> | ((params: Record<string, string | number>) => VkApiResult<unknown>)>,
): VkTransport & { methods: string[] } {
  const methods: string[] = [];
  return {
    methods,
    async call(_token, method, params = {}) {
      methods.push(method);
      const handler = handlers[method];
      if (!handler) {
        return { ok: false, error_code: 3, error_msg: `unexpected ${method}` };
      }
      return typeof handler === "function" ? handler(params) : handler;
    },
  };
}

function scriptedAi(output: AiGenerateOutput): AiProvider {
  return {
    name: "scripted",
    model: "test-model",
    imageModel: "none",
    ready: true,
    imageReady: false,
    async generate() {
      return output;
    },
    async generateImage() {
      throw new Error("no image");
    },
  };
}

describe("VK watch idea agent", () => {
  const previousKey = process.env.TOKEN_ENCRYPTION_KEY;

  beforeAll(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "vk-watch-tests";
    await prisma.$connect();
  });

  afterAll(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = previousKey;
    await prisma.$disconnect();
  });

  it("rejects a VK password and does not invent ideas without a live wall", async () => {
    const owner = await registerOwner("watch-empty");
    const vk = scriptedVk({
      "utils.resolveScreenName": { ok: true, response: { type: "group", object_id: 10 } },
      "wall.get": { ok: true, response: { count: 0, items: [] } },
    });
    const watch = createWatchService(prisma, {
      vk,
      ai: createAiService(prisma, { provider: scriptedAi({ title: "нет", body: "", items: ["не должно появиться"], raw: "", provider: "scripted", model: "test" }) }),
    });

    await expectAccess(
      watch.connectToken(owner.userId, owner.workspaceId, { token: "qwerty123", password: "secret" }),
      400,
      /Пароль ВКонтакте не принимается/,
    );
    await expectAccess(watch.connectToken(owner.userId, owner.workspaceId, { token: "not-a-key" }), 400, /не ключ VK API/);
    await expectAccess(watch.collectIdeas(owner.userId, owner.workspaceId, {}), 400, /Сначала ключ VK API/);

    await watch.connectToken(owner.userId, owner.workspaceId, { token: VK_TOKEN });
    await watch.addCommunity(owner.userId, owner.workspaceId, "https://vk.com/club10");
    await expectAccess(watch.collectIdeas(owner.userId, owner.workspaceId, {}), 400, /Не удалось прочитать посты/);
  });

  it("reads community posts and stores original ideas, then applies one to a Telegram draft", async () => {
    const owner = await registerOwner("watch-ok");
    const vk = scriptedVk({
      "utils.resolveScreenName": { ok: true, response: { type: "group", object_id: 55 } },
      "wall.get": {
        ok: true,
        response: {
          count: 1,
          items: [
            {
              id: 7,
              owner_id: -55,
              date: 1731600000,
              text: "Пять ошибок хранения специй на кухне",
              likes: { count: 12 },
            },
          ],
        },
      },
    });
    const watch = createWatchService(prisma, {
      vk,
      ai: createAiService(prisma, {
        provider: scriptedAi({
          title: "Идеи по кухне",
          body: "По мотивам чужих стен, не копии.",
          items: ["Специи на вид || Соседи пишут про хаос на полке || Куда деть 12 баночек за вечер"],
          raw: "",
          provider: "scripted",
          model: "test",
        }),
      }),
    });

    await watch.connectToken(owner.userId, owner.workspaceId, { token: VK_TOKEN });
    await watch.addCommunity(owner.userId, owner.workspaceId, "vk.com/club55");
    const collected = await watch.collectIdeas(owner.userId, owner.workspaceId, {
      brief: "Дом по полочкам",
      projectId: owner.projectId,
    });
    expect(collected.posts).toHaveLength(1);
    expect(collected.posts[0]?.text).toMatch(/специй/);
    expect(collected.request.kind).toBe(WATCH_IDEAS_KIND);
    expect(collected.request.items[0]).toMatch(/Специи/);

    const post = await watch.applyIdea(owner.userId, owner.workspaceId, collected.request.id, 0, owner.projectId);
    expect(post.targets.map((target) => target.platform)).toEqual(["telegram"]);
    expect(post.versions[0]?.title).toMatch(/Специи/);
  });

  it("blocks a Viewer from adding communities", async () => {
    const owner = await registerOwner("watch-acl");
    const viewer = await registerOwner("watch-viewer");
    await workspaces.addMember(owner.userId, owner.workspaceId, viewer.address, "Viewer");
    const watch = createWatchService(prisma, { vk: scriptedVk({}) });
    await expectAccess(watch.addCommunity(viewer.userId, owner.workspaceId, "club1"), 403, /Недостаточно прав/);
  });
});
