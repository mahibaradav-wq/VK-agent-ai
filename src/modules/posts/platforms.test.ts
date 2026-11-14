import { describe, expect, it } from "vitest";

import {
  isLivePublishPlatform,
  parsePlatforms,
  previewPlatforms,
  vkUnavailableMessage,
} from "@/modules/posts/platforms";

describe("publish platforms", () => {
  it("lists Telegram first and does not treat VK as a live publish target", () => {
    expect(previewPlatforms.map((item) => item.id)).toEqual(["telegram", "vk"]);
    expect(isLivePublishPlatform("telegram")).toBe(true);
    expect(isLivePublishPlatform("vk")).toBe(false);
    expect(parsePlatforms(["vk", "telegram", "vk"])).toEqual(["vk", "telegram"]);
    expect(vkUnavailableMessage).toMatch(/VK ID/);
  });
});
