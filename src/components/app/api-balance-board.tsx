"use client";

import { useActionState } from "react";

import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import { refreshAiBalance, type BalanceFormState } from "@/modules/ai/balance-actions";
import type { PublicAiBalance } from "@/modules/ai/balance-service";
import { formatUsd } from "@/lib/format-usd";

const idle: BalanceFormState = { status: "idle", message: "" };

export function ApiBalanceBoard({
  workspaceId,
  balance,
}: {
  workspaceId: string;
  balance: PublicAiBalance;
}) {
  const [state, action, pending] = useActionState(refreshAiBalance, idle);
  const message = state.message || balance.message;
  const tone = state.status === "invalid" || balance.remainingUsd == null ? "warning" : "info";

  return (
    <Card className="grid gap-4">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">ChatGPT</p>
      <p className="text-4xl font-black text-ink">
        {balance.remainingUsd == null ? "—" : formatUsd(balance.remainingUsd)}
      </p>
      {message ? <StatusBanner tone={tone}>{message}</StatusBanner> : null}
      {!balance.hasKey ? (
        <ButtonLink href="/app/connections" variant="secondary">
          Подключения
        </ButtonLink>
      ) : (
        <form action={action}>
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <Button disabled={pending}>{pending ? "Читаем счёт..." : "Обновить остаток"}</Button>
        </form>
      )}
      <p className="text-sm text-ink/60">
        Пополнение только на{" "}
        <a className="font-semibold text-brand-dark" href="https://platform.openai.com/settings/organization/billing" target="_blank" rel="noreferrer">
          platform.openai.com
        </a>
        . Пароль ChatGPT сюда не подходит.
      </p>
    </Card>
  );
}
