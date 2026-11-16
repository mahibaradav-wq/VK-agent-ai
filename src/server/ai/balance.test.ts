import { describe, expect, it } from "vitest";

import {
  creditGrantUrls,
  fetchAiBalance,
  formatUsd,
  parseCreditGrants,
  remainingFromSubscription,
} from "@/server/ai/balance";

describe("ChatGPT API balance", () => {
  it("parses prepaid credit grants and formats dollars", () => {
    expect(parseCreditGrants({ total_granted: 20, total_used: 7.5, total_available: 12.5 })).toBe(12.5);
    expect(parseCreditGrants({ data: { total_available: "3,40" } })).toBe(3.4);
    expect(parseCreditGrants({ hello: true })).toBeNull();
    expect(formatUsd(12.5)).toBe("12,50 $");
    expect(creditGrantUrls("https://api.openai.com/v1")[0]).toBe("https://api.openai.com/dashboard/billing/credit_grants");
  });

  it("reads remaining prepaid dollars from ChatGPT without inventing a number", async () => {
    const seen: string[] = [];
    const result = await fetchAiBalance({
      apiKey: "sk-test-secret-key",
      baseUrl: "https://api.openai.com/v1",
      fetchImpl: async (url, init) => {
        seen.push(String(url));
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe("Bearer sk-test-secret-key");
        return new Response(JSON.stringify({ total_granted: 18, total_used: 5.2, total_available: 12.8 }), {
          status: 200,
        });
      },
    });
    expect(result.remainingUsd).toBe(12.8);
    expect(result.source).toBe("credit_grants");
    expect(JSON.stringify(result)).not.toMatch(/sk-test-secret-key/);
    expect(seen[0]).toContain("/dashboard/billing/credit_grants");
  });

  it("falls back to monthly subscription leftover", async () => {
    const result = await fetchAiBalance({
      apiKey: "sk-test-secret-key",
      baseUrl: "https://api.openai.com/v1",
      now: () => new Date("2026-11-16T08:00:00.000Z"),
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.includes("credit_grants")) {
          return new Response("no", { status: 401 });
        }
        if (href.includes("subscription")) {
          return new Response(JSON.stringify({ hard_limit_usd: 50 }), { status: 200 });
        }
        if (href.includes("usage")) {
          return new Response(JSON.stringify({ total_usage: 1250 }), { status: 200 });
        }
        return new Response("no", { status: 404 });
      },
    });
    expect(result.source).toBe("subscription");
    expect(result.remainingUsd).toBe(37.5);
  });

  it("does not invent a zero balance when billing endpoints refuse the key", async () => {
    const result = await fetchAiBalance({
      apiKey: "sk-test-secret-key",
      baseUrl: "https://api.openai.com/v1",
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: "Unauthorized" } }), { status: 401 }),
    });
    expect(result.remainingUsd).toBeNull();
    expect(result.source).toBe("none");
    expect(result.message).toMatch(/не дал прочитать остаток/i);
  });

  it("computes leftover from a dollar usage field", () => {
    expect(remainingFromSubscription({ hard_limit_usd: 40 }, { total_usage: 12 })).toBe(28);
    expect(remainingFromSubscription({ hard_limit_usd: 50 }, { total_usage: 1250 })).toBe(37.5);
  });
});
