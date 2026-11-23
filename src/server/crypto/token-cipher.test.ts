import { afterEach, describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { decryptToken, encryptToken } from "@/server/crypto/token-cipher";

describe("token cipher", () => {
  const previousKey = process.env.TOKEN_ENCRYPTION_KEY;
  const previousSecret = process.env.AUTH_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (previousKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = previousKey;
    if (previousSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });

  it("round-trips a bot token with the dedicated key", () => {
    process.env.NODE_ENV = "test";
    process.env.TOKEN_ENCRYPTION_KEY = "stage8-test-key";
    process.env.AUTH_SECRET = "different-auth-secret";
    const packed = encryptToken("123456:AA-secret-bot-token");
    expect(packed.split(".")).toHaveLength(3);
    expect(packed).not.toContain("secret-bot-token");
    expect(decryptToken(packed)).toBe("123456:AA-secret-bot-token");
  });

  it("decrypts legacy tokens encrypted with AUTH_SECRET after a dedicated key is configured", () => {
    process.env.NODE_ENV = "test";
    delete process.env.TOKEN_ENCRYPTION_KEY;
    process.env.AUTH_SECRET = "legacy-auth-secret";
    const legacy = encryptToken("legacy-social-token");

    process.env.TOKEN_ENCRYPTION_KEY = "new-dedicated-encryption-key";
    expect(decryptToken(legacy)).toBe("legacy-social-token");
    expect(decryptToken(encryptToken("new-token"))).toBe("new-token");
  });

  it("requires a dedicated key for encryption in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.TOKEN_ENCRYPTION_KEY;
    process.env.AUTH_SECRET = "auth-secret-that-is-present";
    expect(() => encryptToken("x")).toThrow(AccessError);
  });

  it("rejects a weak or reused encryption key in production", () => {
    process.env.NODE_ENV = "production";
    process.env.AUTH_SECRET = "auth-secret-that-is-long-enough-for-production";
    process.env.TOKEN_ENCRYPTION_KEY = "too-short";
    expect(() => encryptToken("x")).toThrow(/не менее 32/);

    process.env.TOKEN_ENCRYPTION_KEY = process.env.AUTH_SECRET;
    expect(() => encryptToken("x")).toThrow(/отличаться/);
  });

  it("fails closed without any key", () => {
    process.env.NODE_ENV = "test";
    delete process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.AUTH_SECRET;
    expect(() => encryptToken("x")).toThrow(AccessError);
    expect(() => decryptToken("iv.data.tag")).toThrow(AccessError);
  });
});
