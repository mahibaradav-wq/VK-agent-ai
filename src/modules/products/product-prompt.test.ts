import { describe, expect, it } from "vitest";

import { productStudioHref, productToAgentPrompt } from "@/modules/products/product-prompt";

describe("product studio handoff", () => {
  it("puts the shop link into the brief and opens Studio", () => {
    const prompt = productToAgentPrompt({
      title: "Короб",
      shop: "ozon",
      priceText: "990 ₽",
      sourceUrl: "https://www.ozon.ru/product/korob-1/",
      visual: "generate",
    });
    expect(prompt).toContain("https://www.ozon.ru/product/korob-1/");
    expect(prompt).toContain("990");
    expect(
      productStudioHref({
        productId: "prd_1",
        title: "Короб",
        shop: "ozon",
        sourceUrl: "https://www.ozon.ru/product/korob-1/",
        visual: "shop",
      }),
    ).toMatch(/^\/app\/studio\?/);
  });
});
