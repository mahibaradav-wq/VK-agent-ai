import { afterEach, describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { decryptToken, encryptToken } from "@/server/crypto/token-cipher";

describe("token cipher", () => {
  const previousKey = process.env.TOKEN_ENCRYPTION_KEY;
  const previousSecret = process.env.AUTH_SECRET;

  afterEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = previousKey;
    process.env.AUTH_SECRET = previousSecret;
  });

  it("round-trips a bot token", () => {
    process.env.TOKEN_ENCRYPTION_KEY = "stage8-test-key";
    const packed = encryptToken("123456:AA-secret-bot-token");
    expect(packed.split(".")).toHaveLength(3);
    expect(packed).not.toContain("secret-bot-token");
    expect(decryptToken(packed)).toBe("123456:AA-secret-bot-token");
  });

  it("fails closed without an encryption key", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.AUTH_SECRET;
    expect(() => encryptToken("x")).toThrow(AccessError);
  });
});
