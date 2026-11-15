import { describe, expect, it } from "vitest";

import { buyButtonLabel, parseShopPrice } from "@/modules/products/shop-labels";

describe("shop labels", () => {
  it("builds the VK market buy button from the shop", () => {
    expect(buyButtonLabel("ozon")).toBe("Купить на Ozon");
    expect(buyButtonLabel("wildberries")).toBe("Купить на Wildberries");
  });

  it("reads a numeric price from the shop card", () => {
    expect(parseShopPrice("12 961 ₽")).toBe(12961);
    expect(parseShopPrice("1290 RUB")).toBe(1290);
    expect(parseShopPrice("нет")).toBeNull();
  });
});
