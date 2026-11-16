import { describe, expect, it } from "vitest";

import { snapshotFromHtml } from "@/modules/products/shop-fetch";

describe("snapshotFromHtml", () => {
  it("reads Open Graph title, image and JSON-LD price", () => {
    const html = `
      <meta property="og:title" content="Органайзер для кухни" />
      <meta property="og:image" content="https://cdn.ozon.ru/pic.jpg" />
      <script type="application/ld+json">{"offers":{"price":1290,"priceCurrency":"RUB"}}</script>
    `;
    expect(snapshotFromHtml(html)).toEqual({
      title: "Органайзер для кухни",
      imageUrl: "https://cdn.ozon.ru/pic.jpg",
      priceText: "1290 RUB",
    });
  });
});
