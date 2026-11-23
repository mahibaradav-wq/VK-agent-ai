import { describe, expect, it } from "vitest";

import { toVkWallText, vkWallCopy } from "@/modules/social/vk-wall-text";

describe("VK wall text", () => {
  it("strips markdown so Studio can copy a wall-ready text without importing the adapter", () => {
    expect(toVkWallText("**Полки** и [ссылка](https://example.test/a)")).toBe("Полки и ссылка https://example.test/a");
    expect(vkWallCopy("*Заголовок*", "Текст  \nвторой")).toBe("Заголовок\n\nТекст\nвторой");
  });
});
