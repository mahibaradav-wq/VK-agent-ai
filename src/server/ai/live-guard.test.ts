import { afterEach, describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { fetchAiBalance } from "@/server/ai/balance";
import { assertAiLiveEnabled, assertPaidAiAllowed, cabinetMonthlyAiLimit, isAiLiveEnabled } from "@/server/ai/live-guard";
import { createOpenAiCompatibleProvider } from "@/server/ai/openai-compatible";
import { probeAiApiKey } from "@/server/ai/probe";

describe("paid AI live guard", () => {
  const previousLive = process.env.AI_LIVE_ENABLED;
  const previousLimit = process.env.AI_MONTHLY_HARD_LIMIT;

  afterEach(() => {
    if (previousLive === undefined) {
      delete process.env.AI_LIVE_ENABLED;
    } else {
      process.env.AI_LIVE_ENABLED = previousLive;
    }
    if (previousLimit === undefined) {
      delete process.env.AI_MONTHLY_HARD_LIMIT;
    } else {
      process.env.AI_MONTHLY_HARD_LIMIT = previousLimit;
    }
  });

  it("stays off unless AI_LIVE_ENABLED is exactly true", () => {
    delete process.env.AI_LIVE_ENABLED;
    expect(isAiLiveEnabled()).toBe(false);
    expect(() => assertAiLiveEnabled()).toThrow(AccessError);
    process.env.AI_LIVE_ENABLED = "1";
    expect(isAiLiveEnabled()).toBe(false);
    process.env.AI_LIVE_ENABLED = "true";
    expect(isAiLiveEnabled()).toBe(true);
  });

  it("blocks the default OpenAI fetch path and still allows injected test fetchers", async () => {
    delete process.env.AI_LIVE_ENABLED;
    const live = createOpenAiCompatibleProvider({
      apiKey: "sk-test-not-used",
      baseUrl: "https://example.test/v1",
      model: "gpt-4o-mini",
    });
    await expect(live.generate({ kind: "headline", prompt: "полка", tone: "neutral", length: "medium", platform: "vk" })).rejects.toMatchObject({
      status: 403,
      message: /AI_LIVE_ENABLED/,
    });
    await expect(live.generateImage({ prompt: "полка с банками" })).rejects.toMatchObject({
      status: 403,
      message: /AI_LIVE_ENABLED/,
    });
    await expect(
      probeAiApiKey({ apiKey: "sk-test-not-used", baseUrl: "https://example.test/v1" }),
    ).rejects.toMatchObject({ status: 403, message: /AI_LIVE_ENABLED/ });

    const mocked = createOpenAiCompatibleProvider({
      apiKey: "sk-test-not-used",
      baseUrl: "https://example.test/v1",
      model: "gpt-4o-mini",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            model: "gpt-4o-mini",
            choices: [{ message: { content: JSON.stringify({ title: "Полка", body: "Текст", items: [] }) } }],
          }),
          { status: 200 },
        ),
    });
    const result = await mocked.generate({
      kind: "headline",
      prompt: "полка",
      tone: "neutral",
      length: "medium",
      platform: "vk",
    });
    expect(result.title).toBe("Полка");
  });

  it("does not call ChatGPT billing endpoints while live AI is off", async () => {
    delete process.env.AI_LIVE_ENABLED;
    const result = await fetchAiBalance({
      apiKey: "sk-test-not-used",
      baseUrl: "https://example.test/v1",
    });
    expect(result.remainingUsd).toBeNull();
    expect(result.source).toBe("none");
    expect(result.message).toMatch(/AI-запросы выключены/);
  });

  it("blocks live calls when the cabinet budget is unset even if AI_LIVE_ENABLED is true", async () => {
    process.env.AI_LIVE_ENABLED = "true";
    delete process.env.AI_MONTHLY_HARD_LIMIT;
    expect(cabinetMonthlyAiLimit()).toBeNull();
    expect(() => assertPaidAiAllowed()).toThrow(/AI_MONTHLY_HARD_LIMIT/);
    const live = createOpenAiCompatibleProvider({
      apiKey: "sk-test-not-used",
      baseUrl: "https://example.test/v1",
      model: "gpt-4o-mini",
    });
    await expect(live.generate({ kind: "headline", prompt: "полка", tone: "neutral", length: "medium", platform: "vk" })).rejects.toMatchObject({
      status: 403,
      message: /AI_MONTHLY_HARD_LIMIT/,
    });
  });
});
