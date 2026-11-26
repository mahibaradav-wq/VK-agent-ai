import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createAiService } from "@/modules/ai/ai-service";
import { paidCallsFromError } from "@/modules/ai/usage-units";
import { createAuthService } from "@/modules/auth/auth-service";
import { createProjectService } from "@/modules/projects/project-service";
import { createOpenAiCompatibleProvider } from "@/server/ai/openai-compatible";
import type { AiGenerateInput, AiProvider } from "@/server/ai/types";
import { prisma } from "@/server/db/prisma";
import { createLocalStorage } from "@/server/storage/local-storage";

const BASE_URL = "https://provider.example.test/v1";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const IDEAS_INPUT: AiGenerateInput = {
  kind: "ideas",
  prompt: "полки в прихожей",
  tone: "friendly",
  length: "short",
  platform: "telegram",
};

const VALID_CHAT = JSON.stringify({
  model: "demo",
  choices: [{ message: { content: '{"title":"Идеи","body":"","items":["одна","две"]}' } }],
});

function fetchError(message: string, code?: string) {
  const error = new Error(message);
  if (code) {
    Object.assign(error, { code });
  }
  return error;
}

function jsonResponse(body: string, status = 200) {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

/** 2xx response whose body stream errors mid-read (connection dropped after headers). */
function brokenBodyResponse(partial = '{"choices":[{"mess') {
  let sent = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(new TextEncoder().encode(partial));
        return;
      }
      controller.error(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
}

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

function fakeFetch(routes: { chat?: Route; image?: Route; download?: Route }) {
  const calls = { chat: 0, image: 0, download: 0, total: 0 };
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.total += 1;
    if (url === `${BASE_URL}/chat/completions`) {
      calls.chat += 1;
      if (!routes.chat) throw new Error("unexpected chat call");
      return routes.chat(url, init);
    }
    if (url === `${BASE_URL}/images/generations`) {
      calls.image += 1;
      if (!routes.image) throw new Error("unexpected image call");
      return routes.image(url, init);
    }
    calls.download += 1;
    if (!routes.download) throw new Error(`unexpected download ${url}`);
    return routes.download(url, init);
  }) as typeof fetch;
  return { impl, calls };
}

function provider(fetchImpl: typeof fetch, name = "openai-compatible") {
  return createOpenAiCompatibleProvider({
    apiKey: "sk-test-not-real",
    baseUrl: BASE_URL,
    model: "demo",
    imageModel: "gpt-image-test",
    name,
    fetchImpl,
  });
}

async function failure(promise: Promise<unknown>) {
  return promise.then(
    () => {
      throw new Error("expected failure");
    },
    (error: unknown) => error,
  );
}

