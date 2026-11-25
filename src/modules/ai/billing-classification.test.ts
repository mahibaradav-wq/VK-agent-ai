import { describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import {
  attachPaidCalls,
  classifyFetchFailure,
  classifyPaidHttpOutcome,
  paidCallsForHttpClass,
  paidCallsFromError,
} from "@/modules/ai/usage-units";
import { createOpenAiCompatibleProvider } from "@/server/ai/openai-compatible";

function fetchError(message: string, code?: string) {
  const error = new Error(message);
  if (code) {
    Object.assign(error, { code });
  }
  return error;
}

describe("AI billing network classification", () => {
  it("DNS / connect refused before send → 0 when proven", () => {
    expect(paidCallsForHttpClass(classifyFetchFailure(fetchError("getaddrinfo ENOTFOUND api", "ENOTFOUND")))).toBe(0);
    expect(paidCallsForHttpClass(classifyFetchFailure(fetchError("connect ECONNREFUSED", "ECONNREFUSED")))).toBe(0);
    expect(paidCallsForHttpClass(classifyPaidHttpOutcome({ requestNeverSent: true }))).toBe(0);
  });

  it("timeout / abort after send path → 1", () => {
    const abort = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    expect(paidCallsForHttpClass(classifyFetchFailure(abort))).toBe(1);
    expect(paidCallsForHttpClass(classifyFetchFailure(fetchError("socket hang up", "ECONNRESET")))).toBe(1);
  });

  it("disconnect with no HTTP response and unknown cause → 1", () => {
    expect(paidCallsForHttpClass(classifyFetchFailure(fetchError("fetch failed")))).toBe(1);
    expect(paidCallsForHttpClass(classifyPaidHttpOutcome({}))).toBe(1);
  });

  it("HTTP 4xx/5xx keep billable policy (1)", () => {
    expect(paidCallsForHttpClass(classifyPaidHttpOutcome({ httpReached: true }))).toBe(1);
  });

  it("success path reports paidCalls 1 from openai-compatible provider", async () => {
    const provider = createOpenAiCompatibleProvider({
      apiKey: "sk-test",
      baseUrl: "https://example.test/v1",
      model: "demo",
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"A","body":"B","items":[]}' } }] }), {
          status: 200,
        }),
    });
    const result = await provider.generate({
      kind: "ideas",
      prompt: "полка",
      tone: "friendly",
      length: "short",
      platform: "telegram",
    });
    expect(result.paidCalls).toBe(1);
  });

  it("openai-compatible DNS failure attaches paidCalls 0", async () => {
    const provider = createOpenAiCompatibleProvider({
      apiKey: "sk-test",
      baseUrl: "https://example.test/v1",
      model: "demo",
      fetchImpl: async () => {
        throw fetchError("getaddrinfo ENOTFOUND example.test", "ENOTFOUND");
      },
    });
    const error = await provider
      .generate({
        kind: "ideas",
        prompt: "полка",
        tone: "friendly",
        length: "short",
        platform: "telegram",
      })
      .then(
        () => {
          throw new Error("expected failure");
        },
        (err: unknown) => err,
      );
    expect(error).toBeInstanceOf(AccessError);
    expect(paidCallsFromError(error)).toBe(0);
  });

  it("openai-compatible timeout attaches paidCalls 1", async () => {
    const provider = createOpenAiCompatibleProvider({
      apiKey: "sk-test",
      baseUrl: "https://example.test/v1",
      model: "demo",
      fetchImpl: async () => {
        throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
      },
    });
    const error = await provider
      .generate({
        kind: "ideas",
        prompt: "полка",
        tone: "friendly",
        length: "short",
        platform: "telegram",
      })
      .then(
        () => {
          throw new Error("expected failure");
        },
        (err: unknown) => err,
      );
    expect(paidCallsFromError(error)).toBe(1);
  });

  it("HTTP error response attaches paidCalls 1 without double-wrapping", async () => {
    const provider = createOpenAiCompatibleProvider({
      apiKey: "sk-test",
      baseUrl: "https://example.test/v1",
      model: "demo",
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: "nope" } }), { status: 500 }),
    });
    const error = await provider
      .generate({
        kind: "ideas",
        prompt: "полка",
        tone: "friendly",
        length: "short",
        platform: "telegram",
      })
      .then(
        () => {
          throw new Error("expected failure");
        },
        (err: unknown) => err,
      );
    expect(paidCallsFromError(error)).toBe(1);
    // attachPaidCalls is idempotent for accounting — still a single unit on the error object.
    expect(paidCallsFromError(attachPaidCalls(error as Error, paidCallsFromError(error)))).toBe(1);
  });
});
