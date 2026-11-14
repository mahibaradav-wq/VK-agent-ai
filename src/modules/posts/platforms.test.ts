import { describe, expect, it } from "vitest";

import {
  isLivePublishPlatform,
  parsePlatforms,
  previewPlatforms,
  vkUnavailableMessage,
} from "@/modules/posts/platforms";

describe("publish platforms", () => {
  it("lists Telegram first and treats VK as a live community-token target", () => {
    expect(previewPlatforms.map((item) => item.id)).toEqual(["telegram", "vk"]);
    expect(isLivePublishPlatform("telegram")).toBe(true);
    expect(isLivePublishPlatform("vk")).toBe(true);
    expect(parsePlatforms(["vk", "telegram", "vk"])).toEqual(["vk", "telegram"]);
    expect(vkUnavailableMessage).toMatch(/ключ доступа сообщества/);
  });
});
