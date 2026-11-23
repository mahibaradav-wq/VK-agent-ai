export const shopKinds = ["ozon", "wildberries", "market", "magnit"] as const;
export type ShopKind = (typeof shopKinds)[number];

export const shopLabels: Record<ShopKind, string> = {
  ozon: "Ozon",
  wildberries: "Wildberries",
  market: "Яндекс Маркет",
  magnit: "Магнит",
};

const shopHosts: Record<ShopKind, string[]> = {
  ozon: ["ozon.ru", "www.ozon.ru"],
  wildberries: ["wildberries.ru", "www.wildberries.ru"],
  market: ["market.yandex.ru"],
  magnit: ["magnit.ru", "www.magnit.ru", "magnit.com", "www.magnit.com"],
};

export class ShopUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopUrlError";
  }
}

export type ParsedShopUrl = {
  shop: ShopKind;
  sourceUrl: string;
  canonicalUrl: string;
  titleGuess: string;
};

function guessTitle(pathname: string) {
  const parts = pathname
    .split("/")
    .map((part) => decodeURIComponent(part).replace(/[-_]+/g, " ").trim())
    .filter((part) => part && !/^\d+$/.test(part) && !/^(product|catalog|detail|aspx)$/i.test(part));
  const last = parts.at(-1) ?? "";
  return last.replace(/\s+\d{4,}$/, "").trim();
}

export function parseShopProductUrl(raw: string): ParsedShopUrl {
  const sourceUrl = raw.trim();
  if (!sourceUrl) {
    throw new ShopUrlError("Вставьте ссылку на карточку товара.");
  }

  let url: URL;
  try {
    url = new URL(sourceUrl.includes("://") ? sourceUrl : `https://${sourceUrl}`);
  } catch {
    throw new ShopUrlError("Это не ссылка. Нужен адрес карточки Ozon, Wildberries, Маркета или Магнита.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ShopUrlError("Ссылка должна начинаться с https://");
  }

  const host = url.hostname.toLowerCase();
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":")) {
    throw new ShopUrlError("Ссылка на IP-адрес не принимается. Нужна карточка магазина.");
  }

  const shop = (Object.entries(shopHosts) as Array<[ShopKind, string[]]>).find(([, hosts]) =>
    hosts.includes(host),
  )?.[0];
  if (!shop) {
    throw new ShopUrlError("Сейчас принимаются ссылки Ozon, Wildberries, Яндекс Маркета и Магнита.");
  }

  url.hash = "";
  const canonicalUrl = url.toString();
  const titleGuess = guessTitle(url.pathname) || shopLabels[shop];

  return { shop, sourceUrl, canonicalUrl, titleGuess };
}

export function shopHostAllowed(hostname: string) {
  const host = hostname.toLowerCase();
  return (Object.values(shopHosts) as string[][]).some((hosts) => hosts.includes(host));
}
