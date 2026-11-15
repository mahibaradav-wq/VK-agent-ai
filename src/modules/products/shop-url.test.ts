import { describe, expect, it } from "vitest";

import { parseShopProductUrl, ShopUrlError } from "@/modules/products/shop-url";

describe("parseShopProductUrl", () => {
  it("reads Ozon, Wildberries, Market and Magnit links", () => {
    expect(parseShopProductUrl("https://www.ozon.ru/product/organayzer-123456/").shop).toBe("ozon");
    expect(parseShopProductUrl("https://www.wildberries.ru/catalog/12345678/detail.aspx").shop).toBe("wildberries");
    expect(parseShopProductUrl("https://market.yandex.ru/product--polka/999").shop).toBe("market");
    expect(parseShopProductUrl("https://magnit.ru/product/korob").shop).toBe("magnit");
  });

  it("guesses a title from the slug", () => {
    const parsed = parseShopProductUrl("https://www.ozon.ru/product/organayzer-dlya-kuhni-111/");
    expect(parsed.titleGuess.toLowerCase()).toContain("organayzer");
  });

  it("rejects empty, foreign shops and IP addresses", () => {
    expect(() => parseShopProductUrl("")).toThrow(ShopUrlError);
    expect(() => parseShopProductUrl("https://example.com/item/1")).toThrow(/Ozon/);
    expect(() => parseShopProductUrl("https://8.8.8.8/product/1")).toThrow(/IP/);
  });
});