describe("PR67 text: billing after the provider answered", () => {
  it("T1) 200 + valid JSON → paidCalls 1", async () => {
    const { impl, calls } = fakeFetch({ chat: () => jsonResponse(VALID_CHAT) });
    const result = await provider(impl).generate(IDEAS_INPUT);
    expect(result.paidCalls).toBe(1);
    expect(calls.chat).toBe(1);
  });

  it("T2) 200 + broken JSON → paidCalls 1", async () => {
    const { impl, calls } = fakeFetch({ chat: () => jsonResponse("{not json") });
    const error = await failure(provider(impl).generate(IDEAS_INPUT));
    expect(error).toBeInstanceOf(AccessError);
    expect(paidCallsFromError(error)).toBe(1);
    expect(calls.chat).toBe(1);
  });

  it("T3) 200 + body read error (stream reset) → paidCalls 1", async () => {
    const { impl, calls } = fakeFetch({ chat: () => brokenBodyResponse() });
    const error = await failure(provider(impl).generate(IDEAS_INPUT));
    expect(error).toBeInstanceOf(AccessError);
    expect(paidCallsFromError(error)).toBe(1);
    expect(calls.chat).toBe(1);
  });

  it("T3b) 200 + JSON that is not an object (null) → paidCalls 1", async () => {
    const { impl } = fakeFetch({ chat: () => jsonResponse("null") });
    const error = await failure(provider(impl).generate(IDEAS_INPUT));
    expect(paidCallsFromError(error)).toBe(1);
  });

  it("T4) HTTP 500 → paidCalls 1", async () => {
    const { impl, calls } = fakeFetch({ chat: () => jsonResponse('{"error":{"message":"boom"}}', 500) });
    const error = await failure(provider(impl).generate(IDEAS_INPUT));
    expect(paidCallsFromError(error)).toBe(1);
    expect(calls.chat).toBe(1);
  });

  it("T5) DNS failure before send → paidCalls 0", async () => {
    const { impl } = fakeFetch({
      chat: () => {
        throw fetchError("getaddrinfo ENOTFOUND provider.example.test", "ENOTFOUND");
      },
    });
    const error = await failure(provider(impl).generate(IDEAS_INPUT));
    expect(paidCallsFromError(error)).toBe(0);
  });

  it("T6) timeout / connection reset → paidCalls 1", async () => {
    for (const thrown of [
      Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }),
      fetchError("read ECONNRESET", "ECONNRESET"),
    ]) {
      const { impl } = fakeFetch({
        chat: () => {
          throw thrown;
        },
      });
      const error = await failure(provider(impl).generate(IDEAS_INPUT));
      expect(paidCallsFromError(error)).toBe(1);
    }
  });

  it("T7) post: draft OK, revise returns 200 + broken JSON → paidCalls 2, draft kept", async () => {
    let n = 0;
    const { impl, calls } = fakeFetch({
      chat: () => {
        n += 1;
        return n === 1
          ? jsonResponse(
              JSON.stringify({ choices: [{ message: { content: '{"title":"Пост","body":"Коротко.","items":[]}' } }] }),
            )
          : jsonResponse("{broken");
      },
    });
    const result = await provider(impl).generate({ ...IDEAS_INPUT, kind: "post", length: "long" });
    expect(calls.chat).toBe(2);
    expect(result.paidCalls).toBe(2);
    expect(result.body).toBe("Коротко.");
  });

  it("T8) post: draft returns 200 + broken body → paidCalls 1, no revise call", async () => {
    const { impl, calls } = fakeFetch({ chat: () => brokenBodyResponse() });
    const error = await failure(provider(impl).generate({ ...IDEAS_INPUT, kind: "post", length: "long" }));
    expect(calls.chat).toBe(1);
    expect(paidCallsFromError(error)).toBe(1);
  });
});

