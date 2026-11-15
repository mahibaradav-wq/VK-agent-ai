"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import { connectShopPartner, disconnectShopPartner, type ProductFormState } from "@/modules/products/actions";
import { shopKinds, shopLabels, type ShopKind } from "@/modules/products/shop-url";

const idle: ProductFormState = { status: "idle", message: "" };

export function ShopPartnersBoard({
  workspaceId,
  projectId,
  canConnect,
  partners,
}: {
  workspaceId: string;
  projectId: string;
  canConnect: boolean;
  partners: Array<{ shop: ShopKind; connected: boolean; status: string }>;
}) {
  const [state, action, pending] = useActionState(connectShopPartner, idle);

  return (
    <Card className="grid gap-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Магазины</p>
        <h2 className="mt-2 text-xl font-black text-ink">Партнёрские кабинеты этого проекта</h2>
        <p className="mt-2 text-sm text-ink/70">
          Каждый магазин подключается отдельно. Секрет не показываем. Без кабинета ссылка в посте не выдаётся за
          партнёрскую. Маркировку «Реклама» пока не ставим.
        </p>
      </div>
      {state.message ? (
        <StatusBanner tone={state.status === "success" ? "success" : "warning"}>{state.message}</StatusBanner>
      ) : null}
      <ul className="grid gap-3">
        {shopKinds.map((shop) => {
          const row = partners.find((item) => item.shop === shop);
          return (
            <li key={shop} className="grid gap-3 rounded-2xl bg-sand-50 p-4">
              <p className="font-semibold text-ink">{shopLabels[shop]}</p>
              <p className="text-sm text-ink/60">{row?.connected ? "подключено" : "не задано"}</p>
              {canConnect ? (
                <>
                  <form action={action} className="grid gap-2 md:grid-cols-[1fr_auto]">
                    <input type="hidden" name="workspaceId" value={workspaceId} />
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="shop" value={shop} />
                    <input
                      name="token"
                      type="password"
                      autoComplete="off"
                      required
                      placeholder="Идентификатор кабинета"
                      className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4 text-base font-normal"
                    />
                    <Button disabled={pending}>{row?.connected ? "Заменить" : "Сохранить"}</Button>
                  </form>
                  {row?.connected ? (
                    <form action={disconnectShopPartner}>
                      <input type="hidden" name="workspaceId" value={workspaceId} />
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="shop" value={shop} />
                      <Button type="submit" variant="ghost">
                        Отключить
                      </Button>
                    </form>
                  ) : null}
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
