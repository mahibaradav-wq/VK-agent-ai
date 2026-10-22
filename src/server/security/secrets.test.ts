import { describe, expect, it } from "vitest";

import { securityHeaders } from "@/server/security/headers";
import { SECRET_LEAK_RE, assertAuthSecret, assertNoSecretLeak } from "@/server/security/secrets";

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

  it("declares clickjacking and CSP headers", () => {
    const names = securityHeaders.map((item) => item.key);
    expect(names).toContain("Content-Security-Policy");
    expect(names).toContain("X-Frame-Options");
    expect(securityHeaders.find((item) => item.key === "X-Frame-Options")?.value).toBe("DENY");
  });
});