describe("PR67 images: every stage after HTTP 2xx keeps paidCalls 1", () => {
  const imageInput = { prompt: "полка в прихожей" };

  async function imageError(routes: Parameters<typeof fakeFetch>[0]) {
    const fake = fakeFetch(routes);
    const error = await failure(provider(fake.impl).generateImage(imageInput));
    return { error, calls: fake.calls };
  }

  it("I1) 200 + b64_json → paidCalls 1", async () => {
    const { impl, calls } = fakeFetch({
      image: () => jsonResponse(JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }] })),
    });
    const result = await provider(impl).generateImage(imageInput);
    expect(result.paidCalls).toBe(1);
    expect(result.mimeType).toBe("image/png");
    expect(calls.image).toBe(1);
    expect(calls.download).toBe(0);
  });

  it("I2) 200 + URL + successful download → paidCalls 1 (download is not a second unit)", async () => {
    const { impl, calls } = fakeFetch({
      image: () => jsonResponse(JSON.stringify({ data: [{ url: "https://cdn.example.test/a.png" }] })),
      download: () => new Response(PNG, { status: 200 }),
    });
    const result = await provider(impl).generateImage(imageInput);
    expect(result.paidCalls).toBe(1);
    expect(calls.image).toBe(1);
    expect(calls.download).toBe(1);
  });

  it("I3) 200 + broken JSON → 1", async () => {
    const { error, calls } = await imageError({ image: () => jsonResponse("{oops") });
    expect(error).toBeInstanceOf(AccessError);
    expect(paidCallsFromError(error)).toBe(1);
    expect(calls.image).toBe(1);
  });

  it("I3b) 200 + body stream reset → 1", async () => {
    const { error } = await imageError({ image: () => brokenBodyResponse('{"data":[{"b64') });
    expect(paidCallsFromError(error)).toBe(1);
  });

  it("I4) 200 + no file (no data / no b64_json / no url) → 1", async () => {
    for (const body of ["{}", '{"data":[]}', '{"data":[{}]}', "null"]) {
      const { error, calls } = await imageError({ image: () => jsonResponse(body) });
      expect(error, body).toBeInstanceOf(AccessError);
      expect(paidCallsFromError(error), body).toBe(1);
      expect(calls.download, body).toBe(0);
    }
  });

  it("I5) 200 + malformed or non-HTTPS URL → 1, no download attempt", async () => {
    for (const url of ["not a url", "http://cdn.example.test/a.png", "file:///etc/passwd"]) {
      const { error, calls } = await imageError({
        image: () => jsonResponse(JSON.stringify({ data: [{ url }] })),
      });
      expect(paidCallsFromError(error), url).toBe(1);
      expect(calls.download, url).toBe(0);
    }
  });

  it("I6) 200 + download GET fails (network, 404, 500) → 1", async () => {
    const downloads: Route[] = [
      () => {
        throw fetchError("read ECONNRESET", "ECONNRESET");
      },
      () => new Response("missing", { status: 404 }),
      () => new Response("err", { status: 500 }),
    ];
    for (const download of downloads) {
      const { error, calls } = await imageError({
        image: () => jsonResponse(JSON.stringify({ data: [{ url: "https://cdn.example.test/a.png" }] })),
        download,
      });
      expect(paidCallsFromError(error)).toBe(1);
      expect(calls.image).toBe(1);
      expect(calls.download).toBe(1);
    }
  });

  it("I7) 200 + download arrayBuffer() aborts mid-stream → 1", async () => {
    const { error } = await imageError({
      image: () => jsonResponse(JSON.stringify({ data: [{ url: "https://cdn.example.test/a.png" }] })),
      download: () => brokenBodyResponse("\x89PNG"),
    });
    expect(paidCallsFromError(error)).toBe(1);
  });

  it("I8) 200 + corrupted / empty / unsupported file → 1", async () => {
    const payloads = [
      Buffer.from("definitely not an image"),
      Buffer.alloc(0),
      Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]),
    ];
    for (const payload of payloads) {
      const { error } = await imageError({
        image: () => jsonResponse(JSON.stringify({ data: [{ b64_json: payload.toString("base64") }] })),
      });
      expect(paidCallsFromError(error)).toBe(1);
    }
  });

  it("I9) 200 + file larger than the limit → 1", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(9 * 1024 * 1024)]);
    const { error } = await imageError({
      image: () => jsonResponse(JSON.stringify({ data: [{ url: "https://cdn.example.test/big.png" }] })),
      download: () => new Response(big, { status: 200 }),
    });
    expect(paidCallsFromError(error)).toBe(1);
  });

  it("I10) POST fails proven before send (DNS / ECONNREFUSED) → 0", async () => {
    for (const code of ["ENOTFOUND", "ECONNREFUSED"]) {
      const { error } = await imageError({
        image: () => {
          throw fetchError(`connect ${code}`, code);
        },
      });
      expect(paidCallsFromError(error), code).toBe(0);
    }
  });

  it("I11) POST fails with an undetermined error (timeout / reset / generic) → 1", async () => {
    for (const thrown of [
      Object.assign(new Error("aborted"), { name: "TimeoutError" }),
      fetchError("read ECONNRESET", "ECONNRESET"),
      new TypeError("fetch failed"),
    ]) {
      const { error } = await imageError({
        image: () => {
          throw thrown;
        },
      });
      expect(paidCallsFromError(error)).toBe(1);
    }
  });

  it("I12) HTTP 500 from /images/generations → 1 and no download", async () => {
    const { error, calls } = await imageError({ image: () => jsonResponse('{"error":{"message":"x"}}', 500) });
    expect(paidCallsFromError(error)).toBe(1);
    expect(calls.download).toBe(0);
  });
});

