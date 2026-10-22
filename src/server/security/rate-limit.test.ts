import { afterEach, describe, expect, it } from "vitest";

import { consumeRateLimit, resetRateLimits } from "@/server/security/rate-limit";

describe("auth rate limit", () => {
  afterEach(() => {
    resetRateLimits();
  });

  it("allows requests under the limit and blocks the next", () => {
    expect(consumeRateLimit("login:test", 2, 60_000, 1_000).ok).toBe(true);
    expect(consumeRateLimit("login:test", 2, 60_000, 1_100).ok).toBe(true);
    expect(consumeRateLimit("login:test", 2, 60_000, 1_200).ok).toBe(false);
  });

  it("resets after the window", () => {
    expect(consumeRateLimit("login:window", 1, 1_000, 5_000).ok).toBe(true);
    expect(consumeRateLimit("login:window", 1, 1_000, 5_500).ok).toBe(false);
    expect(consumeRateLimit("login:window", 1, 1_000, 6_001).ok).toBe(true);
  });
});
