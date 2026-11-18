import { describe, expect, it } from "vitest";

import { copyForPlatform, parseVariants, serializeVariants, variantsFromCopies } from "@/modules/posts/variants";

describe("platform copy variants", () => {
  it("reads per-network text and falls back to the shared draft", () => {
    const version = {
      title: "Общий",
      body: "Общий текст",
      variantsJson: serializeVariants({
        telegram: { title: "ТГ заголовок", body: "Текст для канала" },
        vk: { title: "ВК заголовок", body: "Текст для стены" },
      }),
    };
    expect(copyForPlatform(version, "telegram")).toEqual({ title: "ТГ заголовок", body: "Текст для канала" });
    expect(copyForPlatform(version, "vk")).toEqual({ title: "ВК заголовок", body: "Текст для стены" });
    expect(copyForPlatform({ title: "Общий", body: "Общий текст" }, "vk")).toEqual({
      title: "Общий",
      body: "Общий текст",
    });
  });

  it("keeps only selected networks", () => {
    expect(parseVariants("{not json")).toEqual({});
    expect(
      variantsFromCopies(
        ["vk"],
        { telegram: { title: "ТГ", body: "канал" }, vk: { title: "ВК", body: "стена" } },
        { title: "Общий", body: "Общий текст" },
      ),
    ).toEqual({ vk: { title: "ВК", body: "стена" } });
  });
});
