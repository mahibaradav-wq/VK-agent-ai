import { describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { parseVkCommunitySource } from "@/modules/watch/parse";
import { isVkAccessToken } from "@/server/social/vk-api";

describe("VK watch parse", () => {
  it("accepts community URLs and short names, and rejects personal pages", () => {
    expect(parseVkCommunitySource("https://vk.com/club2048871526")).toEqual({
      source: "https://vk.com/club2048871526",
      screenName: "club2048871526",
    });
    expect(parseVkCommunitySource("vk.com/public1?w=wall")).toMatchObject({ screenName: "public1" });
    expect(parseVkCommunitySource("@ikeahack")).toEqual({ source: "@ikeahack", screenName: "ikeahack" });
    expect(parseVkCommunitySource("12345")).toEqual({ source: "12345", screenName: "club12345" });
    expect(() => parseVkCommunitySource("https://vk.com/id1")).toThrow(AccessError);
  });

  it("does not treat a password as a VK API key", () => {
    expect(isVkAccessToken("qwerty")).toBe(false);
    expect(isVkAccessToken("password12345678")).toBe(false);
    expect(isVkAccessToken("vk1.a." + "A".repeat(80))).toBe(true);
  });
});
