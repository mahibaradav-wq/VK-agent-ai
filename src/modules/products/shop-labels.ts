import type { ShopKind } from "@/modules/products/shop-url";
import { shopLabels } from "@/modules/products/shop-url";

export function buyButtonLabel(shop: ShopKind) {
  if (shop === "ozon") {
    return "Купить на Ozon";
  }
  if (shop === "wildberries") {
    return "Купить на Wildberries";
  }
  if (shop === "market") {
    return "Купить на Маркете";
  }
  return "Купить на Магните";
}

export function parseShopPrice(priceText: string | null | undefined) {
  if (!priceText) {
    return null;
  }
  const match = priceText.replace(/\s/g, "").replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function shopName(shop: ShopKind) {
  return shopLabels[shop];
}

export function withProductLink(text: string, url?: string | null) {
  const body = text.trim() || "Публикация Polka Social";
  if (!url || body.includes(url)) {
    return body;
  }
  return `${body}\n\n${url}`;
}
