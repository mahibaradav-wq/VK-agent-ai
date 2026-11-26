import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { sanitizeDiagnosticError } from "@/modules/ai/paid-settlement";

describe("worker & diagnostic log redaction", () => {
  it("redacts telegram bot URLs, redis URLs, and vk2 tokens in diagnostic errors", () => {
    const botSecret = "1234567:ABCDEFGHIJKLMNOPQRSTUVWX";
    const redisSecret = "super_redis_secret_987";
    const vk2Secret = "vk2.a.long_secret_vk_token_123456";

    const err = new Error(
      `POST https://api.telegram.org/bot${botSecret}/sendMessage failed; redis://:${redisSecret}@redis:6379; ${vk2Secret}`,
    );

    const sanitized = sanitizeDiagnosticError(err);
    expect(sanitized).not.toContain(botSecret);
    expect(sanitized).not.toContain(redisSecret);
    expect(sanitized).not.toContain(vk2Secret);
  });

  it("never passes raw unsanitized error objects to console.error in worker.ts", () => {
    const workerSource = readFileSync(path.resolve(process.cwd(), "src/server/queue/worker.ts"), "utf8");
    const errorLogCalls = workerSource.match(/console\.error\([^\n;]+/g) ?? [];
    expect(errorLogCalls.length).toBeGreaterThan(0);
    for (const call of errorLogCalls) {
      expect(call).toContain("sanitizeDiagnosticError(");
    }
  });
});
