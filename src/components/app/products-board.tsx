"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import {
  addShopProduct,
  removeShopProduct,
  sendProductToStudio,
  type ProductFormState,
} from "@/modules/products/actions";
import { shopLabels, type ShopKind } from "@/modules/products/shop-url";

const idle: ProductFormState = { status: "idle", message: "" };

export type ProductCardView = {
  id: string;
  shop: ShopKind;
  sourceUrl: string;
  title: string;
  priceText: string | null;
  imageUrl: string | null;
};

export function ProductsBoard({
  workspaceId,
  projectId,
  canEdit,
  studioBusy,
  products,
}: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
  studioBusy: boolean;
  products: ProductCardView[];
}) {
  const [addState, addAction, addPending] = useActionState(addShopProduct, idle);

  return (
    <div className="grid gap-6">
      {addState.message ? (
        <StatusBanner tone={addState.status === "success" ? "success" : "warning"}>{addState.message}</StatusBanner>
      ) : null}

      {canEdit ? (
        <Card className="grid gap-3">
          <h2 className="text-xl font-black text-ink">Ссылка на товар</h2>
          <p className="text-sm text-ink/70">
            Ozon, Wildberries, Яндекс Маркет или Магнит. Свой бриф без ссылки пишите сразу в Студии.
          </p>
          <form action={addAction} className="grid gap-3">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="projectId" value={projectId} />
            <label className="grid gap-2 text-sm font-medium text-ink">
              Адрес карточки
              <input
                name="sourceUrl"
                required
                placeholder="https://www.ozon.ru/product/..."
                className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal"
              />
            </label>
            <Button disabled={addPending}>{addPending ? "Открываем карточку..." : "Добавить"}</Button>
          </form>
        </Card>
      ) : (
        <StatusBanner tone="info">Добавлять товары могут Editor, Admin и Owner.</StatusBanner>
      )}

      {products.length === 0 ? (
        <StatusBanner tone="info">В этом проекте нет товаров. Вставьте ссылку магазина.</StatusBanner>
      ) : null}

      {products.map((product) => (
        <Card key={product.id} className="grid gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">{shopLabels[product.shop]}</p>
          <div className="grid gap-4 md:grid-cols-[8rem_1fr]">
            {product.imageUrl ? (
              <img src={product.imageUrl} alt="" className="h-32 w-32 rounded-2xl object-cover ring-1 ring-ink/10" />
            ) : (
              <div className="flex h-32 w-32 items-center justify-center rounded-2xl bg-sand-50 text-xs text-ink/50">
                Нет фото
              </div>
            )}
            <div className="grid gap-2">
              <h2 className="text-xl font-black text-ink">{product.title}</h2>
              {product.priceText ? <p className="text-sm font-semibold text-ink">{product.priceText}</p> : null}
              <a href={product.sourceUrl} className="text-sm font-semibold text-brand-dark" target="_blank" rel="noreferrer">
                Открыть в магазине
              </a>
            </div>
          </div>
          {canEdit ? (
            <div className="grid gap-3">
              {studioBusy ? (
                <StatusBanner tone="warning">
                  В Студии уже есть карточка. Сначала опубликуйте, поставьте в календарь или удалите её.
                </StatusBanner>
              ) : (
                <form action={sendProductToStudio} className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <input type="hidden" name="workspaceId" value={workspaceId} />
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="productId" value={product.id} />
                  <label className="grid gap-2 text-sm font-medium text-ink">
                    Картинка поста
                    <select name="visual" defaultValue="generate" className="min-h-11 rounded-2xl border border-ink/10 bg-white px-3">
                      <option value="generate">Нарисовать 4:5 в ChatGPT</option>
                      <option value="shop" disabled={!product.imageUrl}>
                        Фото магазина
                      </option>
                    </select>
                  </label>
                  <Button className="self-end">В Студию</Button>
                </form>
              )}
              <form action={removeShopProduct}>
                <input type="hidden" name="workspaceId" value={workspaceId} />
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="productId" value={product.id} />
                <Button type="submit" variant="ghost">
                  Убрать
                </Button>
              </form>
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
