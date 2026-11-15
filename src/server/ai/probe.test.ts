import { describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { probeAiApiKey } from "@/server/ai/probe";
import { QWEN_KEY_REGION_MESSAGE, QWEN_UNAVAILABLE_MESSAGE } from "@/server/ai/errors";

describe("AI key probe", () => {
  it("explains a Qwen 401 as a Beijing vs Singapore key mismatch", async () => {
    await expect(
      probeAiApiKey({
        apiKey: "sk-qwen-secret-key",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        provider: "qwen",
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: { code: "invalid_api_key", message: "Incorrect API key provided" } }), {
            status: 401,
          }),
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: QWEN_KEY_REGION_MESSAGE,
    } satisfies Partial<AccessError>);
  });

  it("fails fast when DashScope never answers", async () => {
    await expect(
      probeAiApiKey({
        apiKey: "sk-qwen-secret-key",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        provider: "qwen",
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
      message: QWEN_UNAVAILABLE_MESSAGE,
    } satisfies Partial<AccessError>);
  });
});
