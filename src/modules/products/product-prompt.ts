import { shopLabels, type ShopKind } from "@/modules/products/shop-url";

export function productToAgentPrompt(input: {
  title: string;
  shop: ShopKind;
  priceText?: string | null;
  sourceUrl: string;
  visual: "shop" | "generate";
}) {
  return [
    "Напиши готовый пост для сообщества текущего проекта.",
    "Пост про один товар. Не выдумывай свойства, отзывы и скидки.",
    `Магазин: ${shopLabels[input.shop]}`,
    `Товар: ${input.title}`,
    input.priceText ? `Цена как в карточке: ${input.priceText}` : "Цену не выдумывай, если её нет в карточке.",
    `Ссылка на товар обязательна в тексте: ${input.sourceUrl}`,
    input.visual === "shop"
      ? "Визуал: использовать фото магазина, не рисовать другое."
      : "Визуал: нарисовать кадр 4:5 по товару, не копировать витрину один в один.",
  ].join("\n");
}

export function productStudioHref(input: {
  productId: string;
  title: string;
  shop: ShopKind;
  priceText?: string | null;
  sourceUrl: string;
  imageUrl?: string | null;
  visual: "shop" | "generate";
}) {
  const params = new URLSearchParams({
    prompt: productToAgentPrompt(input),
    visual: input.visual,
    shopProductId: input.productId,
  });
  if (input.imageUrl) {
    params.set("productImage", input.imageUrl);
  }
  return `/app/studio?${params.toString()}#agent-brief`;
}
