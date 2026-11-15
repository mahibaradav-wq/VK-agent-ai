import { describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { parseTelegramChatSource } from "@/modules/social/telegram-chat";

describe("telegram chat source", () => {
  it("accepts t.me links, @username and numeric chat ids", () => {
    expect(parseTelegramChatSource("t.me/dom_po_polochkam")).toBe("@dom_po_polochkam");
    expect(parseTelegramChatSource("https://t.me/dom_po_polochkam")).toBe("@dom_po_polochkam");
    expect(parseTelegramChatSource("@dom_po_polochkam")).toBe("@dom_po_polochkam");
    expect(parseTelegramChatSource("-1004392473566")).toBe("-1004392473566");
    expect(parseTelegramChatSource("77")).toBe("77");
  });

  it("rejects empty and private invite hashes", () => {
    expect(() => parseTelegramChatSource("")).toThrow(AccessError);
    expect(() => parseTelegramChatSource("https://t.me/+secretinvite")).toThrow(/не канал/);
  });
});
