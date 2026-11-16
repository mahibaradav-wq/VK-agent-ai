"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import { connectVkWatch, disconnectVkWatch, type WatchFormState } from "@/modules/watch/actions";

const idle: WatchFormState = { status: "idle", message: "" };

export function VkWatchKeyCard({
  workspaceId,
  canConnect,
  credential,
}: {
  workspaceId: string;
  canConnect: boolean;
  credential: { connected: boolean; status: string; lastError: string | null };
}) {
  const [tokenState, tokenAction, tokenPending] = useActionState(connectVkWatch, idle);
  const [disconnectState, disconnectAction, disconnectPending] = useActionState(disconnectVkWatch, idle);
  const message = tokenState.message || disconnectState.message;

  return (
    <Card className="grid gap-3">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">ВК · чтение стен</p>
      <h2 className="text-xl font-black text-ink">Ключ для Идей</h2>
      <p className="text-sm text-ink/70">
        Сервисный ключ VK ID, только чтение стен. Пароль не принимается. Публиковать этим ключом нельзя.
      </p>
      <p className="text-sm text-ink/70">
        Статус: {credential.connected ? "подключено" : "не задано"}
        {credential.lastError ? ` · ${credential.lastError}` : ""}
      </p>
      {message ? (
        <StatusBanner tone={tokenState.status === "invalid" || disconnectState.status === "invalid" ? "warning" : "success"}>
          {message}
        </StatusBanner>
      ) : null}
      {canConnect ? (
        <>
          <form action={tokenAction} className="grid gap-3">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <label className="grid gap-2 text-sm font-medium text-ink">
              Ключ чтения VK API
              <input
                name="token"
                type="password"
                autoComplete="off"
                required
                className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal"
              />
            </label>
            <Button disabled={tokenPending}>{tokenPending ? "Проверяем..." : "Сохранить ключ чтения"}</Button>
          </form>
          {credential.connected ? (
            <form action={disconnectAction}>
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <Button type="submit" variant="secondary" disabled={disconnectPending}>
                Отключить ключ
              </Button>
            </form>
          ) : null}
        </>
      ) : (
        <StatusBanner tone="info">Ключ чтения могут сохранить Owner и Admin.</StatusBanner>
      )}
    </Card>
  );
}
