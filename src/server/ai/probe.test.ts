import { describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { AI_UNAVAILABLE_MESSAGE } from "@/server/ai/errors";
import { probeAiApiKey } from "@/server/ai/probe";

describe("AI key probe", () => {
  it("explains a 401 as a rejected key, not a chat password", async () => {
    await expect(
      probeAiApiKey({
        apiKey: "sk-openai-secret-key",
        baseUrl: "https://api.openai.com/v1",
        provider: "openai",
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: { code: "invalid_api_key", message: "Incorrect API key provided" } }), {
            status: 401,
          }),
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Провайдер отклонил ключ. Нужен API-ключ, не пароль от чата.",
    } satisfies Partial<AccessError>);
  });

  it("returns catalog ids without spending a generation", async () => {
    const result = await probeAiApiKey({
      apiKey: "sk-test-openai-key",
      baseUrl: "https://api.openai.com/v1",
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: [{ id: "gpt-4o-mini" }, { id: "gpt-image-1.5" }] }), { status: 200 }),
    });
    expect(result.models).toEqual(["gpt-4o-mini", "gpt-image-1.5"]);
  });

  it("fails fast when OpenAI never answers", async () => {
    await expect(
      probeAiApiKey({
        apiKey: "sk-openai-secret-key",
        baseUrl: "https://api.openai.com/v1",
        provider: "openai",
        timeoutMs: 40,
        fetchImpl: (_url, init) =>
          new Promise((_, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            });
          }),
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: AI_UNAVAILABLE_MESSAGE,
    } satisfies Partial<AccessError>);
  });
});