describe("PR67 integration through createAiService (test DB)", () => {
  const auth = createAuthService(prisma, "http://localhost:3000");
  const projects = createProjectService(prisma);
  let storageDir = "";

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "polka-pr67-"));
  });

  async function owner(label: string) {
    const address = `${label}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;
    await auth.register(address, "password123");
    const mail = await prisma.devMailMessage.findFirstOrThrow({
      where: { to: address, kind: "verify_email" },
      orderBy: { createdAt: "desc" },
    });
    await auth.verifyEmail(mail.url!.split("token=")[1]!);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: address } });
    const membership = await prisma.workspaceMember.findFirstOrThrow({ where: { userId: user.id } });
    const project = await projects.create(user.id, membership.workspaceId, { name: `Проект ${label}` });
    return { userId: user.id, workspaceId: membership.workspaceId, projectId: project.id };
  }

  it("text 200 + broken JSON: used +1 exactly, rest of the post reserve released", async () => {
    const o = await owner("pr67-text");
    const { impl, calls } = fakeFetch({ chat: () => jsonResponse("{broken") });
    const ai = createAiService(prisma, { provider: provider(impl), monthlyLimit: 10 });

    await expect(ai.generate(o.userId, o.workspaceId, { kind: "post", prompt: "борщ на ужин" })).rejects.toBeInstanceOf(
      AccessError,
    );

    expect(calls.chat).toBe(1);
    expect((await ai.usage(o.userId, o.workspaceId)).used).toBe(1);
  });

  it("text 200 + stream reset on ideas: used +1 exactly, no double charge", async () => {
    const o = await owner("pr67-text-reset");
    const { impl, calls } = fakeFetch({ chat: () => brokenBodyResponse() });
    const ai = createAiService(prisma, { provider: provider(impl), monthlyLimit: 10 });

    await expect(ai.generate(o.userId, o.workspaceId, { kind: "ideas", prompt: "полки" })).rejects.toBeInstanceOf(
      AccessError,
    );
    expect(calls.chat).toBe(1);
    expect((await ai.usage(o.userId, o.workspaceId)).used).toBe(1);
  });

  it("agent post: image generated but URL download fails → image adds exactly 1", async () => {
    const o = await owner("pr67-image");
    const { impl, calls } = fakeFetch({
      chat: () =>
        jsonResponse(
          JSON.stringify({ choices: [{ message: { content: '{"title":"Пост","body":"Текст поста.","items":[]}' } }] }),
        ),
      image: () => jsonResponse(JSON.stringify({ data: [{ url: "https://cdn.example.test/a.png" }] })),
      download: () => new Response("gone", { status: 500 }),
    });
    const ai = createAiService(prisma, {
      provider: provider(impl),
      monthlyLimit: 20,
      storage: createLocalStorage(storageDir),
    });

    await expect(
      ai.composeAgentPost(o.userId, o.workspaceId, {
        prompt: "полки в прихожей",
        platform: "telegram",
        projectId: o.projectId,
      }),
    ).rejects.toBeInstanceOf(AccessError);

    expect(calls.image).toBe(1);
    expect(calls.download).toBe(1);
    expect((await ai.usage(o.userId, o.workspaceId)).used).toBe(calls.chat + 1);
  });

  it("exhausted limit: no request is sent", async () => {
    const o = await owner("pr67-limit");
    const first = fakeFetch({ chat: () => jsonResponse("{broken") });
    const ai = createAiService(prisma, { provider: provider(first.impl), monthlyLimit: 1 });
    await expect(ai.generate(o.userId, o.workspaceId, { kind: "ideas", prompt: "полки" })).rejects.toBeInstanceOf(
      AccessError,
    );
    expect((await ai.usage(o.userId, o.workspaceId)).used).toBe(1);

    const second = fakeFetch({ chat: () => jsonResponse(VALID_CHAT) });
    const ai2 = createAiService(prisma, { provider: provider(second.impl), monthlyLimit: 1 });
    await expect(ai2.generate(o.userId, o.workspaceId, { kind: "ideas", prompt: "ещё" })).rejects.toThrow(/лимит/i);
    expect(second.calls.total).toBe(0);
    expect((await ai2.usage(o.userId, o.workspaceId)).used).toBe(1);
  });

  it("fallback keeps every paid attempt: region-blocked openai (HTTP) + backup 200 broken JSON = 2", async () => {
    const o = await owner("pr67-fallback");
    const openaiFetch = fakeFetch({
      chat: () => jsonResponse('{"error":{"code":"unsupported_country_region_territory"}}', 403),
    });
    const backupFetch = fakeFetch({ chat: () => jsonResponse("{broken") });
    const openai = provider(openaiFetch.impl, "openai");
    const backup = provider(backupFetch.impl, "backup");
    const connections = {
      resolveProvider: async () => openai,
      listProviders: async () => [openai, backup] as AiProvider[],
      rememberError: async () => undefined,
      openaiRegionBlocked: async () => false,
    };
    const ai = createAiService(prisma, {
      connections: connections as never,
      monthlyLimit: 10,
    });

    await expect(ai.generate(o.userId, o.workspaceId, { kind: "ideas", prompt: "полки" })).rejects.toBeInstanceOf(
      AccessError,
    );
    expect(openaiFetch.calls.chat).toBe(1);
    expect(backupFetch.calls.chat).toBe(1);
    expect((await ai.usage(o.userId, o.workspaceId)).used).toBe(2);
  });
});

describe("PR67 audit: charged > reserved must not be silently truncated", () => {
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

  function overspendingProvider(mode: "success" | "failure", paidCalls: number): AiProvider & { calls: number } {
    const self = {
      name: "overspend",
      model: "m",
      imageModel: "i",
      ready: true,
      imageReady: true,
      calls: 0,
      async generate() {
        self.calls += 1;
        if (mode === "failure") {
          const error = new AccessError(400, "провайдер упал после нескольких платных HTTP");
          Object.defineProperty(error, "paidCalls", { value: paidCalls, enumerable: true });
          throw error;
        }
        return { title: "t", body: "b", items: [], raw: "{}", provider: "overspend", model: "m", paidCalls };
      },
      async generateImage(): Promise<never> {
        throw new Error("not used");
      },
    };
    return self;
  }

  it("records confirmed paid calls above the reserve when the limit blocks the emergency grow (failure path)", async () => {
    const o = await workspace("pr67-over-fail");
    const p = overspendingProvider("failure", 3);
    const ai = createAiService(prisma, { provider: p, monthlyLimit: 2 });

    await expect(ai.generate(o.userId, o.workspaceId, { kind: "ideas", prompt: "полки" })).rejects.toBeInstanceOf(
      AccessError,
    );
    expect(p.calls).toBe(1);
    expect((await ai.usage(o.userId, o.workspaceId)).used).toBe(3);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "AI_USAGE_OVERAGE", entityId: o.workspaceId },
    });
    expect(audit?.details).toBe("units=2");
  });

  it("records confirmed paid calls above the reserve on the success path", async () => {
    const o = await workspace("pr67-over-ok");
    const p = overspendingProvider("success", 3);
    const ai = createAiService(prisma, { provider: p, monthlyLimit: 2 });

    await ai.generate(o.userId, o.workspaceId, { kind: "ideas", prompt: "полки" }).catch(() => undefined);
    expect((await ai.usage(o.userId, o.workspaceId)).used).toBe(3);

    const next = overspendingProvider("success", 1);
    const ai2 = createAiService(prisma, { provider: next, monthlyLimit: 2 });
    await expect(ai2.generate(o.userId, o.workspaceId, { kind: "ideas", prompt: "ещё" })).rejects.toThrow(/лимит/i);
    expect(next.calls).toBe(0);
  });

  it("error after settle does not release the reserve a second time (no fictitious release)", async () => {
    const o = await workspace("pr67-double-settle");
    const membership = await prisma.workspaceMember.findFirstOrThrow({ where: { workspaceId: o.workspaceId } });
    const project = await createProjectService(prisma).create(membership.userId, o.workspaceId, { name: "Проект" });
    let released = false;
    const failingPost = new Proxy(
      {},
      { get: () => async () => Promise.reject(new Error("post read failed after settle")) },
    );
    const db = new Proxy(prisma, {
      get(target, prop) {
        if (prop === "$executeRaw") {
          return async (...args: Parameters<typeof prisma.$executeRaw>) => {
            const result = await target.$executeRaw(...args);
            released = true;
            return result;
          };
        }
        if (prop === "post" && released) {
          return failingPost;
        }
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    let chat = 0;
    let image = 0;
    const scripted: AiProvider = {
      name: "scripted",
      model: "m",
      imageModel: "i",
      ready: true,
      imageReady: true,
      async generate() {
        chat += 1;
        return { title: "Полки в прихожей", body: "Текст поста про полки.", items: [], raw: "{}", provider: "scripted", model: "m", paidCalls: 1 };
      },
      async generateImage() {
        image += 1;
        return { bytes: PNG, mimeType: "image/png", provider: "scripted", model: "i", paidCalls: 1 };
      },
    };
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "polka-pr67-settle-"));
    const ai = createAiService(db as typeof prisma, {
      provider: scripted,
      monthlyLimit: 20,
      storage: createLocalStorage(storageDir),
    });

    await expect(
      ai.composeAgentPost(o.userId, o.workspaceId, { prompt: "полки", platform: "telegram", projectId: project.id }),
    ).rejects.toThrow(/post read failed after settle/);

    expect(released).toBe(true);
    expect(chat + image).toBe(2);
    expect((await createAiService(prisma, { monthlyLimit: 20, provider: scripted }).usage(o.userId, o.workspaceId)).used).toBe(2);
  });

  it("emergency grow succeeds within the limit: no overage audit, used == charged", async () => {
    const o = await workspace("pr67-over-grow");
    const p = overspendingProvider("failure", 3);
    const ai = createAiService(prisma, { provider: p, monthlyLimit: 10 });

    await expect(ai.generate(o.userId, o.workspaceId, { kind: "ideas", prompt: "полки" })).rejects.toBeInstanceOf(
      AccessError,
    );
    expect((await ai.usage(o.userId, o.workspaceId)).used).toBe(3);
    expect(
      await prisma.auditLog.count({ where: { action: "AI_USAGE_OVERAGE", entityId: o.workspaceId } }),
    ).toBe(0);
  });
});
