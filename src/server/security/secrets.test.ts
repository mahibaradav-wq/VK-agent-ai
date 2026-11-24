import { describe, expect, it } from "vitest";

import { securityHeaders } from "@/server/security/headers";
import { SECRET_LEAK_RE, assertAuthSecret, assertNoSecretLeak, assertProductionCabinetGuards } from "@/server/security/secrets";

describe("security invariants", () => {
  it("requires a non-placeholder AUTH_SECRET", () => {
    expect(() => assertAuthSecret("short")).toThrow(/минимум 32/);
    expect(() => assertAuthSecret("replace-with-a-long-random-string-value")).toThrow(/заглушкой/);
    expect(() => assertAuthSecret("a".repeat(32))).not.toThrow();
  });

  it("flags secret-shaped text and accepts ordinary pages", () => {
    expect(SECRET_LEAK_RE.test("AUTH_SECRET=abc")).toBe(true);
    expect(SECRET_LEAK_RE.test("whsec_live_example")).toBe(true);
    expect(() => assertNoSecretLeak("Требуется настройка интеграции")).not.toThrow();
    expect(() => assertNoSecretLeak("Bearer abcdefghi")).toThrow(/секрет/);
  });

  it("requires a dedicated token key and closed mailbox in production cabinet mode", () => {
    const previous = {
      secret: process.env.AUTH_SECRET,
      token: process.env.TOKEN_ENCRYPTION_KEY,
      mailbox: process.env.AUTH_DEV_MAILBOX,
      live: process.env.AI_LIVE_ENABLED,
      limit: process.env.AI_MONTHLY_HARD_LIMIT,
    };
    try {
      process.env.AUTH_SECRET = "a".repeat(32);
      delete process.env.TOKEN_ENCRYPTION_KEY;
      expect(() => assertProductionCabinetGuards()).toThrow(/TOKEN_ENCRYPTION_KEY/);
      process.env.TOKEN_ENCRYPTION_KEY = "a".repeat(32);
      expect(() => assertProductionCabinetGuards()).toThrow(/отличаться/);
      process.env.TOKEN_ENCRYPTION_KEY = "b".repeat(32);
      process.env.AUTH_DEV_MAILBOX = "true";
      expect(() => assertProductionCabinetGuards()).toThrow(/AUTH_DEV_MAILBOX/);
      process.env.AUTH_DEV_MAILBOX = "";
      process.env.AI_LIVE_ENABLED = "true";
      delete process.env.AI_MONTHLY_HARD_LIMIT;
      expect(() => assertProductionCabinetGuards()).toThrow(/AI_MONTHLY_HARD_LIMIT/);
      process.env.AI_LIVE_ENABLED = "";
      expect(() => assertProductionCabinetGuards()).not.toThrow();
    } finally {
      restoreEnv("AUTH_SECRET", previous.secret);
      restoreEnv("TOKEN_ENCRYPTION_KEY", previous.token);
      restoreEnv("AUTH_DEV_MAILBOX", previous.mailbox);
      restoreEnv("AI_LIVE_ENABLED", previous.live);
      restoreEnv("AI_MONTHLY_HARD_LIMIT", previous.limit);
    }
  });

  it("declares clickjacking and CSP headers", () => {
    const names = securityHeaders.map((item) => item.key);
    expect(names).toContain("Content-Security-Policy");
    expect(names).toContain("X-Frame-Options");
    expect(securityHeaders.find((item) => item.key === "X-Frame-Options")?.value).toBe("DENY");
  });
});

function restoreEnv(name: string, previous: string | undefined) {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}
