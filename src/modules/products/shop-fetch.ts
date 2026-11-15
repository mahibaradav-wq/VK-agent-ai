import { shopHostAllowed } from "@/modules/products/shop-url";

export type ShopCardSnapshot = {
  title?: string;
  priceText?: string;
  imageUrl?: string;
};

function decode(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function metaContent(html: string, key: string) {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["']`,
    "i",
  );
  const match = pattern.exec(html);
  const value = match?.[1] || match?.[2];
  return value ? decode(value) : "";
}

function jsonLdPrice(html: string) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) {
    try {
      const data = JSON.parse(block[1] ?? "") as { offers?: { price?: string | number; priceCurrency?: string } };
      const price = data.offers?.price;
      if (price == null || price === "") {
        continue;
      }
      const currency = data.offers?.priceCurrency ? ` ${data.offers.priceCurrency}` : " ₽";
      return `${price}${currency}`.trim();
    } catch {
      // Невалидный JSON-LD магазина не ломает карточку.
    }
  }
  return "";
}

export function snapshotFromHtml(html: string): ShopCardSnapshot {
  const title = metaContent(html, "og:title") || metaContent(html, "twitter:title");
  const imageUrl = metaContent(html, "og:image") || metaContent(html, "twitter:image");
  const priceText =
    metaContent(html, "product:price:amount") || metaContent(html, "og:price:amount") || jsonLdPrice(html);
  return {
    title: title || undefined,
    imageUrl: imageUrl || undefined,
    priceText: priceText || undefined,
  };
}

export async function fetchShopCard(canonicalUrl: string, fetcher: typeof fetch = fetch): Promise<ShopCardSnapshot> {
  const url = new URL(canonicalUrl);
  if (!shopHostAllowed(url.hostname)) {
    return {};
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(url.toString(), {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { Accept: "text/html", "User-Agent": "PolkaSocial/1.0" },
    });
    if (response.status >= 300 && response.status < 400) {
      return {};
    }
    if (!response.ok) {
      return {};
    }
    const html = (await response.text()).slice(0, 400_000);
    return snapshotFromHtml(html);
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}
