import { describe, expect, it } from "vitest";

import { mailboxActionUrl, mailboxToken } from "@/lib/mailbox-url";

describe("mailboxActionUrl", () => {
  it("keeps a relative confirmation link on the current host", () => {
    expect(mailboxActionUrl("/verify-email?token=abc")).toBe("/verify-email?token=abc");
  });

  it("strips a dead tunnel host so confirmation still opens here", () => {
    expect(mailboxActionUrl("https://old-tunnel.trycloudflare.com/verify-email?token=abc")).toBe(
      "/verify-email?token=abc",
    );
    expect(mailboxActionUrl("http://localhost:3000/reset-password?token=xyz")).toBe("/reset-password?token=xyz");
  });

  it("extracts the token from either form", () => {
    expect(mailboxToken("https://example.test/verify-email?token=secret")).toBe("secret");
    expect(mailboxToken("/reset-password?token=secret")).toBe("secret");
  });
});
