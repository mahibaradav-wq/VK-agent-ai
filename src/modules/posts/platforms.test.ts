import { describe, expect, it } from "vitest";

import {
  defaultPublishPlatforms,
  isLivePublishPlatform,
  parsePlatforms,
  parseStoredPlatforms,
  previewPlatforms,
  vkUnavailableMessage,
} from "@/modules/posts/platforms";

describe("publish platforms", () => {
  it("lists Telegram first and treats VK as a live community-token target", () => {
    expect(previewPlatforms.map((item) => item.id)).toEqual(["telegram", "vk"]);
    expect(isLivePublishPlatform("telegram")).toBe(true);
    expect(isLivePublishPlatform("vk")).toBe(true);
    expect(parsePlatforms(["vk", "telegram", "vk"])).toEqual(["vk", "telegram"]);
    expect(defaultPublishPlatforms([])).toEqual(["telegram", "vk"]);
    expect(defaultPublishPlatforms(["vk"])).toEqual(["vk"]);
    expect(parseStoredPlatforms("telegram,vk")).toEqual(["telegram", "vk"]);
    expect(vkUnavailableMessage).toMatch(/ключ доступа сообщества/);
  });
});
