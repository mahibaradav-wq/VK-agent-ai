import { describe, expect, it } from "vitest";

import { draftInputFromForm } from "@/modules/posts/draft-fields";

describe("studio draft fields", () => {
  it("keeps Telegram and VK copy separate when both networks are checked", () => {
    const form = new FormData();
    form.set("title", "Общий");
    form.set("body", "Общий текст");
    form.set("telegramTitle", "ТГ заголовок");
    form.set("telegramBody", "Текст для канала");
    form.set("vkTitle", "ВК заголовок");
    form.set("vkBody", "Текст для стены");
    form.append("platform", "telegram");
    form.append("platform", "vk");
    expect(draftInputFromForm(form)).toMatchObject({
      title: "ТГ заголовок",
      body: "Текст для канала",
      platforms: ["telegram", "vk"],
      variants: {
        telegram: { title: "ТГ заголовок", body: "Текст для канала" },
        vk: { title: "ВК заголовок", body: "Текст для стены" },
      },
    });
  });

  it("falls back to the shared title when platform fields are absent", () => {
    const form = new FormData();
    form.set("title", "Общий");
    form.set("body", "Общий текст");
    form.append("platform", "vk");
    expect(draftInputFromForm(form)).toMatchObject({
      title: "Общий",
      body: "Общий текст",
      platforms: ["vk"],
      variants: { vk: { title: "Общий", body: "Общий текст" } },
    });
  });
});
